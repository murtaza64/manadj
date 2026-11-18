import XCTest
@testable import ManadjCore

/// Cases transcribed from Android's LibraryTest.kt FilterTest/PlaylistTest.
final class LibraryParityTests: XCTestCase {
    func fixture() throws -> Snapshot {
        try SnapshotJson.parse(#"""
        {"version":1,"tag_categories":[],"tags":[],"settings":{},
         "tracks":[
          {"id":1,"file_name":"alpha.mp3","title":"Alpha","artist":"Sub Focus","bpm":174,"key_openkey":"8m","energy":3,"tag_ids":[1,2],"date_added":"1970-01-01T00:00:10Z","audio_rev":"abc","filesize_bytes":4},
          {"id":2,"file_name":"beta.mp3","title":"Beta","artist":"Camo","bpm":87,"key_openkey":"9m","tag_ids":[2],"date_added":"1970-01-01T00:00:30Z"},
          {"id":3,"file_name":"gamma.mp3","title":"Gamma","energy":5,"tag_ids":[],"date_added":"1970-01-01T00:00:20Z"}],
         "playlists":[{"id":9,"name":"Peak","display_order":1,"track_ids":[3,1,99,2]},{"id":8,"name":"Warm","display_order":0,"track_ids":[]}]}
        """#)
    }
    func testAndroidFilterCases() throws {
        let library = Library(try fixture(), downloaded: { $0.id == 1 })
        func ids(_ edit: (inout LibraryQuery) -> Void = { _ in }) -> [Int] { var q = LibraryQuery(); edit(&q); return library.query(q).map(\.id) }
        XCTAssertEqual(ids(), [2,3,1])
        XCTAssertEqual(ids { $0.search = "sub foc" }, [1])
        XCTAssertEqual(ids { $0.search = "gamma.MP3" }, [3])
        XCTAssertEqual(ids { $0.tagIds = [1,2] }, [2,1])
        XCTAssertEqual(ids { $0.tagIds = [1,2]; $0.tagMatch = .all }, [1])
        XCTAssertEqual(ids { $0.bpmCenter = 172; $0.bpmPercent = 2 }, [2,1])
        XCTAssertEqual(ids { $0.energy = 1...5 }, [2,3,1])
        XCTAssertEqual(ids { $0.energy = 3...5 }, [3,1])
        XCTAssertEqual(ids { $0.keysOpenKey = ["9m"] }, [2])
        XCTAssertEqual(ids { $0.sort = .bpm; $0.descending = false }, [2,1,3])
        XCTAssertEqual(ids { $0.sort = .bpm }, [1,2,3])
        XCTAssertEqual(ids { $0.sort = .title; $0.descending = false }, [1,2,3])
        XCTAssertEqual(ids { $0.downloadedOnly = true }, [1])
    }
    func testPlaylistOrderAndUnknownMembers() throws {
        let library = Library(try fixture())
        XCTAssertEqual(library.playlists.map(\.name), ["Warm","Peak"])
        XCTAssertEqual(library.playlistTracks(9).map(\.id), [3,1,2])
        var q = LibraryQuery(); q.playlistId = 9; q.sort = .playOrder; q.descending = false
        XCTAssertEqual(library.query(q).map(\.id), [3,1,2])
        q.descending = true
        XCTAssertEqual(library.query(q).map(\.id), [2,1,3])
        q.search = "does not exist"
        XCTAssertTrue(library.query(q).isEmpty)
    }
    func testBpmWindowUsesAndroidInclusiveBoundaries() {
        for center in [87.0, 128.1, 172.0] {
            for percent in [0.1, 2.0, 5.0] {
                for fold in [center, center * 2, center / 2] {
                    let threshold = fold * percent / 100
                    XCTAssertTrue(LibraryFilter.inBpmWindow(fold - threshold, center: center, percent: percent))
                    XCTAssertTrue(LibraryFilter.inBpmWindow(fold + threshold, center: center, percent: percent))
                }
            }
        }
    }
    func testOfflineCacheRejectsMissingDirectoryEmptyAndWrongLength() throws {
        let track = try fixture().tracks[0]
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try LibraryStore(root: root)
        let target = try XCTUnwrap(store.audioFile(track))
        XCTAssertFalse(store.hasAudio(track))
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
        XCTAssertFalse(store.hasAudio(track))
        try FileManager.default.removeItem(at: target)
        try Data().write(to: target)
        XCTAssertFalse(store.hasAudio(track))
        try Data([1,2,3]).write(to: target)
        XCTAssertFalse(store.hasAudio(track))
        try Data([1,2,3,4]).write(to: target)
        XCTAssertTrue(store.hasAudio(track))
        XCTAssertThrowsError(try LibraryStore(root: XCTUnwrap(URL(string: "https://example.com/cache"))))
    }
}
