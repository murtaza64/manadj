import XCTest
import CEngine

final class StreamingBridgeTests: XCTestCase {
    func testBoundedRingPlaysAndRefillsAfterSeek() throws {
        let engine = try XCTUnwrap(mdj_create(48_000)); defer { mdj_destroy(engine) }
        var out = [Float](repeating: 0, count: 2048)
        func render() { out.withUnsafeMutableBufferPointer { mdj_render(engine, $0.baseAddress!, 1024, 2) } }
        _ = mdj_prepare(engine, 1, 100); render()
        var state = mdj_deck(engine, 1)
        XCTAssertTrue(mdj_stream_claim(engine, 1, 100, state.transport, 44_100, 0))
        let block = (0..<16384).map { Float(sin(Double($0 / 2) * 2 * .pi * 440 / 44100)) * 0.2 }
        func offer(_ transport: UInt64) -> Int32 { block.withUnsafeBufferPointer { mdj_stream_write(engine, 1, transport, $0.baseAddress!, 8192) } }
        for _ in 0..<8 { XCTAssertEqual(offer(state.transport), 8192) }
        XCTAssertEqual(offer(state.transport), 0, "full ring must apply backpressure")
        XCTAssertTrue(mdj_stream_publish(engine, 1, 100, state.transport, false))
        XCTAssertTrue(mdj_deck(engine, 1).ready)
        XCTAssertFalse(mdj_deck(engine, 1).fullyDecoded)
        _ = mdj_submit(engine, MDJPlay, 1, 0, 0)
        for _ in 0..<20 { render() }
        XCTAssertGreaterThan(out.map { abs($0) }.max() ?? 0, 0.01)
        XCTAssertEqual(mdj_deck(engine, 1).position, Double(20 * 1024) / 48000, accuracy: 0.0001)
        XCTAssertGreaterThan(offer(state.transport), 0)
        let old = state.transport
        _ = mdj_submit(engine, MDJSeek, 1, 120, 0); render()
        state = mdj_deck(engine, 1)
        XCTAssertNotEqual(state.transport, old)
        XCTAssertEqual(state.target, 120, accuracy: 1e-9)
        XCTAssertEqual(offer(old), -1, "old transport cannot feed the new seek")
        XCTAssertTrue(mdj_stream_claim(engine, 1, 100, state.transport, 44100, 120))
        for _ in 0..<4 { XCTAssertEqual(offer(state.transport), 8192) }
        XCTAssertTrue(mdj_stream_publish(engine, 1, 100, state.transport, false))
        for _ in 0..<10 { render() }
        XCTAssertEqual(mdj_deck(engine, 1).position, 120 + Double(10 * 1024) / 48000, accuracy: 0.0001)
        XCTAssertGreaterThan(out.map { abs($0) }.max() ?? 0, 0.01)
    }
    func testEofStopsWithoutSilentlyLooping() throws {
        let engine = try XCTUnwrap(mdj_create(48_000)); defer { mdj_destroy(engine) }
        var out = [Float](repeating: 0, count: 2048)
        func render() { out.withUnsafeMutableBufferPointer { mdj_render(engine, $0.baseAddress!, 1024, 2) } }
        _ = mdj_prepare(engine, 0, 1); render()
        let t = mdj_deck(engine, 0).transport
        XCTAssertTrue(mdj_stream_claim(engine, 0, 1, t, 48000, 0))
        let pcm = [Float](repeating: 0.1, count: 8192)
        pcm.withUnsafeBufferPointer { XCTAssertEqual(mdj_stream_write(engine, 0, t, $0.baseAddress!, 4096), 4096) }
        XCTAssertTrue(mdj_stream_publish(engine, 0, 1, t, true))
        _ = mdj_submit(engine, MDJPlay, 0, 0, 0)
        for _ in 0..<20 { render() }
        XCTAssertFalse(mdj_deck(engine, 0).playing)
        XCTAssertLessThanOrEqual(mdj_deck(engine, 0).position, 4096.0 / 48000 + 0.001)
    }
}
