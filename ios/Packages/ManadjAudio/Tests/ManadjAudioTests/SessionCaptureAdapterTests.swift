import XCTest
import CEngine
import ManadjCore
@testable import ManadjAudio

final class SessionCaptureAdapterTests: XCTestCase {
    func testExactCallbackLoadBindingRejectsUnknownAndReplacement() throws {
        let engine = try XCTUnwrap(mdj_create(48000)); defer { mdj_destroy(engine) }
        mdj_capture_enable(engine, true)
        var output = [Float](repeating: 0, count: 192)
        func render() { output.withUnsafeMutableBufferPointer { mdj_render(engine, $0.baseAddress!, 96, 2) } }
        _ = mdj_prepare(engine, 0, 7); render()
        var snapshot = MDJCaptureSnapshot()
        XCTAssertEqual(mdj_capture_pop(engine, &snapshot), 1)
        XCTAssertThrowsError(try SessionCaptureAdapter.convert(snapshot) { _, _ in nil })
        let segment = try SessionCaptureAdapter.convert(snapshot) { deck, load in deck == 0 && load == 7 ? 42 : nil }
        XCTAssertEqual(segment.decks[0].trackID, 42)
        XCTAssertEqual(segment.decks[0].load, 7)
        XCTAssertEqual(segment.startFrame, 0); XCTAssertEqual(segment.endFrame, 96)
        _ = mdj_prepare(engine, 0, 8); render()
        XCTAssertEqual(mdj_capture_pop(engine, &snapshot), 1)
        XCTAssertThrowsError(try SessionCaptureAdapter.convert(snapshot) { _, load in load == 7 ? 42 : nil })
    }
    func testUnsupportedNativeStateCannotDefaultToSupported() throws {
        var snapshot = MDJCaptureSnapshot(); snapshot.sampleRate = 48000; snapshot.frame = 96
        snapshot.fxOn = true
        XCTAssertThrowsError(try SessionCaptureAdapter.convert(snapshot) { _, _ in nil })
        snapshot.fxOn = false; snapshot.fxHeld = 1
        XCTAssertThrowsError(try SessionCaptureAdapter.convert(snapshot) { _, _ in nil })
        snapshot.fxHeld = 0; snapshot.decks.0.preview = true
        XCTAssertThrowsError(try SessionCaptureAdapter.convert(snapshot) { _, _ in nil })
        snapshot.decks.0.preview = false; snapshot.decks.0.scratching = true
        XCTAssertThrowsError(try SessionCaptureAdapter.convert(snapshot) { _, _ in nil })
        snapshot.decks.0.scratching = false; snapshot.decks.0.previewSlot = 2
        XCTAssertThrowsError(try SessionCaptureAdapter.convert(snapshot) { _, _ in nil })
    }
}
