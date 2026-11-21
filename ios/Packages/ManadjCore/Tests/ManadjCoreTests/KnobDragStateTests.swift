import XCTest
@testable import ManadjCore

final class KnobDragStateTests: XCTestCase {
    func testNeutralHoldsAndEscapesWithoutJump() {
        var state = KnobDragState(value: 0.5)
        state.move(x: 0, y: -6, fine: false)
        XCTAssertEqual(state.value, 0.5)
        state.move(x: 0, y: -7, fine: false)
        XCTAssertEqual(state.value, 0.5 + 1 / 264.0, accuracy: 0.000001)
        XCTAssertFalse(state.notched)
    }
    func testCrossingLatchesUntilEscapeThenRebases() {
        var state = KnobDragState(value: 0.7)
        state.move(x: 0, y: 60, fine: false)
        XCTAssertEqual(state.value, 0.5); XCTAssertTrue(state.notched)
        XCTAssertEqual(state.tick, 1)
        state.move(x: 0, y: 65, fine: false)
        XCTAssertEqual(state.value, 0.5); XCTAssertEqual(state.tick, 1)
        state.move(x: 0, y: 67, fine: false)
        XCTAssertEqual(state.value, 0.5 - 1 / 264.0, accuracy: 0.000001)
    }
    func testFineSwitchNeverJumpsAndIsSlower() {
        var state = KnobDragState(value: 0.8)
        state.move(x: 40, y: 2, fine: false)
        let before = state.value
        state.move(x: 40, y: 2, fine: true)
        XCTAssertEqual(state.value, before)
        state.move(x: 50, y: 2, fine: true)
        XCTAssertEqual(state.value - before, 10 / (264 * 3.5), accuracy: 0.000001)
        let fineValue = state.value
        state.move(x: 50, y: 2, fine: false)
        XCTAssertEqual(state.value, fineValue)
    }
    func testDominantAxisIsLockedAndRangeClamped() {
        var state = KnobDragState(value: 0.8)
        state.move(x: 10, y: 1, fine: false)
        let before = state.value
        state.move(x: 10, y: 500, fine: false)
        XCTAssertEqual(state.value, before)
        state.move(x: 1000, y: 0, fine: false)
        XCTAssertEqual(state.value, 1)
        state.move(x: .nan, y: 0, fine: false)
        XCTAssertEqual(state.value, 1)
    }
}
