import XCTest
@testable import ManadjCore

@MainActor final class TempoSyncGroupTests: XCTestCase {
    @MainActor final class Rig {
        var decks = Array(repeating: TempoSyncDeck(), count: 4)
        var alignments: [(Int, Int, Double)] = []
        lazy var group = TempoSyncGroup(write: { [unowned self] i,p in decks[i].pitch = p }, align: { [unowned self] i,j,r in alignments.append((i,j,r)) })
        func feed() { group.update(decks) }
        func load(_ i: Int, _ bpm: Double?, playing: Bool = false) { decks[i] = .init(ready: true, playing: playing, bpm: bpm, source: decks[i].source + 1); feed() }
        @discardableResult func toggle(_ i: Int, quantize: Bool = false) -> Bool { let result = group.toggle(i, quantize: quantize); feed(); return result }
        func pitch(_ i: Int, _ p: Double) { group.setPitch(i, percent: p); feed() }
    }
    func testDirectAndOctaveReach() async {
        XCTAssertEqual(TempoSyncGroup.matchPitch(base: 100, tempo: 108)!, 8, accuracy: 1e-8)
        XCTAssertEqual(TempoSyncGroup.matchPitch(base: 85, tempo: 170)!, 0, accuracy: 1e-8)
        XCTAssertNil(TempoSyncGroup.matchPitch(base: 100, tempo: 140))
        XCTAssertNil(TempoSyncGroup.matchPitch(base: 0, tempo: 120))
        XCTAssertNil(TempoSyncGroup.matchPitch(base: .nan, tempo: 120))
    }
    func testNearestPlayingReferenceCapturedOnceAndJoinedPitchRidesGroup() async {
        let r = Rig(); r.load(0,120); r.load(1,124,playing: true); r.load(2,128,playing: true)
        XCTAssertTrue(r.toggle(0)); XCTAssertEqual(r.group.tempo!,124,accuracy: 1e-8)
        r.pitch(1,4); XCTAssertEqual(r.group.tempo!,124,accuracy: 1e-8)
        XCTAssertTrue(r.toggle(1)); r.pitch(1,2)
        XCTAssertEqual(120*(1+r.decks[0].pitch/100),124*(1+r.decks[1].pitch/100),accuracy: 1e-8)
    }
    func testAllFourMembersRideAndDisengageKeepsPitch() async {
        let r = Rig(); for i in 0..<4 { r.load(i,120); XCTAssertTrue(r.toggle(i)) }
        for i in 0..<4 { r.pitch(i,Double(i+1)); for d in r.decks { XCTAssertEqual(d.pitch,Double(i+1),accuracy: 1e-8) } }
        XCTAssertTrue(r.toggle(0)); r.pitch(1,1); XCTAssertEqual(r.decks[0].pitch,4,accuracy: 1e-8)
    }
    func testHalfDoubleAndQuantizeJoinPhaseOnceNotPitchRides() async {
        let r = Rig(); r.load(0,120); r.load(1,60); r.load(2,240)
        XCTAssertTrue(r.toggle(0)); XCTAssertTrue(r.toggle(1)); r.decks[1].playing = true; r.decks[2].playing = true; r.feed(); XCTAssertTrue(r.toggle(2,quantize: true))
        XCTAssertEqual(r.alignments.count,1); if let alignment = r.alignments.first { XCTAssertEqual(alignment.2,4,accuracy: 1e-8) }
        r.pitch(2,2); XCTAssertEqual(r.alignments.count,1)
        XCTAssertEqual(r.decks[0].pitch,2,accuracy: 1e-8)
    }
    func testOutOfReachClampRecoveryAndWaitingMetadata() async {
        let r = Rig(); r.load(0,100); r.load(1,108); r.load(2,140)
        XCTAssertTrue(r.toggle(1)); XCTAssertTrue(r.toggle(0)); XCTAssertFalse(r.toggle(2))
        r.pitch(1,8); XCTAssertEqual(r.group.statuses[0],.outOfLock); XCTAssertEqual(r.decks[0].pitch,8)
        r.pitch(1,0); XCTAssertEqual(r.group.statuses[0],.synced)
        r.load(0,nil); XCTAssertEqual(r.group.statuses[0],.waiting)
        r.load(0,216); XCTAssertEqual(r.group.statuses[0],.synced)
        r.decks[0].ready = false; r.feed(); XCTAssertEqual(r.group.statuses[0],.waiting)
    }
    func testEmptyAndMissingBpmDoNotSilentlyJoin() async {
        let r = Rig(); XCTAssertFalse(r.toggle(0)); r.load(0,nil); XCTAssertFalse(r.toggle(0))
        XCTAssertNil(r.group.tempo); XCTAssertEqual(r.group.statuses[0],.off)
    }
}
