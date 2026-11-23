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
    func testAgreementLiftIsSmallAndNotBothFirst() throws {
        let json = #"{"version":1,"tracks":[{"id":1,"file_name":"a","title":"A","bpm":128},{"id":2,"file_name":"b","title":"B","bpm":128},{"id":4,"file_name":"single","title":"Single","bpm":128},{"id":3,"file_name":"both","title":"Both","bpm":128}],"links":[[1,3],[2,3],[1,4]],"tags":[],"tag_categories":[],"playlists":[],"settings":{}}"#
        let snapshot = try SnapshotJson.parse(json)
        let library = Library(snapshot)
        var params = FollowParams()
        let base = library.follow([1,2], params: params)
        XCTAssertEqual(base.map(\.id), [4,3])
        XCTAssertEqual(base.map { $0.referenceMatches.count }, [1,2])
        XCTAssertEqual(Set(base.first { $0.id == 3 }!.referenceMatches.map(\.referenceId)), Set([1,2]))
        XCTAssertEqual(base.first { $0.id == 4 }!.referenceMatches.map(\.referenceId), [1])
        params.sharedMatchBonus = 2
        let lifted = library.follow([1,2], params: params)
        XCTAssertEqual(lifted.map(\.id), [3,4])
        XCTAssertEqual(lifted.map(\.score), base.map(\.score))
        let strongerSingle = json.replacingOccurrences(of: "\"title\":\"A\"", with: "\"title\":\"A\",\"artist\":\"Same producer\"")
            .replacingOccurrences(of: "\"title\":\"Single\"", with: "\"title\":\"Single\",\"artist\":\"Same producer\"")
        XCTAssertEqual(Library(try SnapshotJson.parse(strongerSingle)).follow([1,2], params: params).map(\.id), [4,3], "A two-point lift must not force a weaker both-match above a stronger single-match")
        XCTAssertEqual(library.follow([1,1], params: params).map(\.id), library.follow([1], params: params).map(\.id))
    }
    func testOptionalAgreementLiftStaysWithinEvidenceTiersAndDeduplicatesReferences() throws {
        let snapshot = try snapshot()
        let library = Library(snapshot)
        let refs = Array(snapshot.tracks.prefix(2).map(\.id))
        let before = library.follow(refs)
        var params = FollowParams(); params.sharedMatchBonus = 2
        let lifted = library.follow(refs, params: params)
        XCTAssertEqual(Set(lifted.map(\.id)), Set(before.map(\.id)))
        XCTAssertEqual(lifted.map { $0.known?.rawValue ?? 3 }, lifted.map { $0.known?.rawValue ?? 3 }.sorted())
        for row in lifted {
            XCTAssertEqual(row.score, before.first { $0.id == row.id }?.score)
            XCTAssertEqual(Set(row.referenceMatches.map(\.referenceId)).count, row.referenceMatches.count)
        }
        if let ref = refs.first {
            XCTAssertEqual(library.follow([ref, ref], params: params).map(\.id), library.follow([ref], params: params).map(\.id))
            XCTAssertTrue(library.follow([ref, ref], params: params).allSatisfy { $0.referenceMatches.count <= 1 })
        }
    }
    func testReferenceEvidencePreservesBestScoreAndUnion() throws {
        let snapshot = try snapshot()
        let references = Array(snapshot.tracks.prefix(2))
        let params = FollowParams()
        for row in FollowRanker.rank(snapshot.tracks, snapshot: snapshot, references: references, params: params) {
            let facts = references.map { reference in
                FollowRanker.referenceEvidence(reference, candidate: row.track, snapshot: snapshot,
                    params: params, gate: BpmGate(reference: reference, params: params))
            }
            XCTAssertEqual(facts.map(\.referenceId), references.map(\.id))
            XCTAssertEqual(row.score, facts.map { $0.breakdown.total }.max() ?? 0)
            XCTAssertEqual(row.known?.rawValue, facts.compactMap { $0.known?.rawValue }.min())
            XCTAssertEqual(row.keyMatched, facts.contains { $0.breakdown.keyRelation != .other })
            XCTAssertEqual(row.sharedArtist, facts.contains { $0.breakdown.artist > 0 })
            XCTAssertEqual(row.matchedTagIds, facts.reduce(into: Set<Int>()) { $0.formUnion($1.matchedTagIds) })
            XCTAssertTrue(row.known != nil || facts.contains { $0.admitted })
        }
    }
    func testBrowserQuerySeamPreservesInlineBehavior() throws {
        let snapshot = try snapshot()
        let offline = Set(snapshot.tracks.enumerated().filter { $0.offset % 2 == 0 }.map { $0.element.id })
        let references: [Int?] = [nil] + snapshot.tracks.prefix(2).map { Optional($0.id) }
        for reference in references {
            for container in [false, true] {
                for tag in [nil, snapshot.tags.first?.id] as [Int?] {
                    for downloadedOnly in [false, true] {
                        for sort in SortColumn.allCases {
                            var query = LibraryQuery()
                            query.sort = sort; query.descending = sort == .dateAdded
                            query.downloadedOnly = downloadedOnly; query.bpmTolerance = 6
                            let request = BrowserQueryRequest(query: query, downloadedIds: offline,
                                referenceId: reference, sourceIsContainer: container, sourceTagId: tag)
                            let got = request.evaluate(snapshot)
                            let library = Library(snapshot, downloaded: { offline.contains($0.id) })
                            let expected: [LibraryTrack]
                            let labels: [Int: String]
                            if let reference, !container {
                                let ranked = library.follow([reference], within: query)
                                expected = ranked.map(\.track).filter { track in tag.map { track.tagIds.contains($0) } ?? true }
                                labels = Dictionary(uniqueKeysWithValues: ranked.map { ($0.id, $0.label) })
                            } else {
                                expected = library.query(query).filter { track in tag.map { track.tagIds.contains($0) } ?? true }
                                labels = [:]
                            }
                            XCTAssertEqual(got.rows.map(\.id), expected.map(\.id))
                            XCTAssertEqual(got.followLabels, labels)
                        }
                    }
                }
            }
        }
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
