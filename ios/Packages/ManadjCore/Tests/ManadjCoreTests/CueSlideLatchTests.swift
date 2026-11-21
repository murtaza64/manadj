import XCTest
@testable import ManadjCore
final class CueSlideLatchTests: XCTestCase {
    func testEitherDirectionOnlyWhilePreviewingAndOnlyOnce() {
        for delta in [-60.0, 60.0] {
            var gate = CueSlideLatch()
            XCTAssertFalse(gate.move(delta: delta, width: 100, scale: 3, preview: true))
            gate.begin()
            XCTAssertFalse(gate.move(delta: delta, width: 100, scale: 3, preview: false))
            XCTAssertFalse(gate.move(delta: 10, width: 100, scale: 3, preview: true))
            XCTAssertTrue(gate.move(delta: delta, width: 100, scale: 3, preview: true))
            XCTAssertFalse(gate.move(delta: delta, width: 100, scale: 3, preview: true))
            gate.end(); XCTAssertFalse(gate.held); XCTAssertFalse(gate.locked)
        }
    }
    func testPhysicalPixelThresholdBounds() {
        let gate = CueSlideLatch()
        XCTAssertEqual(gate.threshold(width: 20, scale: 3), 80/3.0, accuracy: 0.001)
        XCTAssertEqual(gate.threshold(width: 100, scale: 3), 55, accuracy: 0.001)
        XCTAssertEqual(gate.threshold(width: 1000, scale: 3), 220/3.0, accuracy: 0.001)
    }
}
