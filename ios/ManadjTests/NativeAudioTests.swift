import XCTest
import UIKit
import AVFoundation
import ManadjAudio
import ManadjCore
import CEngine
@testable import Manadj

final class NativeAudioTests: XCTestCase {
    @MainActor func testCueFlagGeometryKeepsEdgesVisibleAndMinimapsCompact() {
        let lane = CGRect(x: 0, y: 0, width: 300, height: 48)
        for vertical in [false, true] {
            let end: CGFloat = vertical ? lane.height : lane.width
            for position in [CGFloat(0), end / 2, end] {
                let detail = PerformanceWaveView.cueFlagRect(at: position, bounds: lane, vertical: vertical, overview: false)
                let overview = PerformanceWaveView.cueFlagRect(at: position, bounds: lane, vertical: vertical, overview: true)
                XCTAssertTrue(lane.contains(detail))
                XCTAssertTrue(lane.contains(overview))
                XCTAssertEqual(detail.width, 14)
                XCTAssertEqual(overview.width, 5)
            }
        }
    }

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
    @MainActor func testLongLibraryTrackStreamsAndSeeksWithoutFullDecode() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".caf")
        defer { try? FileManager.default.removeItem(at: url) }
        // 360s at 48kHz exceeds the 16,777,216-frame full-decode ceiling.
        // Write a bounded one-second buffer repeatedly, not a whole-track array.
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1))
        do {
            let file = try AVAudioFile(forWriting: url, settings: format.settings)
            let pcm = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 48000))
            pcm.frameLength = 48000
            let channel = try XCTUnwrap(pcm.floatChannelData)[0]
            for i in 0..<48000 { channel[i] = Float(sin(Double(i) * .pi * 2 * 220 / 48000)) * 0.05 }
            for _ in 0..<360 { try file.write(from: pcm) }
        }
        let audio = try NativeAudio()
        let duration = try await audio.load(url, deck: 0)
        XCTAssertEqual(duration, 360, accuracy: 0.001)
        XCTAssertTrue(audio.state(0).ready)
        XCTAssertFalse(audio.state(0).fullyDecoded, "Long library tracks must use the bounded streaming path")
        audio.send(MDJPlay)
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertGreaterThan(audio.state(0).position, 0.05)
        // Seek beyond the initial ring contents: fresh decoder refill is required.
        audio.send(MDJSeek, value: 350)
        for _ in 0..<100 {
            if audio.state(0).position > 350.05 { break }
            try await Task.sleep(for: .milliseconds(30))
        }
        XCTAssertGreaterThan(audio.state(0).position, 350.05)
        XCTAssertLessThan(audio.state(0).position, 354)
        XCTAssertFalse(audio.state(0).fullyDecoded)
        // Decoder reaches EOF, then remains available for a backwards refill.
        audio.send(MDJSeek, value: 359.8)
        try await Task.sleep(for: .milliseconds(700))
        XCTAssertEqual(audio.state(0).position, 360, accuracy: 0.05)
        audio.send(MDJSeek, value: 30)
        audio.send(MDJPlay)
        for _ in 0..<100 {
            if audio.state(0).position > 30.05 && audio.state(0).position < 34 { break }
            try await Task.sleep(for: .milliseconds(30))
        }
        XCTAssertGreaterThan(audio.state(0).position, 30.05)
        XCTAssertLessThan(audio.state(0).position, 34)
        XCTAssertTrue(audio.state(0).playing)
        audio.send(MDJPause)
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
    @MainActor func testLocalLiveRealPairedSyntheticHostAndNativeTakeover() async throws {
        let fixture = try XCTUnwrap(Bundle.main.url(forResource: "lan-fixture", withExtension: "json"))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        let origin = try XCTUnwrap(object["origin"] as? String)
        let url = try XCTUnwrap(URL(string: origin))
        let candidate = SyncClient(try DesktopConnection(url: url))
        let ticket = try await candidate.requestPairing(deviceId: UUID().uuidString, deviceName: "Synthetic local-live test")
        var token: String?
        for _ in 0..<40 {
            if let value = try await candidate.pollPairing(ticket).token { token = value; break }
            try await Task.sleep(for: .milliseconds(100))
        }
        let connection = try DesktopConnection(url: url, deviceToken: XCTUnwrap(token))
        var envelope = try await SyncClient(connection).liveState()
        for _ in 0..<60 {
            if envelope.state == "live" { break }
            try await Task.sleep(for: .milliseconds(100))
            envelope = try await SyncClient(connection).liveState()
        }
        XCTAssertEqual(envelope.state, "live")
        XCTAssertEqual(envelope.anchor?.decks.count, 4)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("live-test-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let model = AppModel(storageRoot: root)
        for _ in 0..<100 {
            if model.status.contains("Pair with") { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        model.useLocalLiveTestConnection(connection)
        model.startLocalLive()
        defer { model.stopLocalLive() }
        var heardPlaying = false
        for _ in 0..<250 {
            if model.audio?.state(0).playing == true { heardPlaying = true; break }
            try await Task.sleep(for: .milliseconds(40))
        }
        XCTAssertTrue(heardPlaying, model.liveStatus + " " + (model.error ?? ""))
        XCTAssertEqual(model.decks[0].title, "Synthetic LAN Tone")
        XCTAssertGreaterThan(model.liveRoundTrip, 0)
        var sawStalePause = false
        for _ in 0..<300 {
            if model.liveStatus.contains("Waiting for fresh") || model.liveStatus.contains("Desktop is not live") {
                try await Task.sleep(for: .milliseconds(100))
                sawStalePause = model.audio?.state(0).playing != true
                if sawStalePause { break }
            }
            try await Task.sleep(for: .milliseconds(40))
        }
        XCTAssertTrue(sawStalePause, "Synthetic source silence must pause native sound: " + model.liveStatus)
        model.stopLocalLive()
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertFalse(model.audio?.state(0).playing == true)
        XCTAssertFalse(model.liveListening)
    }

}
