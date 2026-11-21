import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct SyncError: Error, LocalizedError, Sendable {
    public let message: String
    public let status: Int?
    public var errorDescription: String? { message }
    public init(_ message: String, status: Int? = nil) { self.message = message; self.status = status }
}

/// One explicitly selected desktop. Never sends pairing credentials to redirects.
public struct DesktopConnection: Sendable {
    public let baseURL: URL
    public var pairCode: String?
    public var deviceToken: String?
    public var deviceId: String?
    public var deviceName: String?
    public init(url: URL, pairCode: String? = nil, deviceToken: String? = nil, deviceId: String? = nil, deviceName: String? = nil) throws {
        guard ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/" else { throw SyncError("Enter a desktop origin, for example http://192.168.1.20:48127") }
        baseURL = url
        self.pairCode = pairCode; self.deviceToken = deviceToken
        self.deviceId = deviceId; self.deviceName = deviceName
    }
    public func request(path: String, method: String = "GET", body: Data? = nil, pairing: Bool = false) -> URLRequest {
        var r = URLRequest(url: baseURL.appendingPathComponent("api/\(pairing ? "device-pair" : "device-sync")\(path)"))
        r.httpMethod = method; r.httpBody = body; r.timeoutInterval = 60
        r.cachePolicy = .reloadIgnoringLocalCacheData
        if body != nil { r.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if !pairing {
            if let token = deviceToken, !token.isEmpty { r.setValue(token, forHTTPHeaderField: "X-Manadj-Device-Token") }
            else if let code = pairCode, !code.isEmpty { r.setValue(code.trimmingCharacters(in: .whitespacesAndNewlines), forHTTPHeaderField: "X-Manadj-Pair") }
            r.setValue(deviceId, forHTTPHeaderField: "X-Manadj-Device-Id")
            r.setValue(deviceName, forHTTPHeaderField: "X-Manadj-Device-Name")
        }
        return r
    }
}

private final class NoRedirect: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}

public final class SyncClient: Sendable {
    public let connection: DesktopConnection
    private let session: URLSession
    public init(_ connection: DesktopConnection) {
        self.connection = connection
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForResource = 300
        session = URLSession(configuration: configuration, delegate: NoRedirect(), delegateQueue: nil)
    }
    deinit { session.invalidateAndCancel() }
    private func check(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw SyncError("Invalid desktop response") }
        if http.statusCode == 401 { throw SyncError("Not paired, or this phone was unpaired on the desktop. Pair again.", status: 401) }
        guard (200..<300).contains(http.statusCode) else { throw SyncError("Desktop returned HTTP \(http.statusCode)", status: http.statusCode) }
    }
    public func liveState() async throws -> LiveEnvelope {
        var request = connection.request(path: "/live")
        request.timeoutInterval = 2
        let (data, response) = try await session.data(for: request)
        try check(response)
        guard data.count <= 64 * 1024 else { throw SyncError("Live state exceeds size limit") }
        return try LiveEnvelope.parse(data)
    }
    public func snapshotText() async throws -> String {
        let (data, response) = try await session.data(for: connection.request(path: "/snapshot"))
        try check(response)
        // Parse before the caller atomically replaces its last valid offline snapshot.
        let text = String(decoding: data, as: UTF8.self)
        _ = try SnapshotJson.parse(text)
        return text
    }
    public func previews(_ ids: [Int]) async throws -> [Int: Data] {
        let body = try JSONSerialization.data(withJSONObject: ["track_ids": ids])
        let (data, response) = try await session.data(for: connection.request(path: "/previews", method: "POST", body: body))
        try check(response)
        return try PreviewPack.parse(data)
    }
    /// URLSession streams to disk, never holds a whole audio download in Swift memory.
    public func downloadAudio(_ id: Int, to target: URL, expectedBytes: Int64? = nil, expectedRevision: String? = nil) async throws {
        guard id > 0 else { throw SyncError("Invalid track identity") }
        let (temporary, response) = try await session.download(for: connection.request(path: "/tracks/\(id)/audio"))
        defer { try? FileManager.default.removeItem(at: temporary) }
        try check(response)
        if let expectedRevision {
            guard (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "X-Audio-Rev") == expectedRevision else {
                throw SyncError("Audio revision changed. Sync the library again before downloading this track.")
            }
        }
        if let expectedBytes, expectedBytes > 0 {
            let size = try temporary.resourceValues(forKeys: [.fileSizeKey]).fileSize
            guard size.map(Int64.init) == expectedBytes else { throw SyncError("Audio length changed. Sync the library again.") }
        }
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        let staging = target.deletingLastPathComponent().appendingPathComponent(UUID().uuidString + ".part")
        defer { try? FileManager.default.removeItem(at: staging) }
        try FileManager.default.copyItem(at: temporary, to: staging)
        // POSIX rename atomically replaces the target on the same filesystem.
        guard rename(staging.path, target.path) == 0 else { throw SyncError("Could not save downloaded audio") }
    }

    public struct PairTicket: Sendable { public let id: String; public let matchCode: String; public let expiresSeconds: Int }
    public func requestPairing(deviceId: String, deviceName: String) async throws -> PairTicket {
        let body = try JSONSerialization.data(withJSONObject: ["device_id": deviceId, "device_name": deviceName])
        let (data, response) = try await session.data(for: connection.request(path: "/request", method: "POST", body: body, pairing: true))
        try check(response)
        guard let o = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = o["id"] as? String, let code = o["match_code"] as? String,
              id.count == 32, id.allSatisfy({ $0.isHexDigit }) else { throw SyncError("Invalid pairing ticket") }
        return PairTicket(id: id, matchCode: code, expiresSeconds: min(300, max(1, o["expires_s"] as? Int ?? 120)))
    }
    public func pollPairing(_ ticket: PairTicket) async throws -> (status: String, token: String?) {
        let (data, response) = try await session.data(for: connection.request(path: "/request/\(ticket.id)", pairing: true))
        try check(response)
        guard let o = try JSONSerialization.jsonObject(with: data) as? [String: Any], let status = o["status"] as? String else { throw SyncError("Invalid pairing response") }
        return (status, o["token"] as? String)
    }
}
