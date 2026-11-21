import XCTest
@testable import ManadjAudio

final class LoadAcknowledgementTests: XCTestCase {
    func testAcknowledgementBetweenPollsUsesOneGenerationRead() throws {
        var reads = 0, pauses = 0
        try LoadAcknowledgement.wait(expected: 7, current: {
            reads += 1
            return reads == 1 ? 6 : 7
        }, cancelled: { false }, expired: { false }, pause: { pauses += 1 })
        XCTAssertEqual(reads, 2)
        XCTAssertEqual(pauses, 1)
    }
    func testAlreadyAcknowledgedDoesNotWaitOrTimeOut() throws {
        try LoadAcknowledgement.wait(expected: 7, current: { 7 }, cancelled: { false },
                                     expired: { true }, pause: { XCTFail("Already acknowledged") })
    }
    func testNewerLoadAndCancellationStillReject() {
        for cancelled in [false, true] {
            XCTAssertThrowsError(try LoadAcknowledgement.wait(expected: 7, current: { 8 },
                cancelled: { cancelled }, expired: { false }, pause: { XCTFail("Replaced") })) {
                guard case LoadAcknowledgement.Failure.replaced = $0 else { return XCTFail("Wrong error") }
            }
        }
    }
    func testUnacknowledgedLoadTimesOut() {
        XCTAssertThrowsError(try LoadAcknowledgement.wait(expected: 7, current: { 6 },
            cancelled: { false }, expired: { true }, pause: { XCTFail("Expired") })) {
            guard case LoadAcknowledgement.Failure.timedOut = $0 else { return XCTFail("Wrong error") }
        }
    }
}
