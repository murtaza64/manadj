import XCTest
@testable import ManadjCore

/// Android Library.kt PreviewBitmaps parity for the parsed-preview cache.
final class PreviewCacheTests: XCTestCase {
    private func mwf(peaks: Int, frames: Int) -> Data {
        var bytes = [UInt8](repeating: 0, count: 84 + peaks + frames * 8)
        bytes.replaceSubrange(0..<4, with: Array("MWF1".utf8))
        func put(_ value: UInt64, _ offset: Int, _ count: Int) { for i in 0..<count { bytes[offset + i] = UInt8(truncatingIfNeeded: value >> (i * 8)) } }
        put(2, 4, 2); put(44100, 8, 4); put(2.0.bitPattern, 12, 8)
        put(128, 20, 4); put(512, 24, 4); put(1024, 28, 4)
        bytes[32] = 8; put(UInt64(Float(0.5).bitPattern), 36, 4)
        put(UInt64(peaks), 76, 4); put(UInt64(frames), 80, 4)
        for i in 0..<(peaks + frames * 8) { bytes[84 + i] = UInt8((i * 37) % 256) }
        return Data(bytes)
    }

    private func track(_ id: Int, rev: String) -> LibraryTrack {
        LibraryTrack(id: id, title: "T\(id)", artist: nil, fileName: "t\(id).wav", bpm: nil, bpmCenti: nil,
                     key: nil, keyOpenKey: nil, keyCamelot: nil, energy: nil, durationSecs: 2, dateAdded: nil,
                     mainCue: nil, codec: nil, fileSizeBytes: nil, audioRev: nil, previewRev: rev,
                     waveformRev: nil, stemsRev: nil, tagIds: [], hotCues: [], grid: nil, ladder: nil)
    }

    func testParsedPreviewsAreReusedAndEvictedByByteBudget() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("preview-cache-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try LibraryStore(root: root)
        let a = track(1, rev: "rev-a")
        let b = track(2, rev: "rev-b")
        try store.savePreview(mwf(peaks: 100, frames: 50), track: a)
        let cache = PreviewParseCache(byteBudget: 800)
        XCTAssertNotNil(cache.preview(a, store: store))
        // A cache hit serves without the blob: scrolling back must not re-read disk.
        try FileManager.default.removeItem(at: XCTUnwrap(store.previewFile(a)))
        XCTAssertNotNil(cache.preview(a, store: store), "a shown row never re-parses its preview")
        // A new revision is a different entry and honestly misses.
        XCTAssertNil(cache.preview(track(1, rev: "rev-new"), store: store))
        // Over budget the oldest entry evicts; the newest survives.
        try store.savePreview(mwf(peaks: 150, frames: 80), track: b)
        XCTAssertNotNil(cache.preview(b, store: store))
        XCTAssertNil(cache.preview(a, store: store), "oldest parsed preview evicted over budget")
        XCTAssertNotNil(cache.preview(b, store: store))
    }
}
