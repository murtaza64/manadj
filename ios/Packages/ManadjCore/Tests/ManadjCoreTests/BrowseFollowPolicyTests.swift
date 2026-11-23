import XCTest
@testable import ManadjCore

final class BrowseFollowPolicyTests: XCTestCase {
    typealias Deck = BrowseFollowPolicy.Deck
    func testPlayingDecksWinAndPauseReturnsAllLoadedVisible() {
        let a = Deck(index: 0, trackId: 10, playing: true)
        let b = Deck(index: 1, trackId: 20, playing: false)
        XCTAssertEqual(BrowseFollowPolicy.references([a,b]).map(\.index), [0])
        XCTAssertFalse(BrowseFollowPolicy.isPracticePause([a,b]))
        let paused = [Deck(index: 0, trackId: 10, playing: false), b]
        XCTAssertEqual(BrowseFollowPolicy.references(paused).map(\.index), [0,1])
        XCTAssertTrue(BrowseFollowPolicy.isPracticePause(paused))
    }
    func testBothPlayingAndUnloadedPlayingCannotBecomeReference() {
        let decks = [Deck(index: 0, trackId: 10, playing: true), Deck(index: 1, trackId: 20, playing: true), Deck(index: 2, trackId: nil, playing: true)]
        XCTAssertEqual(BrowseFollowPolicy.references(decks).map(\.index), [0,1])
        XCTAssertFalse(BrowseFollowPolicy.isPracticePause(decks))
        XCTAssertEqual(BrowseFollowPolicy.references([decks[2]]).count, 0)
    }
    func testEmptyDecksDoNotMatchAndDuplicateTrackDoesNotEarnAgreement() {
        let decks = [Deck(index: 0, trackId: 10, playing: false),
                     Deck(index: 1, trackId: 10, playing: false),
                     Deck(index: 2, trackId: nil, playing: false)]
        let refs = BrowseFollowPolicy.references(decks)
        XCTAssertEqual(refs.map(\.index), [0,1])
        XCTAssertEqual(BrowseFollowPolicy.trackIds(refs), [10])
        XCTAssertTrue(BrowseFollowPolicy.references([Deck(index: 0, trackId: nil, playing: false)]).isEmpty)
    }
}
