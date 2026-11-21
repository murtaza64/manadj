import XCTest
import CEngine
@testable import ManadjAudio

final class EngineBridgeTests: XCTestCase {
    func testWholeTrackLifecycleSeekAndOutput() throws {
        let engine = try XCTUnwrap(mdj_create(48_000)); defer { mdj_destroy(engine) }
        var out = [Float](repeating: 0, count: 2048)
        func render() { out.withUnsafeMutableBufferPointer { mdj_render(engine, $0.baseAddress!, 1024, 2) } }
        XCTAssertNotEqual(mdj_prepare(engine, 0, 1), 0)
        render()
        XCTAssertEqual(mdj_deck(engine, 0).load, 1)
        XCTAssertFalse(mdj_deck(engine, 0).ready)
        let frames = 48_000 * 3
        XCTAssertTrue(mdj_track_begin(engine, 0, 1, UInt64(frames), 48_000))
        let pcm = (0..<(frames * 2)).map { Float(sin(Double($0 / 2) * 440 * 2 * .pi / 48_000)) * 0.2 }
        pcm.withUnsafeBufferPointer { XCTAssertEqual(mdj_track_write(engine, 0, 1, $0.baseAddress!, Int32(frames)), Int32(frames)) }
        XCTAssertTrue(mdj_track_finish(engine, 0, 1))
        XCTAssertTrue(mdj_deck(engine, 0).ready)
        XCTAssertTrue(mdj_deck(engine, 0).fullyDecoded)
        XCTAssertNotEqual(mdj_grid(engine, 0, 128, 0.125), 0)
        render()
        XCTAssertEqual(mdj_deck(engine, 0).bpm, 128)
        XCTAssertEqual(mdj_deck(engine, 0).anchor, 0.125)
        XCTAssertNotEqual(mdj_submit(engine, MDJPlay, 0, 0, 0), 0)
        for _ in 0..<10 { render() }
        XCTAssertGreaterThan(out.map { abs($0) }.max() ?? 0, 0.01)
        XCTAssertEqual(mdj_deck(engine, 0).position, Double(10 * 1024) / 48_000, accuracy: 0.0001)
        _ = mdj_submit(engine, MDJPause, 0, 0, 0); render()
        _ = mdj_submit(engine, MDJSeek, 0, 1.5, 0); render()
        XCTAssertEqual(mdj_deck(engine, 0).position, 1.5, accuracy: 0.0001)
        // A replacement makes the previous writer stale, never corrupting the new allocation.
        _ = mdj_prepare(engine, 0, 2); render()
        XCTAssertFalse(mdj_track_finish(engine, 0, 1))
        XCTAssertFalse(mdj_deck(engine, 0).ready)
        XCTAssertEqual(mdj_submit(engine, MDJPlay, -1, 0, 0), 0)
        XCTAssertEqual(mdj_submit(engine, MDJFader, 0, .nan, 0), 0)
    }
    func testMasterRecordingFinalizesWav() throws {
        let engine = try XCTUnwrap(mdj_create(48_000)); defer { mdj_destroy(engine) }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("master.wav")
        XCTAssertTrue(mdj_record_start(engine, url.path))
        var out = [Float](repeating: 0, count: 2048)
        for _ in 0..<10 { out.withUnsafeMutableBufferPointer { mdj_render(engine, $0.baseAddress!, 1024, 2) } }
        mdj_record_stop(engine, false)
        XCTAssertEqual(mdj_record_state(engine), 3)
        let data = try Data(contentsOf: url)
        XCTAssertEqual(String(decoding: data.prefix(4), as: UTF8.self), "RIFF")
        XCTAssertEqual(data.count, 44 + 10240 * 4)
        XCTAssertFalse(mdj_record_start(engine, url.path))
    }
}
