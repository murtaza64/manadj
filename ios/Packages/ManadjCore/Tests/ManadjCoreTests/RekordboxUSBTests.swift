import Foundation
import XCTest
@testable import ManadjCore

final class RekordboxUSBTests: XCTestCase {
    func fixture() throws -> Data {
        try Data(contentsOf: XCTUnwrap(Bundle.module.url(forResource: "generated-export", withExtension: "pdb")))
    }
    func set32(_ data: inout Data, _ at: Int, _ value: Int) {
        for i in 0..<4 { data[at + i] = UInt8((value >> (8 * i)) & 255) }
    }
    func testIndependentWriterMultiPageUnicodeAndPlaylistOrder() throws {
        let library = try RekordboxUSBReader.read(fixture())
        XCTAssertEqual(library.tracks.count, 40)
        let first = try XCTUnwrap(library.tracks.first { $0.id == 1 })
        XCTAssertEqual(first.title, "Süper pulse 1")
        XCTAssertEqual(first.artist, "Generated artist")
        XCTAssertEqual(first.bpm, 128)
        XCTAssertEqual(first.duration, 24)
        XCTAssertEqual(first.byteCount, 1234)
        XCTAssertEqual(first.path, "/Contents/tone1.wav")
        XCTAssertEqual(library.playlists.first?.trackIds, [2,1])
    }
    func testTruncationHeaderLimitsAndCycleRefuse() throws {
        let original = try fixture()
        for count in [0, 27, 100, original.count - 1] { XCTAssertThrowsError(try RekordboxUSBReader.read(original.prefix(count))) }
        var data = original; set32(&data, 4, Int(UInt32.max))
        XCTAssertThrowsError(try RekordboxUSBReader.read(data))
        data = original; set32(&data, 8, Int(UInt32.max))
        XCTAssertThrowsError(try RekordboxUSBReader.read(data))
        data = original; set32(&data, 4096 + 12, 1)
        XCTAssertThrowsError(try RekordboxUSBReader.read(data))
    }
    func testDeletedRowsNeverParseMalformedPayload() throws {
        var data = try fixture()
        // Track table starts with index page1, then data page2.
        let base = 8192, end = base + 4096
        let offset = Int(data[end - 6]) | Int(data[end - 5]) << 8
        data[base + 40 + offset + 128] = 255
        data[base + 40 + offset + 129] = 255
        XCTAssertThrowsError(try RekordboxUSBReader.read(data))
        data[end - 4] &= 0xfe
        let library = try RekordboxUSBReader.read(data)
        XCTAssertEqual(library.tracks.count, 39)
    }
}

extension RekordboxUSBTests {
    func testReadOnlyPreviewRejectsEscapesAndMissingAudio() throws {
        for path in ["../private.wav", "/Contents/../private.wav", "a\\b.wav", "file:secret", "."] {
            XCTAssertThrowsError(try RekordboxUSBPreview.relativePath(path))
        }
        XCTAssertEqual(try RekordboxUSBPreview.relativePath("/Contents/track.wav"), "Contents/track.wav")
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let db = root.appendingPathComponent("PIONEER/rekordbox/export.pdb")
        try FileManager.default.createDirectory(at: db.deletingLastPathComponent(), withIntermediateDirectories: true)
        let original = try fixture(); try original.write(to: db)
        let contents = root.appendingPathComponent("Contents")
        try FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
        try Data(repeating: 0, count: 1234).write(to: contents.appendingPathComponent("tone1.wav"))
        let outside = root.deletingLastPathComponent().appendingPathComponent(UUID().uuidString + ".wav")
        defer { try? FileManager.default.removeItem(at: outside) }
        try Data(repeating: 0, count: 1234).write(to: outside)
        try FileManager.default.createSymbolicLink(at: contents.appendingPathComponent("tone2.wav"), withDestinationURL: outside)
        let preview = try RekordboxUSBPreview.scan(root: root)
        XCTAssertEqual(preview.available.map(\.id), [1])
        XCTAssertEqual(preview.tracks.count, 40)
        XCTAssertEqual(try Data(contentsOf: db), original, "Preview must not modify database")
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: contents.path).sorted(), ["tone1.wav", "tone2.wav"])
    }
}

extension RekordboxUSBTests {
    func testConfirmedCopyIsAppOwnedAtomicAndRefusesChangedPlan() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let destination = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: destination) }
        let db = root.appendingPathComponent("PIONEER/rekordbox/export.pdb")
        try FileManager.default.createDirectory(at: db.deletingLastPathComponent(), withIntermediateDirectories: true)
        let original = try fixture(); try original.write(to: db)
        let audio = root.appendingPathComponent("Contents/tone1.wav")
        try FileManager.default.createDirectory(at: audio.deletingLastPathComponent(), withIntermediateDirectories: true)
        let bytes = Data(repeating: 7, count: 1234); try bytes.write(to: audio)
        let preview = try RekordboxUSBPreview.scan(root: root)
        XCTAssertThrowsError(try RekordboxUSBCopy.copy(root: root, preview: preview, selected: [2], destination: destination))
        XCTAssertThrowsError(try RekordboxUSBCopy.copy(root: root, preview: preview, selected: [1], destination: root.appendingPathComponent("imports")))
        let result = try RekordboxUSBCopy.copy(root: root, preview: preview, selected: [1], destination: destination)
        XCTAssertEqual(try Data(contentsOf: result.appendingPathComponent("1.wav")), bytes)
        XCTAssertEqual(try Data(contentsOf: audio), bytes)
        XCTAssertEqual(try Data(contentsOf: db), original)
        let manifest = try JSONDecoder().decode(USBImportReceipt.self, from: Data(contentsOf: result.appendingPathComponent("import.json")))
        XCTAssertEqual(manifest.tracks.map(\.title), ["Süper pulse 1"])
        XCTAssertEqual(manifest.playlists.first?.trackIds, [1])
        try Data(repeating: 9, count: 1234).write(to: audio)
        XCTAssertThrowsError(try RekordboxUSBCopy.copy(root: root, preview: preview, selected: [1], destination: destination))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: destination.path).count, 1, "No partial imports after changed audio")
        var changed = original; changed[20] ^= 1; try changed.write(to: db)
        XCTAssertThrowsError(try RekordboxUSBCopy.copy(root: root, preview: preview, selected: [1], destination: destination))
    }
}


extension RekordboxUSBTests {
    func testDeterministicMalformedCorpusNeverTrapsOrLoops() throws {
        let original = try fixture()
        var state: UInt64 = 0x6319
        for _ in 0..<250 {
            state = state &* 6364136223846793005 &+ 1
            var changed = original
            let offset = Int(state % UInt64(changed.count))
            changed[offset] ^= UInt8(truncatingIfNeeded: state >> 32) | 1
            _ = try? RekordboxUSBReader.read(changed)
        }
    }
}
