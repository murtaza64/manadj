import XCTest
import Foundation
import ManadjCore
import ManadjAudio
import CEngine
@testable import Manadj

final class LocalLiveRecoveryTests: XCTestCase {
    @MainActor func testTimeoutThenFreshEnvelopePausesAudioAndRetriesSameFetch() async throws {
        let root = try XCTUnwrap(AppModel.makeLibraryUIFixture())
        defer { try? FileManager.default.removeItem(at: root) }
        let model = AppModel(storageRoot: root)
        for _ in 0..<150 {
            if model.snapshot != nil && model.downloaded.contains(1) { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        let track = try XCTUnwrap(model.snapshot?.tracks.first { $0.id == 1 })
        XCTAssertTrue(model.load(track, deck: 0))
        for _ in 0..<150 {
            if !model.decks[0].loading { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        let audio = try XCTUnwrap(model.audio)
        audio.send(MDJPlay, deck: 0)
        try await Task.sleep(for: .milliseconds(60))
        XCTAssertTrue(audio.state(0).playing)
        model.liveListening = true
        var calls = 0
        let (envelope, _) = try await model.pollLocalLiveState {
            calls += 1
            if calls == 1 { throw URLError(.timedOut) }
            XCTAssertFalse(audio.state(0).playing, "Transport interruption must pause real native sound before another frame")
            XCTAssertTrue(model.liveStatus.contains("waiting for fresh desktop state"))
            return try LiveEnvelope.parse(Data(#"{"version":1,"state":"offline","age":0,"anchor":null}"#.utf8))
        }
        XCTAssertEqual(calls, 2)
        XCTAssertEqual(envelope.state, "offline")
        // Same strict one-second bound as LiveDeckAnchor.target. A slow frame
        // pauses native sound and returns to polling rather than escaping it.
        audio.send(MDJPlay, deck: 0)
        try await Task.sleep(for: .milliseconds(60))
        XCTAssertTrue(audio.state(0).playing)
        XCTAssertTrue(try model.deferLocalLiveForRoundTrip(1.1409725833333368))
        try await Task.sleep(for: .milliseconds(60))
        XCTAssertFalse(audio.state(0).playing)
        XCTAssertTrue(model.liveListening)
        XCTAssertTrue(model.liveStatus.hasPrefix("Waiting for fresh"))
        XCTAssertFalse(try model.deferLocalLiveForRoundTrip(0.05))
        XCTAssertFalse(try model.deferLocalLiveForRoundTrip(1))
        for invalid in [-1.0, Double.infinity, Double.nan] {
            XCTAssertThrowsError(try model.deferLocalLiveForRoundTrip(invalid))
        }
        model.stopLocalLive()
    }

    @MainActor func testPermanentAndCancelledErrorsNeverRetry() async throws {
        let failures: [Error] = [SyncError("Not paired", status: 401), SyncError("Invalid live anchor"), URLError(.cancelled), URLError(.badServerResponse)]
        for failure in failures {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: root) }
            let model = AppModel(storageRoot: root)
            model.liveListening = true
            var calls = 0
            do {
                _ = try await model.pollLocalLiveState { calls += 1; throw failure }
                XCTFail("Permanent or cancelled failure must escape")
            } catch { XCTAssertEqual(calls, 1) }
            model.stopLocalLive()
        }
    }

    @MainActor func testStopDuringRetryDelayDoesNotFetchOrOverwriteStop() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let model = AppModel(storageRoot: root)
        model.liveListening = true
        var calls = 0
        let task = Task { @MainActor in
            try await model.pollLocalLiveState { calls += 1; throw URLError(.networkConnectionLost) }
        }
        for _ in 0..<25 {
            if calls > 0 { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertEqual(calls, 1)
        model.stopLocalLive()
        task.cancel()
        do { _ = try await task.value; XCTFail("Stopped retry must cancel") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(calls, 1)
        XCTAssertTrue(model.liveStatus.hasPrefix("Stopped"))
    }
}
