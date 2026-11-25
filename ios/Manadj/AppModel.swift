import SwiftUI
import UIKit
import CEngine
import ManadjAudio
import ManadjCore

struct DeckViewState {
    var title = "No track loaded"
    var artist = "LOAD FROM LIBRARY OR FILES"
    var track: LibraryTrack?
    var duration: Double = 0
    var waveform: PreviewWaveform?
    var waveformNotice: String?
    var engine = MDJDeck()
    var loading = false
}

@MainActor final class DeckPositionReadout: ObservableObject {
    @Published private(set) var position = 0.0
    func update(_ value: Double) {
        if Int(position * 10) != Int(value * 10) { position = value }
    }
}

@MainActor final class AppModel: ObservableObject {
    #if DEBUG
    var browserOpenStarted: Double?
    #endif
    private var deckSnapshots = (0..<4).map { _ in DeckViewState() }
    // User edits/load changes still invalidate controls. Engine polling updates
    // storage directly, publishing controls only for non-position changes.
    var decks: [DeckViewState] {
        get { deckSnapshots }
        set { objectWillChange.send(); deckSnapshots = newValue }
    }
    let positionReadouts = (0..<4).map { _ in DeckPositionReadout() }
    @Published var libraryVersion = 0
    @Published var snapshot: Snapshot? { didSet { libraryVersion += 1 } }
    @Published var downloaded: Set<Int> = []
    @Published var syncProgress: LibrarySyncProgress?
    let syncWake = SyncWakeScope()
    @Published var busy = false
    @Published var status = "Offline library"
    @Published var error: String?
    @Published var pairingCode: String?
    @Published var origin = UserDefaults.standard.string(forKey: "desktop.origin") ?? "http://"
    @Published var recording = false
    @Published var recordings: [URL] = []
    @Published var loadTarget = 0
    @Published var crossfade = 0.0
    @Published var quantize = false
    @Published var waveTouchLock = false
    @Published var waveSeconds = 12.0
    @Published var splitOutput = false
    @Published var cueMix = 0.0
    private(set) var audio: NativeAudio?
    private var repository: LibraryRepository?
    private var connection: DesktopConnection?
    private var task: Task<Void, Never>?
    private var deckLoads: [Task<Void, Never>?] = Array(repeating: nil, count: 4)
    private var deckLoadIDs: [UUID] = (0..<4).map { _ in UUID() }
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
    private var captureDrainTask: Task<Void, Never>?
    private var cloudSyncStorage: CloudSyncController?
    var cloudSync: CloudSyncController {
        if let controller = cloudSyncStorage { return controller }
        let controller = CloudSyncController(root: root.appendingPathComponent("continuous-sync"))
        controller.projectionChanged = { [weak self, weak controller] in
            Task { @MainActor in
                guard let self, let controller, let repository = self.repository, let base = await repository.cachedSnapshot() else { return }
                do { self.snapshot = try controller.project(base) }
                catch { self.error = error.localizedDescription }
            }
        }
        controller.captureStart = { [weak self, weak controller] in
            guard CloudLibraryOAuth.enabled, let self, let audio = self.audio, let (journal, identity) = controller?.captureJournal() else { throw NativeReplicaError.invalid }
            if !audio.sessionCaptureIsPrepared { try audio.prepareSessionCapture(journal: journal, libraryIdentity: identity) }
            try audio.armPreparedSessionCapture()
            self.captureDrainTask = Task { [weak self] in
                while !Task.isCancelled {
                    do { try await self?.audio?.drainPreparedSessionCapture(); try await Task.sleep(for: .milliseconds(50)) }
                    catch { self?.cloudSyncStorage?.stop(); self?.error = "Session evidence capture stopped"; break }
                }
            }
        }
        controller.captureStop = { [weak self] incomplete in
            self?.captureDrainTask?.cancel(); self?.captureDrainTask = nil
            await self?.audio?.stopSessionCapture(incomplete: incomplete)?.value
        }
        cloudSyncStorage = controller
        return controller
    }

    func stopCloudSyncForBackground() { cloudSyncStorage?.stop(incomplete: true) }

    func configureCloudSync(from url: URL) {
        Task {
            let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
            do {
                guard let repository, let base = await repository.cachedSnapshot() else { throw NativeReplicaError.unresolvedBinding }
                let store = await repository.store
                try await cloudSync.configure(Data(contentsOf: url), snapshot: base, store: store)
                snapshot = try cloudSync.project(base)
            } catch { self.error = "Private sync configuration rejected: " + error.localizedDescription }
        }
    }

    private let root: URL
    private let deviceId: String

    init(storageRoot: URL? = nil) {
        #if DEBUG
        if let storageRoot { root = storageRoot }
        else if ProcessInfo.processInfo.arguments.contains("--performance-ui-fixture") {
            root = Self.makePerformanceUIFixture() ?? FileManager.default.temporaryDirectory.appendingPathComponent("fixture-failed-" + UUID().uuidString)
        }
        else if ProcessInfo.processInfo.arguments.contains("--usb-ui-fixture") || ProcessInfo.processInfo.arguments.contains("--sync-progress-ui-fixture") {
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
    deinit { clock?.cancel(); task?.cancel(); liveTask?.cancel(); for load in deckLoads { load?.cancel() } }
    private func openCache() async {
        do {
            let repo = try LibraryRepository(root: root.appendingPathComponent("library"))
            repository = repo
            snapshot = await repo.cachedSnapshot()
            downloaded = await repo.downloadedIds()
            let provisioning = root.appendingPathComponent("continuous-sync/public-provisioning.json")
            if FileManager.default.fileExists(atPath: provisioning.path), let base = snapshot {
                do {
                    let properties = try provisioning.resourceValues(forKeys: [.fileSizeKey, .isSymbolicLinkKey])
                    guard properties.isSymbolicLink != true, let size = properties.fileSize, size <= 64 * 1024 else { throw NativeReplicaError.invalid }
                    let store = await repo.store
                    try await cloudSync.configure(Data(contentsOf: provisioning), snapshot: base, store: store)
                    snapshot = try cloudSync.project(base)
                } catch { self.error = "Saved private sync configuration needs review: " + error.localizedDescription }
            }
            if !ProcessInfo.processInfo.arguments.contains("--library-ui-fixture"), !ProcessInfo.processInfo.arguments.contains("--performance-ui-fixture"), !ProcessInfo.processInfo.arguments.contains("--usb-ui-fixture"), !ProcessInfo.processInfo.arguments.contains("--sync-progress-ui-fixture"), let url = URL(string: origin), let token = PairingKeychain.token(for: origin) {
                connection = try DesktopConnection(url: url, deviceToken: token, deviceId: deviceId, deviceName: UIDevice.current.name)
            }
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--sync-progress-ui-fixture") {
                busy = true
                syncProgress = .init(phase: .audio, completed: 3, total: 10)
                status = "Synthetic progress fixture · not a real transfer"
                return
            }
            #endif
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
        applyEngineSnapshots(updated)
        if recording && audio.recordingState != 1 {
            recording = false
            if audio.recordingState == 4 { error = "Recording stopped with error \(audio.recordingError). The partial file was not marked saved." }
            refreshRecordings()
        }
    }
    func applyEngineSnapshots(_ updated: [DeckViewState]) {
        precondition(updated.count == deckSnapshots.count)
        var controlsChanged = zip(deckSnapshots, updated).contains { !Self.sameControlState($0.engine, $1.engine) }
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--performance-ui-fixture"),
           ProcessInfo.processInfo.arguments.contains("--probe-whole-position-publication") {
            controlsChanged = controlsChanged || zip(deckSnapshots, updated).contains { Int($0.engine.position * 10) != Int($1.engine.position * 10) }
        }
        #endif
        if controlsChanged { objectWillChange.send() }
        // Snapshot consumers (feedback, actions and later redraws) always read
        // current positions. Only observation is scoped, never engine data.
        deckSnapshots = updated
        for index in updated.indices { positionReadouts[index].update(updated[index].engine.position) }
    }
    private static func sameControlState(_ a: MDJDeck, _ b: MDJDeck) -> Bool {
        guard a.load == b.load, a.transport == b.transport, a.status == b.status,
              a.target == b.target, a.cue == b.cue,
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
                    let (envelope, sent) = try await self.pollLocalLiveState { try await client.liveState() }
                    try Task.checkCancellation()
                    let received = ProcessInfo.processInfo.systemUptime
                    let rtt = received - sent
                    self.liveRoundTrip = rtt
                    if try self.deferLocalLiveForRoundTrip(rtt) {
                        try await Task.sleep(for: .milliseconds(100)); continue
                    }
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
            catch {
                // URLSession cancellation can arrive as URLError, not CancellationError.
                // A stopped/replaced listener must never overwrite STOP or pause its successor.
                guard !Task.isCancelled else { return }
                self.pauseLocalLive(error.localizedDescription)
                self.liveListening = false
            }
        }
    }
    // Only recover transport failures from the live-state GET. Authentication,
    // parsing, track preparation and other permanent failures still end the task.
    func pollLocalLiveState(_ fetch: () async throws -> LiveEnvelope) async throws -> (LiveEnvelope, Double) {
        while true {
            try Task.checkCancellation()
            guard liveListening else { throw CancellationError() }
            do {
                let sent = ProcessInfo.processInfo.systemUptime
                let envelope = try await fetch()
                try Task.checkCancellation()
                guard liveListening else { throw CancellationError() }
                return (envelope, sent)
            } catch {
                try Task.checkCancellation()
                guard liveListening else { throw CancellationError() }
                guard let transport = error as? URLError,
                      transport.code == .timedOut || transport.code == .networkConnectionLost else { throw error }
                pauseLocalLive("Connection interrupted · waiting for fresh desktop state · paused")
                try await Task.sleep(for: .milliseconds(500))
            }
        }
    }
    // Slow measurements are not safe sounding frames, but do not end the
    // listener. Do not advance sequence or freshness until a fresh poll arrives.
    func deferLocalLiveForRoundTrip(_ rtt: Double) throws -> Bool {
        guard rtt.isFinite, rtt >= 0 else { throw SyncError("Invalid live round-trip measurement") }
        guard rtt <= 1 else {
            pauseLocalLive("Waiting for fresh desktop state · paused")
            return true
        }
        return false
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
                let duration = try await audio.load(file, deck: index, libraryTrackID: track.id)
                try Task.checkCancellation()
                decks[index].track = track; decks[index].title = track.title
                decks[index].artist = track.artist ?? ""; decks[index].duration = duration
                let preview = await repository.preview(track)
                try Task.checkCancellation()
                decks[index].waveform = preview
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
            defer { busy = false; syncProgress = nil }
            do {
                snapshot = try await syncWake.duringTransfer {
                    try await repository.sync(connection, allAudio: allAudio) { [weak self] progress in
                        await self?.setSyncProgress(progress)
                    }
                }
                downloaded = await repository.downloadedIds()
                status = "\(snapshot?.tracks.count ?? 0) tracks synced · \(downloaded.count) downloaded"
            } catch is CancellationError {
                snapshot = await repository.cachedSnapshot()
                downloaded = await repository.downloadedIds()
                status = "Sync cancelled. Complete cached files kept. Retry when ready."
            }
            catch {
                // A snapshot may have landed before a preview failed. Show that truth, with the error.
                snapshot = await repository.cachedSnapshot()
                downloaded = await repository.downloadedIds()
                self.error = error.localizedDescription
                status = "Sync incomplete. Complete cached files kept. Retry when ready."
            }
        }
    }
    private func setSyncProgress(_ progress: LibrarySyncProgress) { syncProgress = progress }
    func preview(_ track: LibraryTrack) async -> PreviewWaveform? { await repository?.preview(track) }
    func cancelWork() { task?.cancel() }
    var pairedOrigin: String? { connection?.baseURL.absoluteString }
    var syncConnection: DesktopConnection? { connection }
    private(set) var feedbackActions: [[String: Any]] = []
    func noteFeedbackAction(_ action: String, deck: Int? = nil, value: Double? = nil, slot: Int? = nil) {
        let now = Date().timeIntervalSince1970
        var event: [String: Any] = ["at": now, "action": action]
        if let deck { event["deck"] = deck }
        if let value, value.isFinite { event["value"] = value }
        if let slot { event["slot"] = slot }
        if let last = feedbackActions.last, last["action"] as? String == action, last["deck"] as? Int == deck,
           let at = last["at"] as? Double, now - at < 0.1 { feedbackActions.removeLast() }
        feedbackActions.append(event)
        feedbackActions = Array(feedbackActions.filter { now - ($0["at"] as? Double ?? 0) <= 180 }.suffix(1024))
    }
    var feedbackQueueRoot: URL { root.appendingPathComponent("feedback-queue", isDirectory: true) }
    func forgetDesktop() {
        stopLocalLive()
        task?.cancel()
        do { if let pairedOrigin { try PairingKeychain.save(nil, origin: pairedOrigin) }; connection = nil; status = "Desktop forgotten on this iPhone. Offline tracks kept." }
        catch { self.error = error.localizedDescription }
    }
    /// Acceptance means the request was queued, not that asynchronous decoding succeeded.
    /// Refused requests keep the browser and its search focus in place.
    @discardableResult func load(_ track: LibraryTrack, deck: Int) -> Bool {
        noteFeedbackAction("load-request", deck: deck, value: Double(track.id))
        guard !liveListening else { error = "Stop local live before loading tracks"; return false }
        guard decks.indices.contains(deck) else { error = "Choose a valid deck"; return false }
        guard let repository else { error = "The offline library is still opening. Try again shortly."; return false }
        guard let audio else { error = "The audio engine is unavailable. Reopen manaDJ and try again."; return false }
        guard track.audioRev != nil else { error = "Track has no downloadable audio revision. Sync the desktop library again."; return false }
        guard downloaded.contains(track.id) || connection != nil else {
            error = "This track is not downloaded. Connect to the desktop first."
            return false
        }
        let previousLoad = audio.state(deck).load
        deckLoads[deck]?.cancel()
        let loadID = UUID(); deckLoadIDs[deck] = loadID
        decks[deck].loading = true
        deckLoads[deck] = Task {
            defer { if deckLoadIDs[deck] == loadID { decks[deck].loading = false; deckLoads[deck] = nil } }
            do {
                let url = try await repository.audio(track, connection: connection)
                try Task.checkCancellation()
                guard deckLoadIDs[deck] == loadID else { return }
                let duration = try await audio.load(url, deck: deck, libraryTrackID: track.id)
                try Task.checkCancellation()
                guard deckLoadIDs[deck] == loadID else { return }
                let grid = track.grid
                audio.grid(deck, bpm: grid?.tempoChanges.first?.bpm ?? track.bpm ?? 0, anchor: grid?.anchorTime ?? 0)
                if let cue = track.mainCue { audio.send(MDJCueSetAt, deck: deck, value: cue) }
                for cue in track.hotCues where (0..<8).contains(cue.slot) { audio.send(MDJHotCueSetAt, deck: deck, value: cue.time, slot: cue.slot) }
                decks[deck].title = track.title
                decks[deck].artist = track.artist ?? "Unknown artist"
                decks[deck].track = track
                decks[deck].duration = duration // Decoded audio is the authoritative timeline, not stale catalog metadata.
                decks[deck].waveform = nil
                decks[deck].waveformNotice = "Loading full waveform"
                // Audio readiness and its haptic do not wait on remote detail.
                decks[deck].loading = false
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                do {
                    let detail = try await repository.detail(track, connection: connection)
                    try Task.checkCancellation()
                    guard deckLoadIDs[deck] == loadID else { return }
                    decks[deck].waveform = detail
                    decks[deck].waveformNotice = detail == nil ? "Full waveform not generated on desktop" : nil
                } catch {
                    guard !Task.isCancelled, deckLoadIDs[deck] == loadID else { return }
                    decks[deck].waveformNotice = "Full waveform unavailable locally. Audio remains playable."
                }
                // Never magnify the 256-bin browser preview into a performance lane.
                let ids = await repository.downloadedIds()
                guard deckLoadIDs[deck] == loadID else { return }
                downloaded = ids
            } catch {
                guard !Task.isCancelled, deckLoadIDs[deck] == loadID else { return }
                loadFailed(error, deck: deck, previousLoad: previousLoad)
            }
        }
        return true
    }
    func importFile(_ url: URL, deck: Int, title: String? = nil, artist: String? = nil) {
        guard !liveListening, decks.indices.contains(deck), let audio else { return }
        let previousLoad = audio.state(deck).load
        deckLoads[deck]?.cancel()
        let loadID = UUID(); deckLoadIDs[deck] = loadID
        decks[deck].loading = true
        deckLoads[deck] = Task {
            defer { if deckLoadIDs[deck] == loadID { decks[deck].loading = false; deckLoads[deck] = nil } }
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
                try Task.checkCancellation()
                guard deckLoadIDs[deck] == loadID else { return }
                let duration = try await audio.load(copied, deck: deck)
                try Task.checkCancellation()
                guard deckLoadIDs[deck] == loadID else { return }
                decks[deck].title = title ?? url.deletingPathExtension().lastPathComponent
                decks[deck].artist = artist ?? "Imported from Files · no saved grid"
                decks[deck].track = nil
                decks[deck].duration = duration
                decks[deck].waveform = nil
                decks[deck].waveformNotice = nil
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            } catch {
                guard !Task.isCancelled, deckLoadIDs[deck] == loadID else { return }
                loadFailed(error, deck: deck, previousLoad: previousLoad)
            }
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
        noteFeedbackAction(decks[deck].engine.playing ? "pause" : "play", deck: deck)
        do { try audio?.start(); audio?.send(decks[deck].engine.playing ? MDJPause : MDJPlay, deck: deck) }
        catch { self.error = error.localizedDescription }
    }
    func set(_ op: MDJOp, _ deck: Int, _ value: Double, slot: Int = 0) {
        let operations = ["play", "pause", "cue-down", "cue-up", "hotcue-down", "hotcue-up", "hotcue-set", "hotcue-clear", "seek", "fader", "trim", "crossfade", "pitch", "bend", "pfl", "cue-mix", "eq", "beat-jump", "loop-toggle", "loop-resize", "loop-preset", "quantize", "cue-set-at", "hotcue-set-at", "key-lock", "heard-latency"]
        let index = Int(op.rawValue)
        noteFeedbackAction(operations.indices.contains(index) ? operations[index] : "mix-op-" + String(index), deck: deck, value: value, slot: slot)
        do {
            if op == MDJCueDown || op == MDJHotCueDown { try audio?.start() }
            audio?.send(op, deck: deck, value: value, slot: slot)
        } catch { self.error = error.localizedDescription }
    }
    func filter(_ deck: Int, position: Double) {
        noteFeedbackAction("filter", deck: deck, value: position)
        audio?.filter(deck, position: position)
    }
    func toggleRecording() {
        noteFeedbackAction(recording ? "master-record-stop" : "master-record-start")
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

/// Only active foreground library transfers suppress automatic display sleep.
/// Manual lock/backgrounding is not background-transfer support.
@MainActor final class SyncWakeScope {
    private var users = 0
    private var saved: Bool?
    private var active = true
    private let read: () -> Bool
    private let write: (Bool) -> Void
    init(read: @escaping () -> Bool = { UIApplication.shared.isIdleTimerDisabled },
         write: @escaping (Bool) -> Void = { UIApplication.shared.isIdleTimerDisabled = $0 }) {
        self.read = read; self.write = write
    }
    func setActive(_ value: Bool) { active = value; update() }
    private func update() {
        if active && users > 0 {
            if saved == nil { saved = read(); write(true) }
        } else if let previous = saved { saved = nil; write(previous) }
    }
    func duringTransfer<T>(_ body: @MainActor () async throws -> T) async rethrows -> T {
        users += 1; update()
        defer { users -= 1; update() }
        return try await body()
    }
}
