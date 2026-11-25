import XCTest
import CEngine
import ManadjCore
@testable import ManadjAudio

final class SessionCapturePipelineTests: XCTestCase {
    func testGeneratedEngineQueueConversionRuntimeAndJournalRestart() async throws {
        let engine = try XCTUnwrap(mdj_create(48000)); defer { mdj_destroy(engine) }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("manifest.json")
        let journal = try SessionEventJournal(file: file)
        let runtime = SessionCaptureRuntime(journal: journal, libraryIdentity: "generated-pipeline")
        var output = [Float](repeating: 0, count: 960)
        func render() { output.withUnsafeMutableBufferPointer { mdj_render(engine, $0.baseAddress!, 480, 2) } }
        _ = mdj_prepare(engine, 0, 7); render()
        XCTAssertTrue(mdj_track_begin(engine, 0, 7, 96000, 48000))
        let pcm = (0..<192000).map { Float(sin(Double($0 / 2) * 440 * 2 * .pi / 48000) * 0.2) }
        pcm.withUnsafeBufferPointer { XCTAssertEqual(mdj_track_write(engine, 0, 7, $0.baseAddress!, 96000), 96000) }
        XCTAssertTrue(mdj_track_finish(engine, 0, 7))
        mdj_capture_enable(engine, true)
        _ = mdj_submit(engine, MDJPlay, 0, 0, 0)
        let start = Date()
        var maximum: Float = 0
        var original: [Float] = []
        for index in 0..<100 {
            if index == 50 { _ = mdj_submit(engine, MDJFader, 0, 0.6, 0) }
            render()
            maximum = max(maximum, output.map(abs).max() ?? 0)
            original += output
            var snapshot = MDJCaptureSnapshot()
            XCTAssertEqual(mdj_capture_pop(engine, &snapshot), 1)
            let segment = try SessionCaptureAdapter.convert(snapshot) { deck, load in deck == 0 && load == 7 ? 42 : nil }
            try await runtime.observe(segment, wallTime: start.addingTimeInterval(Double(index) / 100))
            XCTAssertEqual(mdj_capture_pop(engine, &snapshot), 0)
        }
        XCTAssertGreaterThan(maximum, 0.01)
        // Leave a final rendered segment queued when stop is requested. The
        // callback acknowledges only after committing it, then publishes no more.
        render()
        let stopToken = mdj_capture_request_stop(engine)
        var fence = MDJCaptureStop()
        XCTAssertEqual(mdj_capture_stop_poll(engine, stopToken, &fence), 0)
        render()
        XCTAssertEqual(mdj_capture_stop_poll(engine, stopToken, &fence), 1)
        XCTAssertEqual(fence.published, 101); XCTAssertEqual(fence.remaining, 1)
        XCTAssertFalse(fence.gap)
        var lastSnapshot = MDJCaptureSnapshot()
        XCTAssertEqual(mdj_capture_pop(engine, &lastSnapshot), 1)
        XCTAssertEqual(lastSnapshot.frame, fence.finalFrame)
        try await runtime.observe(SessionCaptureAdapter.convert(lastSnapshot) { deck, token in deck == 0 && token == 7 ? 42 : nil }, wallTime: start.addingTimeInterval(1))
        XCTAssertEqual(mdj_capture_pop(engine, &lastSnapshot), 0)
        render(); XCTAssertEqual(mdj_capture_pop(engine, &lastSnapshot), 0)
        try await runtime.stop(at: start.addingTimeInterval(1.01), incomplete: false)
        let reopened = try SessionEventJournal(file: file), saved = await reopened.all()
        XCTAssertEqual(saved.count, 1); XCTAssertFalse(saved[0].incomplete)
        XCTAssertEqual(saved[0].libraryIdentity, "generated-pipeline")
        let events = try saved[0].chunks.flatMap { try JSONSerialization.jsonObject(with: $0.events) as! [[String: Any]] }
        let load = try XCTUnwrap(events.first { $0["kind"] as? String == "load" && $0["channel"] as? String == "A" })
        XCTAssertEqual(load["trackId"] as? Int, 42)
        let play = try XCTUnwrap(events.first { $0["action"] as? String == "play" })
        XCTAssertEqual(play["t"] as? Double, 0)
        let fader = try XCTUnwrap(events.first { $0["control"] as? String == "fader" && ($0["value"] as? Double ?? 1) < 0.7 })
        XCTAssertEqual(fader["t"] as? Double, 0.5)
        // Narrow replay proof for this generated plain play/fader fixture only.
        // It is not an implementation of the full capture event grammar.
        let replay = try XCTUnwrap(mdj_create(48000)); defer { mdj_destroy(replay) }
        _ = mdj_prepare(replay, 0, 7)
        output.withUnsafeMutableBufferPointer { mdj_render(replay, $0.baseAddress!, 480, 2) }
        XCTAssertTrue(mdj_track_begin(replay, 0, 7, 96000, 48000))
        pcm.withUnsafeBufferPointer { XCTAssertEqual(mdj_track_write(replay, 0, 7, $0.baseAddress!, 96000), 96000) }
        XCTAssertTrue(mdj_track_finish(replay, 0, 7))
        var reproduced: [Float] = []
        let playTime = (play["t"] as! NSNumber).doubleValue
        let faderTime = (fader["t"] as! NSNumber).doubleValue
        for index in 0..<100 {
            if index == Int((playTime * 100).rounded()) { _ = mdj_submit(replay, MDJPlay, 0, 0, 0) }
            if index == Int((faderTime * 100).rounded()) {
                _ = mdj_submit(replay, MDJFader, 0, (fader["value"] as! NSNumber).doubleValue, 0)
            }
            output.withUnsafeMutableBufferPointer { mdj_render(replay, $0.baseAddress!, 480, 2) }
            reproduced += output
        }
        XCTAssertEqual(original.count, reproduced.count)
        let error = zip(original, reproduced).map { abs($0 - $1) }.max() ?? 1
        XCTAssertLessThan(error, 0.000001)
        let times = events.map { ($0["t"] as! NSNumber).doubleValue }
        XCTAssertEqual(times, times.sorted())
    }
}
