import XCTest
import AVFoundation
import ManadjAudio
import ManadjCore
import CEngine
@testable import Manadj

final class NativeAudioTests: XCTestCase {
    @MainActor func testAVFoundationDecodeAndTransport() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        defer { try? FileManager.default.removeItem(at: url) }
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2))
        do {
            let file = try AVAudioFile(forWriting: url, settings: format.settings)
            let pcm = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44100))
            pcm.frameLength = 44100
            let channels = try XCTUnwrap(pcm.floatChannelData)
            for i in 0..<44100 { let v = Float(sin(Double(i) * .pi * 2 * 440 / 44100)) * 0.1; channels[0][i] = v; channels[1][i] = v }
            try file.write(from: pcm)
        }
        let audio = try NativeAudio()
        let duration = try await audio.load(url, deck: 0)
        XCTAssertEqual(duration, 1, accuracy: 0.001)
        XCTAssertTrue(audio.state(0).ready)
        XCTAssertTrue(audio.state(0).fullyDecoded)
        XCTAssertTrue(audio.send(MDJPlay))
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertTrue(audio.state(0).playing)
        XCTAssertGreaterThan(audio.state(0).position, 0.05)
        audio.send(MDJPause)
        try await Task.sleep(for: .milliseconds(50))
        audio.send(MDJSeek, value: 0.5)
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(audio.state(0).position, 0.5, accuracy: 0.01)
    }
    @MainActor func testCommonLibraryCodecsDecodeAndPlayNatively() async throws {
        let audio = try NativeAudio()
        for ext in ["mp3", "m4a", "flac", "aiff"] {
            let url = try XCTUnwrap(Bundle.main.url(forResource: "synthetic-codec", withExtension: ext))
            let duration = try await audio.load(url, deck: 0)
            XCTAssertEqual(duration, 2, accuracy: 0.1, ext)
            XCTAssertTrue(audio.state(0).ready, ext)
            XCTAssertTrue(audio.state(0).fullyDecoded, ext)
            audio.send(MDJPlay)
            try await Task.sleep(for: .milliseconds(160))
            XCTAssertTrue(audio.state(0).playing, ext)
            XCTAssertGreaterThan(audio.state(0).position, 0.05, ext)
            audio.send(MDJPause)
            try await Task.sleep(for: .milliseconds(50))
        }
    }
    @MainActor func testRealDesktopPairSyncDownloadAndOfflinePlay() async throws {
        guard let fixture = Bundle.main.url(forResource: "lan-fixture", withExtension: "json") else {
            throw XCTSkip("Use with_lan_fixture.py to exercise the real desktop LAN listener")
        }
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        let origin = try XCTUnwrap(object["origin"] as? String)
        let url = try XCTUnwrap(URL(string: origin))
        XCTAssertEqual(url.host, "127.0.0.1", "Synthetic tests must never use a real user's desktop")
        let client = SyncClient(try DesktopConnection(url: url))
        let ticket = try await client.requestPairing(deviceId: UUID().uuidString, deviceName: "Native synthetic LAN test")
        var token: String?
        for _ in 0..<40 {
            let result = try await client.pollPairing(ticket)
            if let approved = result.token { token = approved; break }
            try await Task.sleep(for: .milliseconds(100))
        }
        let approved = try XCTUnwrap(token, "Real desktop coordinator must approve the synthetic device")
        let connection = try DesktopConnection(url: url, deviceToken: approved)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LibraryRepository(root: root)
        let snapshot = try await repository.sync(connection)
        XCTAssertEqual(snapshot.tracks.count, object["snapshot_tracks"] as? Int)
        let track = try XCTUnwrap(snapshot.tracks.first)
        XCTAssertEqual(track.id, object["track_id"] as? Int)
        XCTAssertEqual(track.audioRev, object["audio_rev"] as? String)
        XCTAssertEqual(track.previewRev, object["preview_rev"] as? String)
        let preview = await repository.preview(track)
        XCTAssertNotNil(preview, "Real MPK1/MWF1 preview must populate the cache")
        let downloaded = try await repository.audio(track, connection: connection)
        XCTAssertEqual(try Data(contentsOf: downloaded).prefix(4), Data("RIFF".utf8))
        let reopened = try LibraryRepository(root: root)
        let cached = try await reopened.audio(track, connection: nil)
        XCTAssertEqual(cached, downloaded, "Offline reopen must use downloaded audio without a connection")
        let audio = try NativeAudio()
        let duration = try await audio.load(cached, deck: 0)
        XCTAssertEqual(duration, 2, accuracy: 0.01)
        XCTAssertTrue(audio.state(0).fullyDecoded)
        audio.send(MDJPlay)
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertTrue(audio.state(0).playing)
        XCTAssertGreaterThan(audio.state(0).position, 0.05)
        audio.send(MDJPause)
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertFalse(audio.state(0).playing)
    }
    func testProjectConfigurationHasLocalNetworkPurposeAndFonts() throws {
        XCTAssertNotNil(Bundle.main.object(forInfoDictionaryKey: "NSLocalNetworkUsageDescription"))
        XCTAssertNotNil(Bundle.main.url(forResource: "UbuntuMono-Regular", withExtension: "ttf"))
    }
    @MainActor func testLibraryLoadAcceptanceIsNotDecodeCompletion() async throws {
        let root = try XCTUnwrap(AppModel.makeLibraryUIFixture())
        defer { try? FileManager.default.removeItem(at: root) }
        let model = AppModel(storageRoot: root)
        for _ in 0..<100 {
            if model.snapshot != nil && model.downloaded.contains(1) { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertTrue(model.downloaded.contains(1), "Fixture cache should finish opening before requesting a load")
        let snapshot = try XCTUnwrap(model.snapshot)
        let cached = try XCTUnwrap(snapshot.tracks.first { $0.id == 1 })
        let offline = try XCTUnwrap(snapshot.tracks.first { $0.id == 2 })
        XCTAssertFalse(model.load(cached, deck: -1))
        XCTAssertFalse(model.load(cached, deck: 4))
        XCTAssertFalse(model.load(offline, deck: 0))
        XCTAssertFalse(model.decks[0].loading)
        XCTAssertTrue(model.load(cached, deck: 0), model.error ?? "Load refused without a reason")
        XCTAssertTrue(model.decks[0].loading)
        XCTAssertFalse(model.load(cached, deck: 0)) // duplicate request is refused synchronously
        for _ in 0..<150 {
            if !model.decks[0].loading { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertFalse(model.decks[0].loading)
        XCTAssertEqual(model.decks[0].track?.id, cached.id)
        XCTAssertTrue(model.audio?.state(0).ready == true)
    }
}
