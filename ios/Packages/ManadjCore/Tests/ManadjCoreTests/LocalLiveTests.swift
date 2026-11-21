import XCTest
@testable import ManadjCore

final class LocalLiveTests: XCTestCase {
    private func payload(position: Double = 10, playing: Bool = true, pitch: Double = 0,
                         unsupported: [String] = []) throws -> Data {
        let row: [String: Any] = ["track_id": 1, "audio_rev": "abc", "position": position,
            "playing": playing, "pitch": pitch, "bend": 0.0, "fader": 0.7, "trim": 0.5,
            "low": 0.5, "mid": 0.5, "high": 0.5, "filter": 0.0, "key_lock": false,
            "unsupported": unsupported]
        return try JSONSerialization.data(withJSONObject: ["version": 1, "state": "live", "age": 0.1,
            "anchor": ["stream_id": "78fe4568-6b2b-4bf4-bb18-e3d401fbfe8d", "seq": 1,
                       "decks": [row, row, row, row], "unsupported": []]])
    }
    func testMidpointAgeProjectionAndPausedAnchor() throws {
        let frame = try LiveEnvelope.parse(payload(pitch: 10))
        let row = try XCTUnwrap(frame.anchor?.decks.first)
        XCTAssertEqual(try row.target(age: 0.1, roundTrip: 0.2, elapsed: 0.1), 10.33, accuracy: 0.0001)
        let paused = try LiveEnvelope.parse(payload(playing: false))
        XCTAssertEqual(try paused.anchor!.decks[0].target(age: 0.1, roundTrip: 0.2), 10)
    }
    func testStaleUnsupportedNegativeAndExtremeDelayAreRefused() throws {
        let row = try LiveEnvelope.parse(payload()).anchor!.decks[0]
        for age in [-1.0, 2.01, Double.infinity] { XCTAssertThrowsError(try row.target(age: age, roundTrip: 0.1)) }
        XCTAssertThrowsError(try row.target(age: 0.1, roundTrip: 1.1))
        XCTAssertThrowsError(try row.target(age: 0.1, roundTrip: 0.1, elapsed: 3))
        let bad = try LiveEnvelope.parse(payload(unsupported: ["Loop"])).anchor!.decks[0]
        XCTAssertThrowsError(try bad.target(age: 0.1, roundTrip: 0.1))
        let negative = try LiveEnvelope.parse(payload(position: -1)).anchor!.decks[0]
        XCTAssertThrowsError(try negative.target(age: 0, roundTrip: 0))
    }
    func testUnknownProtocolMissingAndPartialAnchorsRefuse() throws {
        for text in ["{}", "{\"version\":2,\"state\":\"offline\",\"age\":0}",
                     "{\"version\":1,\"state\":\"live\",\"age\":0,\"anchor\":null}"] {
            XCTAssertThrowsError(try LiveEnvelope.parse(Data(text.utf8)))
        }
        let off = try LiveEnvelope.parse(Data("{\"version\":1,\"state\":\"offline\",\"age\":3,\"anchor\":null}".utf8))
        XCTAssertEqual(off.state, "offline")
    }
}
