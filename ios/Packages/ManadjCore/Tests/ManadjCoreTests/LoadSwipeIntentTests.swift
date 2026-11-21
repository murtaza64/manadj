import XCTest
@testable import ManadjCore
final class LoadSwipeIntentTests: XCTestCase {
    func testShortFlickDirectionsAndAccidentalMovementGuards() {
        XCTAssertEqual(LoadSwipeIntent.target(travel: -45, vertical: 2, projected: -120), 0)
        XCTAssertEqual(LoadSwipeIntent.target(travel: 45, vertical: 2, projected: 120), 1)
        XCTAssertEqual(LoadSwipeIntent.target(travel: -65, vertical: 2, projected: -70), 0)
        XCTAssertNil(LoadSwipeIntent.target(travel: -20, vertical: 0, projected: -200))
        XCTAssertNil(LoadSwipeIntent.target(travel: -45, vertical: 0, projected: -50))
        XCTAssertNil(LoadSwipeIntent.target(travel: -45, vertical: 0, projected: 120))
        XCTAssertNil(LoadSwipeIntent.target(travel: 45, vertical: 100, projected: 200))
        XCTAssertNil(LoadSwipeIntent.target(travel: .nan, vertical: 0, projected: 200))
    }
}
