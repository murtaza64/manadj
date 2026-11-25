#if canImport(CryptoKit) && canImport(JavaScriptCore)
import Foundation

public enum NativeTransportError: Error { case invalid, http(Int), oversized, quota, expired }

/// A manually started foreground test loop. Owner authentication stays in native
/// app closure. No cookie auth, redirects, enrollment or background guarantee.
@MainActor public final class NativeMetadataSync {
    public private(set) var running = false
    public private(set) var lastError: String?
    public private(set) var requests = 0
    public private(set) var published = 0
    public private(set) var received = 0
    private let replica: NativeMetadataReplica
    private let group: UUID
    private let origin: UUID
    private let origins: [UUID]
    private let token: @MainActor () async throws -> String
    private let http: URLSession
    private var task: Task<Void, Never>?
    private var expiresAt = Date.distantPast
    private var generation = UUID()
    private var ticking = false
    private var verifiedOwnPrefix = 0
    // Keep fixed resource separate from caller-provided payloads.
    private let base: URL
    public static let requestBudget = 1800

    public convenience init(replica: NativeMetadataReplica, group: UUID, origin: UUID, origins: [UUID],
                token: @escaping @MainActor () async throws -> String) throws {
        try self.init(replica: replica, group: group, origin: origin, origins: origins, token: token, endpoint: CloudLibraryOAuth.resource)
    }

    // Internal generated-network qualification seam. The app cannot supply an
    // alternate endpoint through its public initializer or provisioning JSON.
    init(replica: NativeMetadataReplica, group: UUID, origin: UUID, origins: [UUID],
         token: @escaping @MainActor () async throws -> String, endpoint: URL) throws {
        guard endpoint == CloudLibraryOAuth.resource || (endpoint.scheme == "http" && endpoint.host == "127.0.0.1" && endpoint.path.isEmpty && endpoint.user == nil && endpoint.password == nil && endpoint.query == nil && endpoint.fragment == nil) else { throw NativeTransportError.invalid }
        base = endpoint
        guard origins.contains(origin), Set(origins).count == origins.count, (2...3).contains(origins.count) else { throw NativeTransportError.invalid }
        self.replica = replica; self.group = group; self.origin = origin; self.origins = origins; self.token = token
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil; config.urlCredentialStorage = nil; config.urlCache = nil
        config.timeoutIntervalForRequest = 15; config.timeoutIntervalForResource = 20
        http = URLSession(configuration: config, delegate: NativeSyncNoRedirect(), delegateQueue: nil)
    }

    /// Start only from a user control after owner authorization and provisioning.
    /// Starting does not reset request count and cannot bypass the process budget.
    public func start() {
        guard !running else { return }
        generation = UUID(); let epoch = generation
        expiresAt = Date().addingTimeInterval(4 * 3600); running = true; lastError = nil
        task = Task { [weak self] in
            var failures = 0
            while let self, !Task.isCancelled, self.running, self.generation == epoch {
                do {
                    try await self.tick()
                    failures = 0
                } catch is CancellationError { break }
                catch {
                    self.lastError = String(describing: error)
                    failures += 1
                    if case NativeTransportError.quota = error { break }
                    if case NativeTransportError.expired = error { break }
                    if case NativeTransportError.http(let status) = error, [401,403,409,429].contains(status) { break }
                }
                let delay = failures == 0 ? 30 : min(300, 10 * (1 << min(5, failures - 1)))
                do { try await Task.sleep(for: .seconds(delay)) } catch { break }
            }
            guard let self, self.generation == epoch else { return }
            self.running = false
        }
    }

    public func stop() {
        generation = UUID(); running = false; task?.cancel(); task = nil
        http.getAllTasks { tasks in tasks.forEach { $0.cancel() } }
    }

    /// Exposed for explicit Sync now inside an already-started bounded session.
    public func tick() async throws {
        guard running, Date() < expiresAt else { throw NativeTransportError.expired }
        guard !ticking else { return }; ticking = true; defer { ticking = false }
        let epoch = generation
        let head = try await call(origin: origin, suffix: "head", epoch: epoch)
        guard let n = head["sequence"] as? Int, n >= 0, n <= replica.cursor(origin) else { throw NativeTransportError.invalid }
        // Recheck entire retained own prefix before publishing across a fresh
        // connection. Bounded page plus stop-on-fork, never trust a bare head.
        guard n >= verifiedOwnPrefix else { throw NativeReplicaError.fork }
        var after = max(0, verifiedOwnPrefix - 1)
        while after < n {
            let page = try await read(origin: origin, after: after, epoch: epoch)
            let own = try replica.outgoing(after: after, limit: 4)
            guard !page.isEmpty, page.count <= own.count else { throw NativeTransportError.invalid }
            for (remote, expected) in zip(page, own) {
                guard try JSONSerialization.jsonObject(with: remote) as? NSDictionary == JSONSerialization.jsonObject(with: expected) as? NSDictionary else { throw NativeReplicaError.fork }
            }
            guard let last = page.last, let b = (try JSONSerialization.jsonObject(with: last) as? [String: Any])?["body"] as? [String: Any],
                  let seq = b["sequence"] as? Int, seq > after, seq <= n else { throw NativeTransportError.invalid }
            after = seq
        }
        verifiedOwnPrefix = n
        for packet in try replica.outgoing(after: n, limit: 4) {
            let envelope = try JSONSerialization.jsonObject(with: packet) as! [String: Any]
            let body = envelope["body"] as! [String: Any], seq = body["sequence"] as! Int
            let bytes = try JSONSerialization.data(withJSONObject: ["packet": envelope, "expectedPreviousSequence": seq - 1])
            let receipt = try await call(origin: origin, suffix: "operations/\(seq)", method: "PUT", body: bytes, epoch: epoch)
            guard receipt["sequence"] as? Int == seq, receipt["stored"] as? Bool == true else { throw NativeTransportError.invalid }
            published += 1
        }
        for other in origins where other != origin {
            for packet in try await read(origin: other, after: replica.cursor(other), epoch: epoch) {
                do { try replica.receive(packet); received += 1 }
                catch NativeReplicaError.missingParent { break }
            }
        }
        lastError = nil
    }

    private func read(origin: UUID, after: Int, epoch: UUID) async throws -> [Data] {
        let page = try await call(origin: origin, suffix: "operations?after=\(after)&limit=4", epoch: epoch)
        guard let packets = page["operations"] as? [[String: Any]], packets.count <= 4,
              let next = page["nextAfter"] as? Int, page["more"] is Bool else { throw NativeTransportError.invalid }
        var expected = after
        let bytes = try packets.map { packet -> Data in
            expected += 1
            guard let b = packet["body"] as? [String: Any], b["sequence"] as? Int == expected,
                  b["origin_id"] as? String == origin.uuidString.lowercased() else { throw NativeTransportError.invalid }
            return try JSONSerialization.data(withJSONObject: packet)
        }
        guard next == expected else { throw NativeTransportError.invalid }
        return bytes
    }

    private func call(origin: UUID, suffix: String, method: String = "GET", body: Data? = nil, epoch: UUID) async throws -> [String: Any] {
        guard running, generation == epoch, !Task.isCancelled else { throw CancellationError() }
        guard Date() < expiresAt else { throw NativeTransportError.expired }
        guard requests < Self.requestBudget else { throw NativeTransportError.quota }
        let access = try await token()
        guard generation == epoch, !Task.isCancelled else { throw CancellationError() }
        guard !access.isEmpty, access.utf8.count <= 16384 else { throw NativeTransportError.invalid }
        let url = URL(string: base.absoluteString + "/v1/sync/" + group.uuidString.lowercased() + "/origins/" + origin.uuidString.lowercased() + "/" + suffix)!
        var request = URLRequest(url: url); request.httpMethod = method; request.httpBody = body
        request.setValue("Bearer " + access, forHTTPHeaderField: "Authorization")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        requests += 1
        let (stream, response) = try await http.bytes(for: request)
        guard let http = response as? HTTPURLResponse else { throw NativeTransportError.invalid }
        guard [200,201].contains(http.statusCode) else { throw NativeTransportError.http(http.statusCode) }
        var data = Data()
        for try await byte in stream {
            guard data.count < 256 * 1024 else { throw NativeTransportError.oversized }
            data.append(byte)
        }
        guard generation == epoch, !Task.isCancelled else { throw CancellationError() }
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw NativeTransportError.invalid }
        return object
    }
}
private final class NativeSyncNoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}
#endif
