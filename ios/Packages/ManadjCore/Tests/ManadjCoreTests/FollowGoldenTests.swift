import XCTest
@testable import ManadjCore

final class FollowGoldenTests: XCTestCase {
    func resource(_ name: String) throws -> Data {
        try Data(contentsOf: XCTUnwrap(Bundle.module.url(forResource: name, withExtension: "json")))
    }
    func snapshot() throws -> Snapshot { try SnapshotJson.parse(String(decoding: resource("snapshot"), as: UTF8.self)) }
    func testBpmGateMatchesBackend() throws {
        let s = try snapshot()
        let cases = try JSONSerialization.jsonObject(with: resource("candidates")) as! [String: [Int]]
        for (key, expected) in cases {
            let parts = key.split(separator: ":").map { Int($0)! }
            var p = FollowParams(); p.bpmThresholdPercent = Double(parts[1])
            let gate = BpmGate(reference: try XCTUnwrap(s.tracks.first { $0.id == parts[0] }), params: p)
            XCTAssertEqual(s.tracks.filter(gate.admits).map(\.id).sorted(), expected, key)
        }
    }
    func testFollowMatchesDesktopGolden() throws {
        let library = Library(try snapshot())
        let cases = try JSONSerialization.jsonObject(with: resource("expected")) as! [[String: Any]]
        var count = 0
        for (i, c) in cases.enumerated() {
            let refs = c["refs"] as! [Int]
            var p = FollowParams()
            p.bpmThresholdPercent = c["thr"] as! Double
            p.knownOnly = c["knownOnly"] as! Bool
            p.temperature = c["temperature"] as! Double
            p.seed = UInt32(c["seed"] as! UInt64)
            let expected = (c["rows"] as! [[String: Any]]).filter { $0["label"] as? String != "Following" }
            let got = library.follow(refs, params: p)
            XCTAssertEqual(got.map(\.id), expected.map { $0["id"] as! Int }, "case \(i)")
            for (row, want) in zip(got, expected) {
                XCTAssertEqual(row.label, want["label"] as? String, "case \(i) track \(row.id)")
                if row.known == nil {
                    XCTAssertEqual(row.score, want["score"] as! Double, accuracy: 1e-9, "case \(i) track \(row.id)")
                }
            }
            count += got.count
        }
        XCTAssertGreaterThan(count, 1500)
        print("Desktop Follow golden: \(cases.count) cases, \(count) rows")
    }
    func testUnsupportedSnapshotVersion() {
        XCTAssertThrowsError(try SnapshotJson.parse("{\"version\":99}"))
    }
    func testArtistAndHash() {
        XCTAssertTrue(MatchScore.sharedArtist("Chase & Status", "Status feat. Someone"))
        XCTAssertFalse(MatchScore.sharedArtist(nil, "Someone"))
        XCTAssertGreaterThan(FollowRanker.uniform("decoy"), 0)
        XCTAssertLessThan(FollowRanker.uniform("decoy"), 1)
    }
}
