import XCTest
import UIKit
import AVFoundation
import ManadjAudio
import ManadjCore
import CEngine
@testable import Manadj

final class NativeAudioTests: XCTestCase {
    func testFeedbackTargetMatchesSmallestRegisteredControlAndNeverGuesses() {
        let targets = [FeedbackTarget(label: "Deck A", frame: CGRect(x: 0, y: 0, width: 200, height: 400)),
                       FeedbackTarget(label: "Deck A cue", frame: CGRect(x: 20, y: 200, width: 60, height: 44))]
        let viewport = CGSize(width: 400, height: 800)
        XCTAssertEqual(FeedbackTarget.label(at: CGPoint(x: 0.1, y: 0.275), viewport: viewport, in: targets), "Deck A cue")
        XCTAssertNil(FeedbackTarget.label(at: CGPoint(x: 0.8, y: 0.8), viewport: viewport, in: targets))
        XCTAssertNil(FeedbackTarget.label(at: CGPoint(x: -0.1, y: 0.1), viewport: viewport, in: targets))
        XCTAssertNil(FeedbackTarget.label(at: .zero, viewport: .zero, in: targets))
    }

    @MainActor func testFeedbackTargetMarkerIsFlattenedIntoReviewedImage() throws {
        let image = UIGraphicsImageRenderer(size: CGSize(width: 200, height: 400)).image { context in
            UIColor.black.setFill(); context.fill(CGRect(x: 0, y: 0, width: 200, height: 400))
        }
        let plain = FeedbackCanvasView.flatten(image, strokes: [])
        let marked = FeedbackCanvasView.flatten(image, strokes: [], selection: CGPoint(x: 0.5, y: 0.5))
        XCTAssertNotEqual(plain.pngData(), marked.pngData())
        XCTAssertEqual(marked.size, image.size)
    }

    @MainActor func testPreviewPlayTakeoverSurvivesCueRelease() async throws {
        let audio = try NativeAudio()
        let url = try XCTUnwrap(Bundle.main.url(forResource: "synthetic-A", withExtension: "wav"))
        _ = try await audio.load(url, deck: 0)
        for hotcue in [false, true] {
            audio.send(MDJPause); audio.send(MDJSeek, value: 0)
            if hotcue { audio.send(MDJHotCueSetAt, value: 0, slot: 0) }
            try await Task.sleep(for: .milliseconds(80))
            audio.send(hotcue ? MDJHotCueDown : MDJCueDown, slot: 0)
            try await Task.sleep(for: .milliseconds(80))
            XCTAssertTrue(audio.state(0).preview)
            audio.send(MDJPlay)
            audio.send(hotcue ? MDJHotCueUp : MDJCueUp, slot: 0)
            try await Task.sleep(for: .milliseconds(80))
            XCTAssertTrue(audio.state(0).playing); XCTAssertFalse(audio.state(0).preview)
        }
        audio.send(MDJPause); audio.send(MDJSeek, value: 0)
        try await Task.sleep(for: .milliseconds(80))
        audio.send(MDJCueDown); try await Task.sleep(for: .milliseconds(80))
        audio.send(MDJCueUp); try await Task.sleep(for: .milliseconds(80))
        XCTAssertFalse(audio.state(0).playing); XCTAssertFalse(audio.state(0).preview)
    }

    @MainActor func testLoadedDeckReadsOfflineFullWaveformCache() async throws {
        let root = try XCTUnwrap(AppModel.makePerformanceUIFixture())
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try LibraryStore(root: root.appendingPathComponent("library"))
        let track = try XCTUnwrap(store.readSnapshot()?.tracks.first)
        let model = AppModel(storageRoot: root)
        for _ in 0..<100 { if model.snapshot != nil && model.audio != nil && model.downloaded.contains(track.id) { break }; try await Task.sleep(for: .milliseconds(20)) }
        XCTAssertTrue(model.load(track, deck: 0), model.error ?? "No load error")
        for _ in 0..<200 { if !model.decks[0].loading { break }; try await Task.sleep(for: .milliseconds(20)) }
        XCTAssertGreaterThan(model.decks[0].waveform?.bandFrames ?? 0, 256)
        XCTAssertNil(model.decks[0].waveformNotice)
    }

    @MainActor func testLoadedDeckUsesDecodedDurationAndDoesNotMagnifyPreviewAsDetail() async throws {
        let root = try XCTUnwrap(AppModel.makePerformanceUIFixture())
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try LibraryStore(root: root.appendingPathComponent("library"))
        // Deliberately stale catalog duration. Preview exists but no full-wave revision.
        let stale = try String(contentsOf: store.root.appendingPathComponent("snapshot.json"), encoding: .utf8)
            .replacingOccurrences(of: "\"duration_secs\":24", with: "\"duration_secs\":240")
            .replacingOccurrences(of: ",\"waveform_rev\":\"detail-fixture\"", with: "")
        try store.saveSnapshot(stale)
        let track = try SnapshotJson.parse(stale).tracks[0]
        let model = AppModel(storageRoot: root)
        for _ in 0..<100 { if model.snapshot != nil && model.audio != nil && model.downloaded.contains(track.id) { break }; try await Task.sleep(for: .milliseconds(20)) }
        XCTAssertTrue(model.load(track, deck: 0), model.error ?? "No load error")
        for _ in 0..<200 { if !model.decks[0].loading { break }; try await Task.sleep(for: .milliseconds(20)) }
        XCTAssertEqual(model.decks[0].duration, 24, accuracy: 0.1)
        XCTAssertNil(model.decks[0].waveform, "A cached preview is not a full performance waveform")
        XCTAssertEqual(model.decks[0].waveformNotice, "Full waveform not generated on desktop")
    }

    @MainActor func testSyncWakeScopeRestoresAfterSuccessFailureAndCancellation() async throws {
        var idle = false
        let scope = SyncWakeScope(read: { idle }, write: { idle = $0 })
        await scope.duringTransfer { XCTAssertTrue(idle) }
        XCTAssertFalse(idle)
        enum Expected: Error { case failed }
        do { try await scope.duringTransfer { XCTAssertTrue(idle); throw Expected.failed }; XCTFail() }
        catch Expected.failed {}
        XCTAssertFalse(idle)
        let work = Task { @MainActor in
            do { try await scope.duringTransfer { try await Task.sleep(for: .seconds(30)) } }
            catch { XCTAssertTrue(Task.isCancelled) }
        }
        for _ in 0..<100 where !idle { await Task.yield() }
        XCTAssertTrue(idle)
        work.cancel(); await work.value
        XCTAssertFalse(idle)
        idle = true
        await scope.duringTransfer { XCTAssertTrue(idle) }
        XCTAssertTrue(idle, "Restore previous owner policy, not a guessed false")
    }
    @MainActor func testSyncWakeScopeForegroundAndNestedLifetimes() async {
        var idle = false
        let scope = SyncWakeScope(read: { idle }, write: { idle = $0 })
        await scope.duringTransfer {
            XCTAssertTrue(idle)
            await scope.duringTransfer { XCTAssertTrue(idle) }
            XCTAssertTrue(idle)
            scope.setActive(false); XCTAssertFalse(idle)
            scope.setActive(true); XCTAssertTrue(idle)
        }
        XCTAssertFalse(idle)
        scope.setActive(false)
        await scope.duringTransfer { XCTAssertFalse(idle) }
        scope.setActive(true); XCTAssertFalse(idle, "No idle suppression after transfer finishes")
    }

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
        // The fixture only plays for three seconds in each ten-second cycle.
        // Download/decode plus an overloaded simulator can miss the first window.
        // Keep the behavior assertion, but allow three real fixture cycles rather
        // than assuming readiness and a playing anchor fit inside the first one.
        let readinessStarted = ProcessInfo.processInfo.systemUptime
        let readinessDeadline = readinessStarted + 30
        while ProcessInfo.processInfo.systemUptime < readinessDeadline {
            if model.audio?.state(0).playing == true { heardPlaying = true; break }
            try await Task.sleep(for: .milliseconds(40))
        }
        let readyState = model.audio?.state(0)
        print("SYNTHETIC_LIVE_READINESS elapsed=\(ProcessInfo.processInfo.systemUptime - readinessStarted) heardPlaying=\(heardPlaying) ready=\(readyState?.ready ?? false) decodedSeconds=\(readyState?.decodedSeconds ?? 0) status=\(model.liveStatus)")
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
        XCTAssertTrue(model.liveStatus.hasPrefix("Stopped"), "Cancelled transport must not overwrite STOP")
        // Let the cancelled URLSession completion return to the MainActor.
        try await Task.sleep(for: .milliseconds(400))
        XCTAssertTrue(model.liveStatus.hasPrefix("Stopped"), "STOP stays authoritative after cancellation settles")
        XCTAssertFalse(model.audio?.state(0).playing == true)
    }

}
