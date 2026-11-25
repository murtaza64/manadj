import XCTest
@testable import ManadjCore

final class SessionCaptureRuntimeTests: XCTestCase {
    func testOneSecondBatchAndExplicitInterruptionKeepOrderedEvidence() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("manifest.json"), journal = try SessionEventJournal(file: file)
        let runtime = SessionCaptureRuntime(journal: journal, libraryIdentity: "generated"), at = Date()
        for index in 0..<100 {
            var deck = AppliedSessionDeck()
            deck.load = 1; deck.trackID = 42; deck.playing = true; deck.ready = true
            deck.fader = index % 2 == 0 ? 0.8 : 0.9
            deck.startPosition = Double(index) / 100; deck.position = Double(index + 1) / 100
            let segment = AppliedSessionSegment(startFrame: UInt64(index * 480), endFrame: UInt64((index + 1) * 480),
                sampleRate: 48000, crossfade: 0, decks: [deck, .init(), .init(), .init()])
            try await runtime.observe(segment, wallTime: at.addingTimeInterval(Double(index) / 100))
        }
        //100 changes have not become100 fsync transactions. Explicit stop flushes
        //the bounded pending batch before a terminal incomplete marker.
        try await runtime.stop(at: at.addingTimeInterval(1), incomplete: true)
        let reopened = try SessionEventJournal(file: file), saved = await reopened.all()
        XCTAssertEqual(saved.count, 1); XCTAssertEqual(saved[0].chunks.count, 2)
        XCTAssertTrue(saved[0].incomplete)
        XCTAssertEqual(saved[0].endedAt, at.addingTimeInterval(1))
        let events = try JSONSerialization.jsonObject(with: saved[0].chunks[1].events) as! [[String: Any]]
        XCTAssertEqual(events.filter { $0["control"] as? String == "fader" }.count, 99)
    }

    func testGapCannotProduceCompleteClose() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let journal = try SessionEventJournal(file: root.appendingPathComponent("manifest.json"))
        let runtime = SessionCaptureRuntime(journal: journal, libraryIdentity: "generated"), at = Date()
        var deck = AppliedSessionDeck(); deck.load = 1; deck.trackID = 42; deck.playing = true; deck.ready = true
        try await runtime.observe(.init(startFrame: 0, endFrame: 96, sampleRate: 48000, crossfade: 0,
            decks: [deck, .init(), .init(), .init()]), wallTime: at)
        do { try await runtime.observe(.init(startFrame: 192, endFrame: 288, sampleRate: 48000, crossfade: 0,
            decks: [deck, .init(), .init(), .init()]), wallTime: at.addingTimeInterval(1)); XCTFail() } catch {}
        let saved = await journal.all(); XCTAssertTrue(saved[0].incomplete)
        XCTAssertNotNil(saved[0].endedAt)
    }
}
