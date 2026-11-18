import XCTest
@testable import ManadjCore

final class WireFormatTests: XCTestCase, @unchecked Sendable {
    let empty = #"{"version":1,"tag_categories":[],"tags":[],"tracks":[],"playlists":[],"settings":{}}"#
    func testSnapshotRejectsMissingArraysAndDuplicateIdentities() throws {
        XCTAssertNoThrow(try SnapshotJson.parse(empty))
        XCTAssertThrowsError(try SnapshotJson.parse(#"{"version":true}"#))
        XCTAssertThrowsError(try SnapshotJson.parse(#"{"version":1}"#))
        let invalid = empty.replacingOccurrences(of: #""tracks":[]"#, with: #""tracks":[{"id":1,"file_name":"x"},{"id":1,"file_name":"y"}]"#)
        XCTAssertThrowsError(try SnapshotJson.parse(invalid))
        for id in ["true", "0", "-1", "1.5", "1e100"] {
            let text = empty.replacingOccurrences(of: #""tracks":[]"#, with: "\"tracks\":[{\"id\":\(id),\"file_name\":\"x\"}]")
            XCTAssertThrowsError(try SnapshotJson.parse(text), id)
        }
    }
    func testScalarSettingsAndMalformedBpmDoNotCrash() throws {
        let text = empty.replacingOccurrences(of: #""settings":{}"#, with: #""settings":{"test":{"value":true}}"#)
        XCTAssertEqual(try SnapshotJson.parse(text).settings["test"]?.json, "true")
        let huge = empty.replacingOccurrences(of: #""tracks":[]"#, with: #""tracks":[{"id":1,"file_name":"x","bpm":1e100}]"#)
        XCTAssertNil(try SnapshotJson.parse(huge).tracks[0].bpmCenti)
    }
    func testOriginValidationAndHeaders() throws {
        for origin in ["file:///tmp", "https://u:p@example.com", "https://example.com/path", "https://example.com?token=x"] {
            XCTAssertThrowsError(try DesktopConnection(url: XCTUnwrap(URL(string: origin))))
        }
        let c = try DesktopConnection(url: XCTUnwrap(URL(string: "http://127.0.0.1:48127")), pairCode: "old", deviceToken: "token", deviceId: "id", deviceName: "iPhone")
        let r = c.request(path: "/snapshot")
        XCTAssertEqual(r.url?.absoluteString, "http://127.0.0.1:48127/api/device-sync/snapshot")
        XCTAssertEqual(r.value(forHTTPHeaderField: "X-Manadj-Device-Token"), "token")
        XCTAssertNil(r.value(forHTTPHeaderField: "X-Manadj-Pair"))
        XCTAssertNil(c.request(path: "/request", pairing: true).value(forHTTPHeaderField: "X-Manadj-Device-Token"))
    }
    func waveform() -> Data {
        var bytes = [UInt8](repeating: 0, count: 62)
        bytes.replaceSubrange(0..<4, with: Array("MWF1".utf8))
        func put(_ value: UInt64, _ offset: Int, _ count: Int) { for i in 0..<count { bytes[offset+i] = UInt8(truncatingIfNeeded: value >> (i * 8)) } }
        put(1, 4, 2); put(44100, 8, 4); put(2.0.bitPattern, 12, 8)
        put(128, 20, 4); put(512, 24, 4); put(2048, 28, 4)
        bytes[32] = 1; put(UInt64(Float(0.5).bitPattern), 36, 4)
        put(3, 48, 4); put(3, 52, 4)
        bytes.replaceSubrange(56..<62, with: [0, 128, 255, 0, 128, 255])
        return Data(bytes)
    }
    func testWaveformTimingAndGamma() throws {
        let w = try PreviewWaveform.parse(waveform())
        XCTAssertEqual(w.durationSecs, 2)
        XCTAssertEqual(w.peakHop, 128)
        XCTAssertEqual(w.bandFrames, 3)
        XCTAssertEqual(w.amplitude(1), pow(128.0 / 255, 2), accuracy: 1e-9)
        XCTAssertEqual(w.threeBand(2), [1, 0, 0])
    }
    func testBinaryTruncationAndOverflowAreErrors() throws {
        let data = waveform()
        for n in 0..<data.count { XCTAssertThrowsError(try PreviewWaveform.parse(data.prefix(n)), "length \(n)") }
        var overflow = data; overflow.replaceSubrange(48..<52, with: [255,255,255,255])
        XCTAssertThrowsError(try PreviewWaveform.parse(overflow))
        var nan = data; nan.replaceSubrange(36..<40, with: [0,0,192,127])
        XCTAssertThrowsError(try PreviewWaveform.parse(nan))
        XCTAssertThrowsError(try PreviewPack.parse(Data("MPK1\u{ff}\u{ff}\u{ff}\u{ff}".utf8)))
        XCTAssertThrowsError(try PreviewPack.parse(Data([77,80,75,49,1,0,0,0,1,0,0,0,255,255,255,255])))
    }
    func testCorruptCacheIsPreservedWithoutBlockingFreshSync() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        _ = try LibraryStore(root: root)
        try Data("broken".utf8).write(to: root.appendingPathComponent("snapshot.json"))
        let repository = try LibraryRepository(root: root)
        let cached = await repository.cachedSnapshot()
        XCTAssertNil(cached)
        let warning = await repository.recoveryWarning
        XCTAssertNotNil(warning)
        let saved = try FileManager.default.contentsOfDirectory(atPath: root.path)
        XCTAssertTrue(saved.contains { $0.hasPrefix("snapshot.invalid-") })
        XCTAssertFalse(saved.contains("snapshot.json"))
    }
    func testSnapshotAtomicCacheKeepsLastGoodValue() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try LibraryStore(root: root)
        try store.saveSnapshot(empty)
        XCTAssertThrowsError(try store.saveSnapshot("broken"))
        XCTAssertEqual(try store.readSnapshot()?.version, 1)
    }
}
