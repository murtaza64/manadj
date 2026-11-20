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
    @Published var quantize = false
    @Published var waveSeconds = 12.0
    @Published var splitOutput = false
    @Published var cueMix = 0.0
    private(set) var audio: NativeAudio?
    private var repository: LibraryRepository?
    private var connection: DesktopConnection?
    private var task: Task<Void, Never>?
    private var clock: Task<Void, Never>?
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
            self?.status = message
            self?.recording = false
            self?.refreshRecordings()
        }
        clock = Task { [weak self] in
            while !Task.isCancelled {
                self?.poll()
                try? await Task.sleep(for: .milliseconds(33))
            }
        }
        Task {
            await openCache()
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--performance-ui-fixture") { await installPerformanceFixture() }
            #endif
        }
        refreshRecordings()
    }
    deinit { clock?.cancel(); task?.cancel() }
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
        var updated = decks
        for index in 0..<4 {
            updated[index].engine = audio.state(index)
            let state = updated[index].engine
            if !updated[index].loading, state.status & 3 == 3, engineErrors.insert(state.load).inserted {
                error = "Deck \(Ink.deckName(index)) audio decoding failed. Reload this track."
            }
        }
        decks = updated
        if recording && audio.recordingState != 1 {
            recording = false
            if audio.recordingState == 4 { error = "Recording stopped with error \(audio.recordingError). The partial file was not marked saved." }
            refreshRecordings()
        }
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
        task?.cancel()
        do { if let pairedOrigin { try PairingKeychain.save(nil, origin: pairedOrigin) }; connection = nil; status = "Desktop forgotten on this iPhone. Offline tracks kept." }
        catch { self.error = error.localizedDescription }
    }
    /// Acceptance means the request was queued, not that asynchronous decoding succeeded.
    /// Refused requests keep the browser and its search focus in place.
    @discardableResult func load(_ track: LibraryTrack, deck: Int) -> Bool {
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
        guard let audio, !decks[deck].loading else { return }
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
    func set(_ op: MDJOp, _ deck: Int, _ value: Double, slot: Int = 0) {
        do {
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
