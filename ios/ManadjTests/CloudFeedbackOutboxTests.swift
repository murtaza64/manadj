import XCTest
import ManadjCore
@testable import Manadj

final class CloudFeedbackOutboxTests: XCTestCase {
    @MainActor func testFreezeReadbackDedupAndChangedContentRefusal() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = CloudFeedbackOutbox(directory: root)
        var draft = FeedbackDraft(kind: .bug, title: "Synthetic report")
        let report = try CloudFeedbackReport(reviewed: draft)
        let entry = try store.freeze(report)
        let retry = try store.freeze(report)
        XCTAssertEqual(entry.body, retry.body)
        XCTAssertEqual(entry.sha256, retry.sha256)
        XCTAssertEqual(entry.sha256.count, 64)
        let restored = try XCTUnwrap(store.pending().first)
        XCTAssertEqual(entry.body, restored.body)
        XCTAssertNoThrow(try store.validate(restored))
        draft.title = "Changed content"
        XCTAssertThrowsError(try store.freeze(CloudFeedbackReport(reviewed: draft)))
        XCTAssertEqual(try store.pending().count, 1)
        XCTAssertEqual(try store.pending().first?.body, entry.body)
        try store.discard(entry)
        XCTAssertTrue(try store.pending().isEmpty)
    }
    @MainActor func testReceiptRemovesOnlyMatchingEntry() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = CloudFeedbackOutbox(directory: root)
        let one = try store.freeze(CloudFeedbackReport(reviewed: FeedbackDraft(kind: .bug, title: "Synthetic first")))
        let two = try store.freeze(CloudFeedbackReport(reviewed: FeedbackDraft(kind: .feature, title: "Synthetic second")))
        let body = try JSONSerialization.data(withJSONObject: ["version": 2, "id": one.id, "received": true, "repeated": false, "sha256": one.sha256, "receivedAt": "2026-11-23T00:00:00.000Z", "retainedUntil": "2026-12-23T00:00:00.000Z"])
        let receipt = try CloudFeedbackReceipt.confirmed(body: body, status: 201, reportID: one.id, digest: one.sha256)
        XCTAssertThrowsError(try store.confirmed(receipt, entry: two))
        XCTAssertEqual(try store.pending().count, 2)
        try store.confirmed(receipt, entry: one)
        XCTAssertEqual(try store.pending().map(\.id), [two.id])
    }
    @MainActor func testDiskFailureAndUntrustedStoredDestinationFailClosed() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try Data("not a directory".utf8).write(to: root)
        let store = CloudFeedbackOutbox(directory: root)
        XCTAssertThrowsError(try store.freeze(CloudFeedbackReport(reviewed: FeedbackDraft(kind: .bug, title: "Synthetic"))))
        let invalid = CloudFeedbackOutbox.Entry(id: "../../other", origin: "https://example.invalid", sha256: "invalid", body: Data(), savedAt: Date())
        XCTAssertThrowsError(try store.validate(invalid))
        XCTAssertThrowsError(try store.discard(invalid))
    }
}
