import SwiftUI
import CEngine
import ManadjAudio
import ManadjCore

struct DeckViewState {
    var title = "No track loaded"
    var artist = "LOAD FROM LIBRARY OR FILES"
    var track: LibraryTrack?
    var duration: Double = 0
    var waveform: PreviewWaveform?
    var engine = MDJDeck()
    var loading = false
}

@MainActor final class AppModel: ObservableObject {
    @Published var decks = (0..<4).map { _ in DeckViewState() }
    @Published var libraryVersion = 0
    @Published var snapshot: Snapshot? { didSet { libraryVersion += 1 } }
    @Published var downloaded: Set<Int> = []
    @Published var busy = false
    @Published var status = "Offline library"
    @Published var error: String?
    @Published var pairingCode: String?
    @Published var origin = UserDefaults.standard.string(forKey: "desktop.origin") ?? "http://"
    @Published var recording = false
    @Published var recordings: [URL] = []
    @Published var loadTarget = 0
    @Published var crossfade = 0.0
    @Published var syncStatuses = Array(repeating: TempoSyncStatus.off, count: 4)
    @Published var groupTempo: Double?
    private var sentSyncMasks: (Int, Int)?
    private lazy var tempoSync = TempoSyncGroup(write: { [weak self] deck, pitch in
        if self?.audio?.send(MDJPitch, deck: deck, value: pitch) != true { self?.error = "Tempo control was not accepted. Try again." }
    }, align: { [weak self] deck, peer, ratio in
        if self?.audio?.alignPhase(deck, reference: peer, ratio: ratio) != true { self?.error = "Phase alignment was not accepted. Try again." }
    })
    @Published var quantize = false
    @Published var waveSeconds = 12.0
    @Published var splitOutput = false
    @Published var cueMix = 0.0
    private(set) var audio: NativeAudio?
    private var repository: LibraryRepository?
    private var connection: DesktopConnection?
    private var task: Task<Void, Never>?
    private var clock: Task<Void, Never>?
    @Published var liveListening = false
    @Published var liveStatus = "Local live prototype"
    @Published var liveRoundTrip = 0.0
    @Published var liveDrift = 0.0
    private var liveTask: Task<Void, Never>?
    private var liveReceived = 0.0
    private var liveWatchdogPaused = false
    private var liveStream = ""
    private var liveSequence = -1
    private var engineErrors: Set<UInt64> = []
    private let root: URL
    private let deviceId: String

    init(storageRoot: URL? = nil) {
        #if DEBUG
        if let storageRoot { root = storageRoot }
        else if ProcessInfo.processInfo.arguments.contains("--performance-ui-fixture") {
            root = Self.makePerformanceUIFixture() ?? FileManager.default.temporaryDirectory.appendingPathComponent("fixture-failed-" + UUID().uuidString)
        }
        else if ProcessInfo.processInfo.arguments.contains("--usb-ui-fixture") {
            root = FileManager.default.temporaryDirectory.appendingPathComponent("usb-app-fixture-" + UUID().uuidString)
        }
        else if ProcessInfo.processInfo.arguments.contains("--library-ui-fixture") {
            root = Self.makeLibraryUIFixture() ?? FileManager.default.temporaryDirectory.appendingPathComponent("fixture-failed-" + UUID().uuidString)
        } else { root = URL.applicationSupportDirectory.appendingPathComponent("manadj", isDirectory: true) }
        #else
        root = storageRoot ?? URL.applicationSupportDirectory.appendingPathComponent("manadj", isDirectory: true)
        #endif
        let existing = UserDefaults.standard.string(forKey: "device.id")
        deviceId = existing ?? UUID().uuidString
        if existing == nil { UserDefaults.standard.set(deviceId, forKey: "device.id") }
        do { try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true) } catch { self.error = error.localizedDescription }
        do { audio = try NativeAudio() } catch { audio = nil; self.error = error.localizedDescription }
        audio?.onInterruption = { [weak self] message in
            self?.stopLocalLive()
            self?.status = message
            self?.recording = false
            self?.refreshRecordings()
        }
        clock = Task { [weak self] in
            while !Task.isCancelled {
                self?.poll()
                try? await Task.sleep(for: .milliseconds(100))
            }
        }
        Task {
            await openCache()
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--local-live-ui-fixture") { await installLocalLiveUIFixture() }
            #endif
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--performance-ui-fixture") { await installPerformanceFixture() }
            #endif
        }
        refreshRecordings()
    }
    deinit { clock?.cancel(); task?.cancel(); liveTask?.cancel() }
    private func openCache() async {
        do {
            let repo = try LibraryRepository(root: root.appendingPathComponent("library"))
            repository = repo
            snapshot = await repo.cachedSnapshot()
            downloaded = await repo.downloadedIds()
            if !ProcessInfo.processInfo.arguments.contains("--library-ui-fixture"), !ProcessInfo.processInfo.arguments.contains("--performance-ui-fixture"), !ProcessInfo.processInfo.arguments.contains("--usb-ui-fixture"), let url = URL(string: origin), let token = PairingKeychain.token(for: origin) {
                connection = try DesktopConnection(url: url, deviceToken: token, deviceId: deviceId, deviceName: UIDevice.current.name)
            }
            if let warning = await repo.recoveryWarning { error = warning }
            status = snapshot.map { "\($0.tracks.count) tracks cached · offline ready" } ?? "Pair with your desktop to sync your library"
        } catch { self.error = "Offline cache: \(error.localizedDescription)" }
    }
    func poll() {
        guard let audio else { return }
        if liveListening && !liveWatchdogPaused && ProcessInfo.processInfo.systemUptime - liveReceived > 1 {
            liveWatchdogPaused = true
            for index in 0..<4 { audio.send(MDJPause, deck: index) }
            liveStatus = "Waiting for fresh desktop state · paused"
        }
        var updated = decks
        for index in 0..<4 {
            updated[index].engine = audio.state(index)
            let state = updated[index].engine
            if !updated[index].loading, state.status & 3 == 3, engineErrors.insert(state.load).inserted {
                error = "Deck \(Ink.deckName(index)) audio decoding failed. Reload this track."
            }
        }
        // Wave views read the engine on their own display clock. Publish the
        // slower control snapshot only when visible values actually changed.
        if zip(decks, updated).contains(where: { !Self.sameControlState($0.engine, $1.engine) }) { decks = updated }
        if !liveListening { updateTempoSync() }
        if recording && audio.recordingState != 1 {
            recording = false
            if audio.recordingState == 4 { error = "Recording stopped with error \(audio.recordingError). The partial file was not marked saved." }
            refreshRecordings()
        }
    }
    private static func sameControlState(_ a: MDJDeck, _ b: MDJDeck) -> Bool {
        guard a.load == b.load, a.transport == b.transport, a.status == b.status,
              Int(a.position * 10) == Int(b.position * 10), a.target == b.target, a.cue == b.cue,
              a.bpm == b.bpm, a.anchor == b.anchor, a.loopStart == b.loopStart, a.loopEnd == b.loopEnd,
              a.loopBeats == b.loopBeats, Int(a.decodedSeconds) == Int(b.decodedSeconds),
              a.fader == b.fader, a.trim == b.trim, a.pitch == b.pitch, a.bend == b.bend, a.filter == b.filter,
              a.eq.0 == b.eq.0, a.eq.1 == b.eq.1, a.eq.2 == b.eq.2,
              a.playing == b.playing, a.preview == b.preview, a.previewSlot == b.previewSlot,
              a.ready == b.ready, a.fullyDecoded == b.fullyDecoded, a.keyLock == b.keyLock,
              a.keyLockActive == b.keyLockActive, a.pfl == b.pfl, a.loopActive == b.loopActive else { return false }
        var ac = a.hotCues, bc = b.hotCues
        return withUnsafeBytes(of: &ac) { aa in withUnsafeBytes(of: &bc) { bb in aa.elementsEqual(bb) } }
    }
    /// Explicit own-device takeover. Never starts from a remote message.
    #if DEBUG
    func useLocalLiveTestConnection(_ candidate: DesktopConnection) { connection = candidate }
    private func installLocalLiveUIFixture() async {
        do {
            guard let descriptor = Bundle.main.url(forResource: "lan-fixture", withExtension: "json"),
                  let fields = try JSONSerialization.jsonObject(with: Data(contentsOf: descriptor)) as? [String: Any],
                  let origin = fields["origin"] as? String, let url = URL(string: origin) else {
                throw AppFailure("Synthetic LAN descriptor missing")
            }
            let client = SyncClient(try DesktopConnection(url: url))
            let ticket = try await client.requestPairing(deviceId: UUID().uuidString, deviceName: "Synthetic UI listener")
            for _ in 0..<50 {
                if let token = try await client.pollPairing(ticket).token {
                    connection = try DesktopConnection(url: url, deviceToken: token)
                    startLocalLive(); return
                }
                try await Task.sleep(for: .milliseconds(100))
            }
            throw AppFailure("Synthetic pairing did not finish")
        } catch { liveStatus = error.localizedDescription }
    }
    #endif
    func startLocalLive() {
        guard !liveListening, !recording, !busy, !decks.contains(where: { $0.loading }), let connection, let repository, audio != nil else {
            error = "Pair first and finish other work/recording before listening."; return
        }
        liveListening = true; liveStatus = "Connecting · phone decks paused"
        liveReceived = 0; liveWatchdogPaused = false; liveStream = ""; liveSequence = -1
        for index in 0..<4 { audio?.send(MDJPause, deck: index); audio?.send(MDJSeek, deck: index, value: audio?.state(index).position ?? 0); audio?.send(MDJPfl, deck: index, value: 0) }
        audio?.beatFX(effect: 0, target: 0, on: false, depth: 0, beats: 1)
        audio?.splitOutput(false)
        liveTask = Task { [weak self] in
            guard let self else { return }
            let client = SyncClient(connection)
            do {
                // Refresh from this exact paired origin before resolving bare IDs.
                let refreshed = try await repository.sync(connection)
                try Task.checkCancellation()
                self.snapshot = refreshed
                while !Task.isCancelled && self.liveListening {
                    let sent = ProcessInfo.processInfo.systemUptime
                    let envelope = try await client.liveState()
                    try Task.checkCancellation()
                    let received = ProcessInfo.processInfo.systemUptime
                    let rtt = received - sent
                    self.liveRoundTrip = rtt
                    guard envelope.state == "live", let anchor = envelope.anchor else {
                        self.pauseLocalLive("Desktop is not live · paused")
                        try await Task.sleep(for: .milliseconds(200)); continue
                    }
                    guard anchor.unsupported.isEmpty else {
                        self.pauseLocalLive("Unsupported: " + anchor.unsupported.joined(separator: ", "))
                        try await Task.sleep(for: .milliseconds(200)); continue
                    }
                    if anchor.streamId != self.liveStream {
                        self.pauseLocalLive("New desktop stream · preparing")
                        self.liveStream = anchor.streamId; self.liveSequence = -1
                    }
                    guard anchor.seq > self.liveSequence else {
                        // Duplicate source samples do not refresh the freshness watchdog.
                        try await Task.sleep(for: .milliseconds(100)); continue
                    }
                    self.liveSequence = anchor.seq
                    guard envelope.age + rtt / 2 <= 1 else {
                        self.pauseLocalLive("Waiting for fresh desktop state · paused")
                        try await Task.sleep(for: .milliseconds(100)); continue
                    }
                    self.liveReceived = received - envelope.age - rtt / 2; self.liveWatchdogPaused = false
                    try await self.applyLocalLive(anchor, age: envelope.age, rtt: rtt, received: received, repository: repository, connection: connection)
                    try await Task.sleep(for: .milliseconds(200))
                }
            } catch is CancellationError { }
            catch { self.pauseLocalLive(error.localizedDescription) }
        }
    }
    private func pauseLocalLive(_ reason: String) {
        liveWatchdogPaused = true
        for index in 0..<4 { audio?.send(MDJPause, deck: index) }
        liveStatus = reason
    }
    func stopLocalLive() {
        liveTask?.cancel(); liveTask = nil
        pauseLocalLive("Stopped · phone decks paused")
        liveListening = false
    }
    private func applyLocalLive(_ anchor: LiveAnchor, age: Double, rtt: Double, received: Double,
                                repository: LibraryRepository, connection: DesktopConnection) async throws {
        guard let audio else { throw AppFailure("Audio unavailable") }
        // Validate the entire frame before allowing any channel to sound.
        for row in anchor.decks { _ = try row.target(age: age, roundTrip: rtt) }
        for index in 0..<4 {
            let row = anchor.decks[index]
            guard let id = row.trackId else { audio.send(MDJPause, deck: index); decks[index].track = nil; decks[index].title = "No track loaded"; continue }
            guard let track = snapshot?.tracks.first(where: { $0.id == id }), track.audioRev == row.audioRev, row.audioRev != nil else {
                throw AppFailure("Track changed or not in synced Library. Stop, sync, then listen again.")
            }
            if decks[index].track?.id != id || decks[index].track?.audioRev != row.audioRev || !audio.state(index).ready {
                pauseLocalLive("Preparing audio")
                liveStatus = "Preparing deck \(Ink.deckName(index)) audio · silent until ready"
                let file = try await repository.audio(track, connection: connection)
                try Task.checkCancellation()
                let duration = try await audio.load(file, deck: index)
                try Task.checkCancellation()
                decks[index].track = track; decks[index].title = track.title
                decks[index].artist = track.artist ?? ""; decks[index].duration = duration
                decks[index].waveform = await repository.preview(track)
                // Fetch a fresh anchor after download/decode, never extrapolate old state.
                liveStatus = "Audio ready · waiting for fresh anchor"
                return
            }
        }
        for index in 0..<4 {
            let row = anchor.decks[index]
            if row.trackId != nil && row.keyLock && abs(row.pitch) > 0.001 && !audio.state(index).fullyDecoded {
                throw AppFailure("Long-file key lock is not supported by this prototype.")
            }
        }
        try Task.checkCancellation()
        let elapsed = ProcessInfo.processInfo.systemUptime - received
        guard liveListening, elapsed <= 1 else { throw AppFailure("Live preparation took too long. Playback paused.") }
        audio.send(MDJCrossfade, value: 0)
        var maxDrift = 0.0
        for index in 0..<4 {
            let row = anchor.decks[index]
            guard row.trackId != nil else { continue }
            let target = try row.target(age: age, roundTrip: rtt, elapsed: elapsed)
            let current = audio.state(index)
            guard target <= decks[index].duration else { audio.send(MDJPause, deck: index); continue }
            audio.send(MDJQuantize, deck: index, value: 0)
            audio.send(MDJKeyLock, deck: index, value: row.keyLock ? 1 : 0)
            audio.send(MDJPitch, deck: index, value: row.pitch)
            audio.send(MDJBend, deck: index, value: row.bend)
            audio.send(MDJFader, deck: index, value: row.fader)
            audio.send(MDJTrim, deck: index, value: row.trim)
            for (band, value) in [row.low, row.mid, row.high].enumerated() { audio.send(MDJEq, deck: index, value: value, slot: band) }
            audio.filter(index, position: row.filter)
            let drift = abs(current.position - target); maxDrift = max(maxDrift, drift)
            if drift > 0.15 || current.playing != row.playing { audio.send(MDJSeek, deck: index, value: target) }
            audio.send(row.playing ? MDJPlay : MDJPause, deck: index)
        }
        try audio.start()
        liveDrift = maxDrift
        liveStatus = "Listening · sampled state prototype"
    }

    func pair() {
        guard !busy else { return }
        task?.cancel()
        busy = true
        task = Task {
            defer { busy = false; pairingCode = nil }
            do {
                let requestedOrigin = origin.trimmingCharacters(in: .whitespacesAndNewlines)
                guard let url = URL(string: requestedOrigin) else { throw AppFailure("Enter the desktop address shown in Phone sync settings") }
                let candidate = try DesktopConnection(url: url)
                let client = SyncClient(candidate)
                let ticket = try await client.requestPairing(deviceId: deviceId, deviceName: UIDevice.current.name)
                pairingCode = ticket.matchCode
                status = "Approve this iPhone on the desktop. Match the code below."
                let deadline = Date().addingTimeInterval(Double(ticket.expiresSeconds))
                while Date() < deadline {
                    try await Task.sleep(for: .seconds(2))
                    let result = try await client.pollPairing(ticket)
                    if result.status == "approved", let token = result.token {
                        let canonicalOrigin = candidate.baseURL.absoluteString
                        try PairingKeychain.save(token, origin: canonicalOrigin)
                        origin = canonicalOrigin
                        connection = try DesktopConnection(url: url, deviceToken: token, deviceId: deviceId, deviceName: UIDevice.current.name)
                        UserDefaults.standard.set(origin, forKey: "desktop.origin")
                        status = "Paired. Ready to sync."
                        return
                    }
                    if result.status != "pending" { throw AppFailure("Pairing \(result.status). Request again when the desktop is ready.") }
                }
                throw AppFailure("Pairing expired. Try again.")
            } catch is CancellationError { status = "Pairing cancelled" }
            catch { self.error = error.localizedDescription }
        }
    }
    func sync(allAudio: Bool = false) {
        guard !busy else { return }
        guard let repository, let connection else { error = "Pair this iPhone with the desktop first"; return }
        task?.cancel(); busy = true; status = allAudio ? "Syncing library and all audio…" : "Syncing library and waveforms…"
        task = Task {
            defer { busy = false }
            do {
                snapshot = try await repository.sync(connection, allAudio: allAudio)
                downloaded = await repository.downloadedIds()
                status = "\(snapshot?.tracks.count ?? 0) tracks synced · \(downloaded.count) downloaded"
            } catch is CancellationError { status = "Sync cancelled. Existing cache kept." }
            catch {
                // A snapshot may have landed before a preview failed. Show that truth, with the error.
                snapshot = await repository.cachedSnapshot()
                downloaded = await repository.downloadedIds()
                self.error = error.localizedDescription
                status = "Sync incomplete. Last valid library kept."
            }
        }
    }
    func preview(_ track: LibraryTrack) async -> PreviewWaveform? { await repository?.preview(track) }
    func cancelWork() { task?.cancel() }
    var pairedOrigin: String? { connection?.baseURL.absoluteString }
    func forgetDesktop() {
        stopLocalLive()
        task?.cancel()
        do { if let pairedOrigin { try PairingKeychain.save(nil, origin: pairedOrigin) }; connection = nil; status = "Desktop forgotten on this iPhone. Offline tracks kept." }
        catch { self.error = error.localizedDescription }
    }
    /// Acceptance means the request was queued, not that asynchronous decoding succeeded.
    /// Refused requests keep the browser and its search focus in place.
    @discardableResult func load(_ track: LibraryTrack, deck: Int) -> Bool {
        guard !liveListening else { error = "Stop local live before loading tracks"; return false }
        guard decks.indices.contains(deck) else { error = "Choose a valid deck"; return false }
        guard !decks[deck].loading else { error = "This deck is already loading. Wait for it to finish."; return false }
        guard let repository else { error = "The offline library is still opening. Try again shortly."; return false }
        guard let audio else { error = "The audio engine is unavailable. Reopen manaDJ and try again."; return false }
        guard track.audioRev != nil else { error = "Track has no downloadable audio revision. Sync the desktop library again."; return false }
        guard downloaded.contains(track.id) || connection != nil else {
            error = "This track is not downloaded. Connect to the desktop first."
            return false
        }
        let previousLoad = audio.state(deck).load
        decks[deck].loading = true
        Task {
            defer { decks[deck].loading = false }
            do {
                let url = try await repository.audio(track, connection: connection)
                let duration = try await audio.load(url, deck: deck)
                let grid = track.grid
                audio.grid(deck, bpm: grid?.tempoChanges.first?.bpm ?? track.bpm ?? 0, anchor: grid?.anchorTime ?? 0)
                if let cue = track.mainCue { audio.send(MDJCueSetAt, deck: deck, value: cue) }
                for cue in track.hotCues where (0..<8).contains(cue.slot) { audio.send(MDJHotCueSetAt, deck: deck, value: cue.time, slot: cue.slot) }
                decks[deck].title = track.title
                decks[deck].artist = track.artist ?? "Unknown artist"
                decks[deck].track = track
                decks[deck].duration = track.durationSecs ?? duration
                decks[deck].waveform = await repository.preview(track)
                downloaded = await repository.downloadedIds()
            } catch { loadFailed(error, deck: deck, previousLoad: previousLoad) }
        }
        return true
    }
    func importFile(_ url: URL, deck: Int, title: String? = nil, artist: String? = nil) {
        guard !liveListening, let audio, !decks[deck].loading else { return }
        let previousLoad = audio.state(deck).load
        decks[deck].loading = true
        Task {
            defer { decks[deck].loading = false }
            do {
                // Keep imports app-owned so iCloud/File Provider grants are not needed on every load.
                let copied = try await Task.detached(priority: .userInitiated) { [root] in
                    let access = url.startAccessingSecurityScopedResource()
                    defer { if access { url.stopAccessingSecurityScopedResource() } }
                    let folder = root.appendingPathComponent("imports/\(UUID().uuidString)")
                    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                    let target = folder.appendingPathComponent(url.lastPathComponent)
                    try FileManager.default.copyItem(at: url, to: target)
                    return target
                }.value
                let duration = try await audio.load(copied, deck: deck)
                decks[deck].title = title ?? url.deletingPathExtension().lastPathComponent
                decks[deck].artist = artist ?? "Imported from Files · no saved grid"
                decks[deck].track = nil
                decks[deck].duration = duration
                decks[deck].waveform = nil
            } catch { loadFailed(error, deck: deck, previousLoad: previousLoad) }
        }
    }
    private func loadFailed(_ failure: Error, deck: Int, previousLoad: UInt64) {
        if let audio, audio.state(deck).load != previousLoad {
            engineErrors.insert(audio.state(deck).load)
            decks[deck] = DeckViewState()
            decks[deck].title = "Load failed"
        }
        error = failure.localizedDescription
    }
    func play(_ deck: Int) {
        do { try audio?.start(); audio?.send(decks[deck].engine.playing ? MDJPause : MDJPlay, deck: deck) }
        catch { self.error = error.localizedDescription }
    }
    private func updateTempoSync() {
        tempoSync.update(decks.map { TempoSyncDeck(ready: $0.engine.ready, playing: $0.engine.playing, bpm: $0.engine.bpm, pitch: Double($0.engine.pitch), source: $0.engine.load) })
        publishTempoSync()
    }
    private func publishTempoSync() {
        if syncStatuses != tempoSync.statuses { syncStatuses = tempoSync.statuses }
        if groupTempo != tempoSync.tempo { groupTempo = tempoSync.tempo }
        let members = syncStatuses.indices.reduce(0) { $0 | (syncStatuses[$1] != .off ? 1 << $1 : 0) }
        let synced = syncStatuses.indices.reduce(0) { $0 | (syncStatuses[$1] == .synced ? 1 << $1 : 0) }
        if sentSyncMasks?.0 != members || sentSyncMasks?.1 != synced, audio?.syncMembers(members, synced: synced) == true { sentSyncMasks = (members, synced) }
    }
    func toggleTempoSync(_ deck: Int) {
        guard !liveListening else { error = "Stop local live before changing sync"; return }
        updateTempoSync()
        if !tempoSync.toggle(deck, quantize: quantize) { error = "SYNC needs a loaded track with BPM and a reachable tempo within ±8%, including half/double time." }
        publishTempoSync()
    }
    func set(_ op: MDJOp, _ deck: Int, _ value: Double, slot: Int = 0) {
        do {
            if op == MDJPitch && !liveListening { updateTempoSync(); tempoSync.setPitch(deck, percent: value); publishTempoSync(); return }
            if op == MDJCueDown || op == MDJHotCueDown { try audio?.start() }
            audio?.send(op, deck: deck, value: value, slot: slot)
        } catch { self.error = error.localizedDescription }
    }
    func toggleRecording() {
        guard let audio else { return }
        if recording { audio.stopRecording(); recording = false; refreshRecordings(); return }
        do {
            let folder = root.appendingPathComponent("recordings")
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let name = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
            try audio.record(to: folder.appendingPathComponent("manadj-\(name)-\(UUID().uuidString.prefix(6)).wav"))
            recording = true
        } catch { self.error = error.localizedDescription }
    }
    func refreshRecordings() {
        recordings = ((try? FileManager.default.contentsOfDirectory(at: root.appendingPathComponent("recordings"), includingPropertiesForKeys: nil)) ?? []).filter { $0.pathExtension == "wav" }.sorted { $0.lastPathComponent > $1.lastPathComponent }
    }
}
