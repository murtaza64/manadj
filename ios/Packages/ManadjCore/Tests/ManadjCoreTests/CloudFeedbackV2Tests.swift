import XCTest
@testable import ManadjCore

final class CloudFeedbackV2Tests: XCTestCase {
    func testOnlyExplicitCloudFieldsAndOmittedOptionals() throws {
        let draft = FeedbackDraft(kind: .bug, title: "Private test", snapshot: ["sensitiveUnknown": "not sent"])
        let report = try CloudFeedbackReport(reviewed: draft)
        let bytes = try report.frozenBytes()
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        XCTAssertEqual(Set(value.keys), ["version", "id", "kind", "title"])
        XCTAssertEqual(value["version"] as? Int, 2)
        XCTAssertNil(value["snapshot"])
        XCTAssertEqual(try report.frozenBytes(), bytes)
    }
    func testUnicodeScalarLimitNotUTF16OrGraphemeLimit() throws {
        var draft = FeedbackDraft(kind: .feature, title: String(repeating: "😀", count: 200))
        XCTAssertNoThrow(try CloudFeedbackReport(reviewed: draft))
        draft.title += "😀"
        XCTAssertThrowsError(try CloudFeedbackReport(reviewed: draft))
        draft.title = String(repeating: "e\u{301}", count: 101)
        XCTAssertThrowsError(try CloudFeedbackReport(reviewed: draft))
    }
    func testInvalidScreenshotAndUUIDFailBeforeFreeze() throws {
        var draft = FeedbackDraft(kind: .bug, title: "Test", screenshot: "data:image/png;base64,AAAA")
        XCTAssertThrowsError(try CloudFeedbackReport(reviewed: draft))
        draft.screenshot = nil
        draft.id = try XCTUnwrap(UUID(uuidString: "12345678-1234-1234-9234-123456789abc"))
        XCTAssertThrowsError(try CloudFeedbackReport(reviewed: draft))
    }
    func testMatchingReceiptOnlyAndAccessWindow() throws {
        let id = UUID().uuidString.lowercased(), digest = String(repeating: "a", count: 64)
        func receipt(_ hash: String, _ repeatValue: Bool, _ until: String = "2026-12-23T00:00:00.000Z") throws -> Data {
            try JSONSerialization.data(withJSONObject: ["version": 2, "id": id, "received": true, "repeated": repeatValue, "sha256": hash, "receivedAt": "2026-11-23T00:00:00.000Z", "retainedUntil": until])
        }
        XCTAssertNoThrow(try CloudFeedbackReceipt.confirmed(body: receipt(digest, false), status: 201, reportID: id, digest: digest))
        XCTAssertNoThrow(try CloudFeedbackReceipt.confirmed(body: receipt(digest, true), status: 200, reportID: id, digest: digest))
        for code in [401, 404, 409, 422, 500] { XCTAssertThrowsError(try CloudFeedbackReceipt.confirmed(body: receipt(digest, false), status: code, reportID: id, digest: digest)) }
        XCTAssertThrowsError(try CloudFeedbackReceipt.confirmed(body: receipt(String(repeating: "b", count: 64), false), status: 201, reportID: id, digest: digest))
        XCTAssertThrowsError(try CloudFeedbackReceipt.confirmed(body: receipt(digest, false, "2026-12-24T00:00:00Z"), status: 201, reportID: id, digest: digest))
        XCTAssertThrowsError(try CloudFeedbackReceipt.confirmed(body: receipt(digest, true), status: 201, reportID: id, digest: digest))
    }
}
