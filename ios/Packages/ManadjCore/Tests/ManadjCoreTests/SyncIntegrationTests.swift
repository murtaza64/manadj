#if os(Linux) || os(macOS)
import XCTest
import Foundation
import Dispatch
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import ManadjCore

final class SyncIntegrationTests: XCTestCase, @unchecked Sendable {
    final class Fixture {
        let process = Process()
        let url: URL
        private let stopped: DispatchSemaphore
        init() throws {
            let didExit = DispatchSemaphore(value: 0)
            stopped = didExit
            process.terminationHandler = { _ in didExit.signal() }
            let script = try XCTUnwrap(Bundle.module.url(forResource: "sync_fixture", withExtension: "py"))
            let portFile = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: portFile) }
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = ["python3", script.path, portFile.path]
            try process.run()
            let deadline = Date().addingTimeInterval(5)
            while !FileManager.default.fileExists(atPath: portFile.path), Date() < deadline {
                Thread.sleep(forTimeInterval: 0.01)
            }
            let number = try XCTUnwrap(Int(String(contentsOf: portFile, encoding: .utf8)))
            url = try XCTUnwrap(URL(string: "http://127.0.0.1:\(number)"))
        }
        deinit {
            // waitUntilExit can hang on a Swift concurrency worker after the
            // child has already exited. Observe termination off that run loop
            // and bound cleanup, without hiding a failed fixture shutdown.
            if process.isRunning { process.terminate() }
            if stopped.wait(timeout: .now() + 2) == .timedOut {
                if process.isRunning { _ = kill(process.processIdentifier, SIGKILL) }
                let forcedExit = stopped.wait(timeout: .now() + 2)
                XCTFail("Sync fixture did not stop after SIGTERM (forced exit observed: \(forcedExit == .success))")
            }
        }
        func client(token: String = "fixture-not-a-real-token") throws -> SyncClient {
            SyncClient(try DesktopConnection(url: url, deviceToken: token))
        }
    }
    func testPairingSnapshotAndPreviewsAgainstHTTP() async throws {
        let fixture = try Fixture()
        let client = try fixture.client()
        let ticket = try await client.requestPairing(deviceId: "test-device", deviceName: "Test iPhone")
        XCTAssertEqual(ticket.id, "0123456789abcdef0123456789abcdef")
        XCTAssertEqual(ticket.matchCode, "1234")
        let result = try await client.pollPairing(ticket)
        XCTAssertEqual(result.status, "approved")
        XCTAssertEqual(result.token, "fixture-not-a-real-token")
        let snapshot = try await client.snapshotText()
        XCTAssertEqual(try SnapshotJson.parse(snapshot).version, 1)
        let previews = try await client.previews([])
        XCTAssertTrue(previews.isEmpty)
        do { _ = try await fixture.client(token: "wrong").snapshotText(); XCTFail("Expected authorization failure") }
        catch let error as SyncError { XCTAssertEqual(error.status, 401) }
    }
    func testRepositoryBulkSyncSkipsUnavailableTracksAndPreservesOfflineAudio() async throws {
        let fixture = try Fixture()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LibraryRepository(root: root)
        let connection = try DesktopConnection(url: fixture.url, deviceToken: "fixture-not-a-real-token")
        let snapshot = try await repository.sync(connection, allAudio: true)
        XCTAssertEqual(snapshot.tracks.count, 2)
        let downloaded = await repository.downloadedIds()
        XCTAssertEqual(downloaded, [1])
        let cached = try await repository.audio(snapshot.tracks[0], connection: nil)
        XCTAssertEqual(try Data(contentsOf: cached).count, 1024)
        let reopened = try LibraryRepository(root: root)
        let reopenedIds = await reopened.downloadedIds()
        XCTAssertEqual(reopenedIds, [1])
    }
    actor ProgressLog {
        var items: [LibrarySyncProgress] = []
        func record(_ p: LibrarySyncProgress) { items.append(p) }
    }
    func testAudioProgressCountsValidatedAndCachedFilesNotUnavailableOnes() async throws {
        let fixture = try Fixture()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LibraryRepository(root: root)
        let connection = try DesktopConnection(url: fixture.url, deviceToken: "fixture-not-a-real-token")
        let first = ProgressLog()
        _ = try await repository.sync(connection, allAudio: true) { await first.record($0) }
        let events = await first.items
        XCTAssertEqual(events.first?.phase, .library)
        XCTAssertEqual(events.filter { $0.phase == .audio }, [.init(phase: .audio, completed: 0, total: 1), .init(phase: .audio, completed: 1, total: 1)])
        let retry = ProgressLog()
        _ = try await repository.sync(connection, allAudio: true) { await retry.record($0) }
        let retryEvents = await retry.items
        XCTAssertEqual(retryEvents.filter { $0.phase == .audio }, [.init(phase: .audio, completed: 1, total: 1)])
    }
    func testRepositoryRejectsConcurrentSyncWithoutReplacingActiveWork() async throws {
        let fixture = try Fixture()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LibraryRepository(root: root)
        let connection = try DesktopConnection(url: fixture.url, deviceToken: "fixture-not-a-real-token")
        let results = await withTaskGroup(of: Bool.self, returning: [Bool].self) { group in
            for _ in 0..<2 {
                group.addTask {
                    do { _ = try await repository.sync(connection); return true }
                    catch { return false }
                }
            }
            var results: [Bool] = []
            for await result in group { results.append(result) }
            return results
        }
        XCTAssertEqual(results.filter { $0 }.count, 1)
        XCTAssertEqual(results.filter { !$0 }.count, 1)
        // Completion releases the gate so the next explicit sync can succeed.
        _ = try await repository.sync(connection)
    }
    func testDownloadValidatesRevisionLengthAndRejectsRedirects() async throws {
        let fixture = try Fixture(), client = try fixture.client()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let target = root.appendingPathComponent("track.wav")
        try await client.downloadAudio(1, to: target, expectedBytes: 1024, expectedRevision: "fixture-revision")
        let original = try Data(contentsOf: target)
        XCTAssertEqual(original.count, 1024)
        do { try await client.downloadAudio(1, to: target, expectedBytes: 1024, expectedRevision: "stale"); XCTFail("Expected revision mismatch") }
        catch is SyncError {}
        XCTAssertEqual(try Data(contentsOf: target), original)
        do { try await client.downloadAudio(1, to: target, expectedBytes: 999, expectedRevision: "fixture-revision"); XCTFail("Expected length mismatch") }
        catch is SyncError {}
        XCTAssertEqual(try Data(contentsOf: target), original)
        do { try await client.downloadAudio(2, to: target); XCTFail("Expected redirect rejection") }
        catch let error as SyncError { XCTAssertEqual(error.status, 302) }
        let (stats, _) = try await URLSession.shared.data(from: fixture.url.appendingPathComponent("stats"))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: stats) as? [String: Int])
        XCTAssertEqual(object["captures"], 0, "Redirect must never forward device credentials")
        XCTAssertEqual(try Data(contentsOf: target), original)
    }
}
#endif
