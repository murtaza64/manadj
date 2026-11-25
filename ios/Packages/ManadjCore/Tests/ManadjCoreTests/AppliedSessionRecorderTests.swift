import XCTest
@testable import ManadjCore

final class AppliedSessionRecorderTests: XCTestCase {
    func segment(_ start: UInt64, _ end: UInt64, playing: Bool, fader: Double = 1) -> AppliedSessionSegment {
        var deck = AppliedSessionDeck()
        deck.load = 7; deck.trackID = 42; deck.ready = true; deck.playing = playing; deck.fader = fader
        deck.startPosition = Double(start) / 48000; deck.position = Double(end) / 48000
        return .init(startFrame: start, endFrame: end, sampleRate: 48000, crossfade: 0,
                     decks: [deck, .init(), .init(), .init()])
    }
    func testSilentContextOpensOnlyWhenAudibleAndKeepsSegmentControlTime() throws {
        var recorder = AppliedSessionRecorder()
        let date = Date()
        XCTAssertTrue(try recorder.observe(segment(0, 96, playing: false), wallTime: date).isEmpty)
        let open = try recorder.observe(segment(96, 192, playing: true), wallTime: date)
        guard case .open(_, _, let data) = open.first else { return XCTFail() }
        let events = try JSONSerialization.jsonObject(with: data) as! [[String: Any]]
        let play = events.first { $0["action"] as? String == "play" }!
        XCTAssertEqual(play["t"] as! Double, 96.0 / 48000)
        XCTAssertEqual(play["playhead"] as! Double, 96.0 / 48000)
        let changed = try recorder.observe(segment(192, 288, playing: true, fader: 0.25), wallTime: date)
        guard case .append(_, 1, let changes) = changed.first else { return XCTFail() }
        let rows = try JSONSerialization.jsonObject(with: changes) as! [[String: Any]]
        XCTAssertTrue(rows.contains { $0["control"] as? String == "fader" && $0["t"] as? Double == 192.0 / 48000 })
        XCTAssertEqual(recorder.stop(at: date.addingTimeInterval(1), incomplete: true).count, 1)
    }
    func testGapUnresolvedAndCueOnlyNeverBecomeCompleteSession() throws {
        var recorder = AppliedSessionRecorder()
        XCTAssertTrue(try recorder.observe(segment(0, 96, playing: true, fader: 0), wallTime: Date()).isEmpty)
        XCTAssertThrowsError(try recorder.observe(segment(192, 288, playing: true), wallTime: Date()))
        XCTAssertNil(recorder.session)
        var missing = AppliedSessionRecorder()
        var input = segment(0, 96, playing: true); input.decks[0].trackID = nil
        XCTAssertThrowsError(try missing.observe(input, wallTime: Date()))
        XCTAssertNil(missing.session)
    }
}

extension AppliedSessionRecorderTests {
    func testMapperActionsPersistToDurableJournalAndRestart() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        let journal = try SessionEventJournal(file: file)
        var recorder = AppliedSessionRecorder()
        let date = Date()
        var actions = try recorder.observe(segment(0, 96, playing: true), wallTime: date)
        actions += try recorder.observe(segment(96, 192, playing: false), wallTime: date)
        actions += recorder.stop(at: date.addingTimeInterval(1), incomplete: true)
        for action in actions {
            switch action {
            case .open(let id, let at, let events):
                try await journal.open(uuid: id, libraryIdentity: "generated", startedAt: at, context: events)
            case .append(let id, let seq, let events): try await journal.append(uuid: id, expectedSequence: seq, events: events)
            case .close(let id, let at, let incomplete): try await journal.close(uuid: id, endedAt: at, incomplete: incomplete)
            }
        }
        let reopened = try SessionEventJournal(file: file)
        let saved = await reopened.all()
        XCTAssertEqual(saved.count, 1)
        XCTAssertEqual(saved[0].chunks.count, 2)
        XCTAssertTrue(saved[0].incomplete)
    }
}
