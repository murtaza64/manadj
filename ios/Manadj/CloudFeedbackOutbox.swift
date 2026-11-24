import CryptoKit
import Foundation
import ManadjCore

/// Main-actor disk outbox: frozen cloud-only bytes, pinned destination and digest.
/// It never contains OAuth credentials or automatically sends on launch/sign-in.
@MainActor
final class CloudFeedbackOutbox {
    struct Entry: Codable, Identifiable {
        let id: String
        let origin: String
        let sha256: String
        let body: Data
        let savedAt: Date
    }
    let directory: URL
    init(directory: URL) { self.directory = directory }
    func pending() throws -> [Entry] {
        guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }.map { try JSONDecoder().decode(Entry.self, from: Data(contentsOf: $0)) }
            .sorted { $0.savedAt < $1.savedAt }
    }
    func freeze(_ report: CloudFeedbackReport) throws -> Entry {
        let body = try report.frozenBytes()
        let digest = Self.digest(body)
        let existing = try pending()
        if let prior = existing.first(where: { $0.id == report.id }) {
            guard prior.body == body, prior.sha256 == digest, prior.origin == CloudFeedbackOAuth.resource.absoluteString else {
                throw FeedbackFailure("A different frozen report already uses this ID. Review the saved report; nothing was replaced")
            }
            return prior
        }
        guard existing.count < 20 else { throw FeedbackFailure("20 cloud reports are already saved. Review or discard them before sending another") }
        let entry = Entry(id: report.id, origin: CloudFeedbackOAuth.resource.absoluteString, sha256: digest, body: body, savedAt: Date())
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(entry).write(to: path(entry.id), options: [.atomic, .completeFileProtection])
        return entry
    }
    func confirmed(_ receipt: CloudFeedbackReceipt, entry: Entry) throws {
        try validate(entry)
        guard receipt.id == entry.id, receipt.sha256 == entry.sha256 else { throw FeedbackFailure("Receipt identity mismatch; report kept") }
        try FileManager.default.removeItem(at: path(entry.id))
    }
    func discard(_ entry: Entry) throws { try validate(entry); try FileManager.default.removeItem(at: path(entry.id)) }
    func validate(_ entry: Entry) throws {
        guard UUID(uuidString: entry.id)?.uuidString.lowercased() == entry.id,
              entry.origin == CloudFeedbackOAuth.resource.absoluteString,
              Self.digest(entry.body) == entry.sha256,
              entry.body.count <= 8 * 1024 * 1024 else { throw FeedbackFailure("Saved cloud report failed its destination or integrity check") }
    }
    private func path(_ id: String) -> URL { directory.appendingPathComponent(id + ".json") }
    private static func digest(_ body: Data) -> String { SHA256.hash(data: body).map { String(format: "%02x", $0) }.joined() }
}

extension CloudFeedbackSession {
    struct CloudStatus: Decodable { let version: Int; let authenticated: Bool; let enabled: Bool }
    func verifyOwnerSession() async throws -> Bool {
        var request = URLRequest(url: CloudFeedbackOAuth.resource.appendingPathComponent("v2/status"))
        request.setValue("Bearer " + (try await accessToken()), forHTTPHeaderField: "Authorization")
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil; config.urlCredentialStorage = nil; config.urlCache = nil
        config.timeoutIntervalForRequest = 20; config.timeoutIntervalForResource = 30
        let session = URLSession(configuration: config, delegate: FeedbackReceiptNoRedirects(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let (data, response) = try await session.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200, data.count <= 4096,
              let value = try? JSONDecoder().decode(CloudStatus.self, from: data),
              value.version == 2, value.authenticated else { throw FeedbackFailure("Owner session not confirmed. No report sent") }
        return value.enabled
    }

    /// Explicit Send only. Unknown network outcome keeps original frozen bytes.
    func send(_ entry: CloudFeedbackOutbox.Entry, store: CloudFeedbackOutbox) async throws -> CloudFeedbackReceipt {
        try store.validate(entry)
        let bearer = try await accessToken()
        var request = URLRequest(url: CloudFeedbackOAuth.resource.appendingPathComponent("v2/feedback"))
        request.httpMethod = "POST"; request.httpBody = entry.body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer " + bearer, forHTTPHeaderField: "Authorization")
        let receipt = try await receiptRequest(request, entry: entry, lookup: false)
        try store.confirmed(receipt, entry: entry)
        return receipt
    }
    /// Explicit recovery after a lost response, returns no private report body.
    func checkReceipt(_ entry: CloudFeedbackOutbox.Entry, store: CloudFeedbackOutbox) async throws -> CloudFeedbackReceipt {
        try store.validate(entry)
        var request = URLRequest(url: CloudFeedbackOAuth.resource.appendingPathComponent("v2/feedback/\(entry.id)/receipt"))
        request.setValue("Bearer " + (try await accessToken()), forHTTPHeaderField: "Authorization")
        let receipt = try await receiptRequest(request, entry: entry, lookup: true)
        try store.confirmed(receipt, entry: entry)
        return receipt
    }
    private func receiptRequest(_ request: URLRequest, entry: CloudFeedbackOutbox.Entry, lookup: Bool) async throws -> CloudFeedbackReceipt {
        // Separate bounded session with redirects refused, tokens never leave pinned resource.
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil; config.urlCredentialStorage = nil; config.urlCache = nil
        config.timeoutIntervalForRequest = 20; config.timeoutIntervalForResource = 30
        let session = URLSession(configuration: config, delegate: FeedbackReceiptNoRedirects(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        do {
            let (data, response) = try await session.data(for: request)
            guard let response = response as? HTTPURLResponse else { throw FeedbackFailure("No private cloud receipt") }
            return try CloudFeedbackReceipt.confirmed(body: data, status: response.statusCode, reportID: entry.id, digest: entry.sha256, lookup: lookup)
        } catch {
            throw FeedbackFailure("No confirmed cloud receipt. Frozen report kept on this iPhone; sign in and review before retrying or checking its receipt")
        }
    }
}
private final class FeedbackReceiptNoRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
