import XCTest
@testable import ManadjCore

final class CloudFeedbackReceiptTests: XCTestCase {
    let reportID = "b4c09bb8-aa5a-40e8-a7fd-32f8cbfc9904"
    private func body(id: String? = nil, received: Bool = true, repeated: Bool = false, version: Int = 1) throws -> Data {
        try JSONSerialization.data(withJSONObject: ["version": version, "id": id ?? reportID, "received": received, "repeated": repeated])
    }
    func testNewAndIdenticalRetryReceiptsConfirm() throws {
        XCTAssertFalse(try CloudFeedbackReceipt.confirmed(body: body(), status: 201, reportID: reportID).repeated)
        XCTAssertTrue(try CloudFeedbackReceipt.confirmed(body: body(repeated: true), status: 200, reportID: reportID).repeated)
    }
    func testFailureWrongReportOrUnconfirmedResponseCannotClearLocalDraft() throws {
        for status in [202, 204, 302, 400, 401, 403, 409, 429, 503] {
            XCTAssertThrowsError(try CloudFeedbackReceipt.confirmed(body: body(), status: status, reportID: reportID))
        }
        for value in [try body(id: "different-synthetic-id"), try body(received: false), try body(version: 2),
                      Data("Received".utf8), Data("{}".utf8), Data(repeating: 32, count: 1025)] {
            XCTAssertThrowsError(try CloudFeedbackReceipt.confirmed(body: value, status: 201, reportID: reportID))
        }
        XCTAssertThrowsError(try CloudFeedbackReceipt.confirmed(body: body(repeated: true), status: 201, reportID: reportID))
        XCTAssertThrowsError(try CloudFeedbackReceipt.confirmed(body: body(), status: 200, reportID: reportID))
    }
}
