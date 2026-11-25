import XCTest
import CEngine
@testable import ManadjAudio

final class SessionCaptureDrainTests: XCTestCase {
    func testDisabledEmptyOrderedReplacementAndOverflow() throws {
        let engine = try XCTUnwrap(mdj_create(48000)); defer { mdj_destroy(engine) }
        var loads = SessionCaptureLoads(), output = [Float](repeating: 0, count: 192)
        XCTAssertTrue(try SessionCaptureDrain.read(engine: engine, loads: loads).isEmpty)
        mdj_capture_enable(engine, true)
        for (token, identity) in [(UInt64(1), 42), (UInt64(2), 99)] {
            try loads.register(deck: 0, token: token, trackID: identity)
            _ = mdj_prepare(engine, 0, token)
            output.withUnsafeMutableBufferPointer { mdj_render(engine, $0.baseAddress!, 96, 2) }
        }
        let result = try SessionCaptureDrain.read(engine: engine, loads: loads)
        XCTAssertEqual(result.map { $0.decks[0].trackID }, [42, 99])
        XCTAssertTrue(try SessionCaptureDrain.read(engine: engine, loads: loads).isEmpty)
        for _ in 0..<129 { output.withUnsafeMutableBufferPointer { mdj_render(engine, $0.baseAddress!, 96, 2) } }
        XCTAssertThrowsError(try SessionCaptureDrain.read(engine: engine, loads: loads)) {
            XCTAssertEqual($0 as? CaptureDrainError, .gap)
        }
        mdj_capture_enable(engine, false); mdj_capture_enable(engine, true)
        XCTAssertThrowsError(try SessionCaptureDrain.read(engine: engine, loads: loads))
    }
}
