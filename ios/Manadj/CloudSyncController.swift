import Foundation
import CryptoKit
import Security
import Combine
import ManadjCore

/// Foreground experimental flow. Provisioning contains public pins only, no
/// bearer/private seed. It never enables cloud or imports personal data itself.
@MainActor final class CloudSyncController: ObservableObject {
    struct Provisioning: Codable {
        let version: Int
        let group: UUID
        let origin: UUID
        let members: [Member]
        let bindings: [NativeTrackBinding]
    }
    struct Member: Codable { let origin: UUID; let publicKey: String }
    @Published private(set) var status = "Private sync not configured"
    @Published private(set) var configured = false
    @Published private(set) var running = false
    @Published private(set) var conflicts = 0
    @Published private(set) var history = "No signed session history"
    var captureStart: (() throws -> Void)?
    var captureStop: ((Bool) async -> Void)?
    private var stopping = false
    private var journal: SessionEventJournal?
    private var libraryIdentity = ""
    private let auth = CloudLibrarySession()
    private var replica: NativeMetadataReplica?
    private var sync: NativeMetadataSync?
    private var poll: Task<Void, Never>?
    private let root: URL
    private var bindings: [NativeTrackBinding] = []
    private var verifiedRevisions: [Int: String] = [:]
    var selectedTrackIDs: Set<Int> { Set(bindings.map(\.localID)) }
    private func revision(_ track: LibraryTrack) -> String { "\(track.audioRev ?? "")|\(track.fileSizeBytes ?? -1)|\(track.fileName)" }
    var projectionChanged: (() -> Void)?

    init(root: URL) { self.root = root }

    /// One locally generated device identity, stored ThisDeviceOnly. No secrets
    /// go into provisioning files or logs. Does not contact any service.
    func publicIdentity() throws -> (UUID, Data) {
        let key = try localKey()
        let id: UUID
        if let data = try keychainRead("origin"), let text = String(data: data, encoding: .utf8), let saved = UUID(uuidString: text) { id = saved }
        else { id = UUID(); try keychainWrite(Data(id.uuidString.lowercased().utf8), account: "origin") }
        return (id, key.publicKey.rawRepresentation)
    }

    /// Invoked only by explicit file import in the experimental UI. Must match
    /// downloaded local audio bytes, never only legacy snapshot stat revisions.
    func configure(_ data: Data, snapshot: Snapshot, store: LibraryStore) async throws {
        guard !running, data.count <= 64 * 1024 else { throw NativeReplicaError.invalid }
        let config = try JSONDecoder().decode(Provisioning.self, from: data)
        let (id, _) = try publicIdentity()
        guard config.version == 1, config.origin == id, (2...3).contains(config.members.count), config.bindings.count <= 25 else { throw NativeReplicaError.invalid }
        var pins: [UUID: Curve25519.Signing.PublicKey] = [:]
        for member in config.members {
            guard pins[member.origin] == nil, let bytes = Data(base64Encoded: member.publicKey) else { throw NativeReplicaError.invalid }
            pins[member.origin] = try Curve25519.Signing.PublicKey(rawRepresentation: bytes)
        }
        for binding in config.bindings {
            guard let track = snapshot.tracks.first(where: { $0.id == binding.localID }), store.hasAudio(track),
                  let file = store.audioFile(track) else { throw NativeReplicaError.unresolvedBinding }
            let expectedHash = binding.contentSHA256, expectedSize = binding.byteLength
            let valid = try await Task.detached(priority: .userInitiated) {
                let handle = try FileHandle(forReadingFrom: file); defer { try? handle.close() }
                var hash = SHA256(), count = 0
                while let chunk = try handle.read(upToCount: 1024 * 1024), !chunk.isEmpty {
                    try Task.checkCancellation(); count += chunk.count; hash.update(data: chunk)
                }
                let actual = hash.finalize().map { String(format: "%02x", $0) }.joined()
                return actual == expectedHash && count == expectedSize
            }.value
            guard valid else { throw NativeReplicaError.unresolvedBinding }
        }
        let next = try NativeMetadataReplica(file: root.appendingPathComponent("native-replica.json"), group: config.group,
            origin: id, key: localKey(), members: pins, bindings: config.bindings)
        let transport = try NativeMetadataSync(replica: next, group: config.group, origin: id,
            origins: config.members.map(\.origin), token: { [weak self] in
                guard let self else { throw CancellationError() }; return try await self.auth.accessToken()
            })
        try SessionEventJournal.durableWrite(data, root.appendingPathComponent("public-provisioning.json"))
        replica = next; sync = transport; bindings = config.bindings
        verifiedRevisions = Dictionary(uniqueKeysWithValues: snapshot.tracks.filter { t in config.bindings.contains { $0.localID == t.id } }.map { ($0.id, revision($0)) })
        libraryIdentity = config.group.uuidString.lowercased() + ":" + config.origin.uuidString.lowercased()
        journal = try SessionEventJournal(file: root.appendingPathComponent("session-journal.json"))
        configured = true
        status = "Configured. Selected downloaded tracks only. Cloud start is disabled until test activation."
    }

    func captureJournal() -> (SessionEventJournal, String)? {
        guard let journal else { return nil }; return (journal, libraryIdentity)
    }

    func signIn() async {
        do { try await auth.signIn(); status = "Signed in for private library sync" }
        catch { status = "Sign-in stopped: \(error.localizedDescription)" }
    }
    func start() {
        guard !stopping, CloudLibraryOAuth.enabled, let sync else { status = "Private cloud test is not enabled"; return }
        do { try captureStart?() } catch { status = "Capture not started: " + error.localizedDescription; return }
        sync.start(); running = sync.running
        poll?.cancel()
        poll = Task { [weak self] in
            while let self, !Task.isCancelled {
                self.running = sync.running
                if let journal = self.journal, let replica = self.replica {
                    do {
                        try replica.captureHistory(await journal.all(), libraryIdentity: self.libraryIdentity)
                        let summary = try replica.historySummary()
                        self.history = "Signed history: \(summary.sessions) sessions, \(summary.chunks) chunks, \(summary.active) active. Replay unavailable."
                    } catch { self.stop(incomplete: true); self.status = "History sync stopped: " + error.localizedDescription; break }
                }
                self.status = sync.lastError.map { "Sync paused/retrying: " + $0 } ?? "Sync active. Sent \(sync.published), received \(sync.received), requests \(sync.requests)/\(NativeMetadataSync.requestBudget)"
                self.projectionChanged?()
                if !sync.running { await self.captureStop?(true); break }
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }
    func stop(incomplete: Bool = false) {
        guard !stopping else { return }
        stopping = true; poll?.cancel(); poll = nil; running = false
        status = "Closing session and keeping pending changes..."
        Task {
            await captureStop?(incomplete)
            do {
                if let journal, let replica {
                    try replica.captureHistory(await journal.all(), libraryIdentity: libraryIdentity)
                    if sync?.running == true { try await sync?.tick() }
                }
                status = "Stopped. Pending changes kept. Reopen app before another capture."
            } catch { status = "Stopped. Pending history kept locally: " + error.localizedDescription }
            sync?.stop(); stopping = false
        }
    }
    func edit(localID: Int, value: LibraryEditValue) throws {
        guard let replica else { throw NativeReplicaError.invalid }
        try replica.edit(localID: localID, value: value); projectionChanged?()
    }
    func project(_ snapshot: Snapshot) throws -> Snapshot {
        guard let replica else { return snapshot }
        var result = snapshot, conflicts = 0
        for index in result.tracks.indices where bindings.contains(where: { $0.localID == result.tracks[index].id }) {
            let id = result.tracks[index].id
            guard verifiedRevisions[id] == revision(result.tracks[index]) else {
                stop(); status = "Selected audio changed. Reimport group to verify content before continuing."
                continue
            }
            for field in ["title", "main_cue"] {
                let heads = try replica.values(localID: id, field: field)
                if heads.count > 1 { conflicts += 1; continue }
                guard let value = heads.first?["value"] else { continue }
                if field == "title", let title = value as? String { result.tracks[index].title = title }
                if field == "main_cue" { result.tracks[index].mainCue = (value as? NSNumber)?.doubleValue }
            }
        }
        self.conflicts = conflicts
        return result
    }

    private func localKey() throws -> Curve25519.Signing.PrivateKey {
        if let bytes = try keychainRead("private-seed") { return try Curve25519.Signing.PrivateKey(rawRepresentation: bytes) }
        let key = Curve25519.Signing.PrivateKey()
        try keychainWrite(key.rawRepresentation, account: "private-seed"); return key
    }
    private func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "earth.murtaza.manadj.ios.sync.identity", kSecAttrAccount as String: account]
    }
    private func keychainRead(_ account: String) throws -> Data? {
        var q = query(account); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?; let code = SecItemCopyMatching(q as CFDictionary, &result)
        if code == errSecItemNotFound { return nil }
        guard code == errSecSuccess, let data = result as? Data else { throw NativeReplicaError.persistence }; return data
    }
    private func keychainWrite(_ bytes: Data, account: String) throws {
        var q = query(account); q[kSecValueData as String] = bytes; q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        guard SecItemAdd(q as CFDictionary, nil) == errSecSuccess else { throw NativeReplicaError.persistence }
    }
}
