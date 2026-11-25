import XCTest
import CEngine
@testable import ManadjAudio

final class SessionCaptureLoadTests: XCTestCase {
    func testQueuedOldAndReplacementLoadsKeepExactTrackIdentity() throws {
        let engine = try XCTUnwrap(mdj_create(48000)); defer { mdj_destroy(engine) }
        mdj_capture_enable(engine, true)
        var bindings = SessionCaptureLoads(), output = [Float](repeating: 0, count: 192)
        for (token, track) in [(UInt64(7), 42), (UInt64(8), 99)] {
            try bindings.register(deck: 0, token: token, trackID: track)
            XCTAssertNotEqual(mdj_prepare(engine, 0, token), 0)
            output.withUnsafeMutableBufferPointer { mdj_render(engine, $0.baseAddress!, 96, 2) }
        }
        // Both render records are drained only after the replacement is queued.
        // Looking at current UI selection here would incorrectly relabel track42.
        for track in [42, 99] {
            var snapshot = MDJCaptureSnapshot()
            XCTAssertEqual(mdj_capture_pop(engine, &snapshot), 1)
            let segment = try SessionCaptureAdapter.convert(snapshot) { bindings.resolve(deck: $0, token: $1) }
            XCTAssertEqual(segment.decks[0].trackID, track)
        }
        XCTAssertThrowsError(try bindings.register(deck: 0, token: 7, trackID: 99))
        XCTAssertNil(bindings.resolve(deck: 1, token: 7))
        XCTAssertNil(bindings.resolve(deck: 0, token: 9))
    }
    func testBindingCapacityNeverSilentlyEvictsPendingEvidence() throws {
        var bindings = SessionCaptureLoads()
        for token in 1...SessionCaptureLoads.maximumBindings {
            try bindings.register(deck: 0, token: UInt64(token), trackID: token)
        }
        XCTAssertThrowsError(try bindings.register(deck: 0, token: 999, trackID: 999))
        XCTAssertEqual(bindings.resolve(deck: 0, token: 1), 1)
        try bindings.register(deck: 0, token: 1, trackID: 1)
    }
}
