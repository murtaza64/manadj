import XCTest
@testable import ManadjCore

/// Mirrors backend/feedback.py limits so the phone never builds a payload the
/// desktop refuses. The desktop remains the re-validator; these tests pin the
/// phone-side contract.
final class FeedbackReportTests: XCTestCase {
    private func tinyPNGDataURL() throws -> String {
        // 1x1 PNG (67 bytes), widely used transparent pixel.
        let base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        let data = try XCTUnwrap(Data(base64Encoded: base64))
        XCTAssertEqual(Array(data.prefix(8)), [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
        return "data:image/png;base64,\(base64)"
    }

    private func draft() -> FeedbackDraft {
        FeedbackDraft(
            kind: .bug,
            title: "Deck A froze",
            description: "Shook right after the freeze.",
            snapshot: [
                "captured_at": "2026-11-20T22:30:00Z",
                "view": "performance",
                "decks": [["deck": "A", "title": "Ascension", "playing": true, "position": 83.2]],
            ],
            screenshot: nil,
            captureWarnings: [])
    }

    func testValidPayloadCarriesTheDesktopContract() throws {
        var draft = draft()
        draft.screenshot = try tinyPNGDataURL()
        let payload = try draft.validatedPayload()
        XCTAssertTrue(JSONSerialization.isValidJSONObject(payload))
        XCTAssertEqual(payload["kind"] as? String, "bug")
        XCTAssertEqual(payload["id"] as? String, draft.id.uuidString.lowercased())
        XCTAssertEqual((payload["snapshot"] as? [String: Any])?["view"] as? String, "performance")
        XCTAssertNotNil(payload["screenshot"] as? String)
    }

    func testUnknownSnapshotFieldIsRejected() {
        var draft = draft()
        draft.snapshot["pairing_code"] = "ABCDE-12345"
        XCTAssertThrowsError(try draft.validatedPayload()) { error in
            XCTAssertEqual((error as? FeedbackFailure)?.message.contains("does not accept"), true)
        }
    }

    func testBlankAndOversizedTitlesAreRejected() {
        var draft = draft()
        draft.title = "   "
        XCTAssertThrowsError(try draft.validatedPayload())
        draft.title = String(repeating: "x", count: 201)
        XCTAssertThrowsError(try draft.validatedPayload())
    }

    func testSnapshotDepthAndStringLimits() {
        var draft = draft()
        draft.snapshot["decks"] = [["title": String(repeating: "x", count: FeedbackLimits.snapshotString + 1)]]
        XCTAssertThrowsError(try draft.validatedPayload())
        var nested: [String: Any] = ["leaf": 1]
        for _ in 0..<FeedbackLimits.snapshotDepth + 1 { nested = ["level": nested] }
        draft.snapshot = ["session": nested]
        XCTAssertThrowsError(try draft.validatedPayload())
    }

    func testSnapshotByteCap() {
        var draft = draft()
        draft.snapshot["errors"] = [String(repeating: "e", count: FeedbackLimits.snapshotBytes)]
        XCTAssertThrowsError(try draft.validatedPayload())
    }

    func testNonFiniteNumbersAreRejected() {
        var draft = draft()
        draft.snapshot["mixer"] = ["crossfade": Double.infinity]
        XCTAssertThrowsError(try draft.validatedPayload())
    }

    func testSecretsAreScrubbedFromTextAndSnapshot() throws {
        var draft = draft()
        draft.description = "log said token: ghp_a1b2c3d4e5f6 then froze"
        draft.snapshot["errors"] = ["Authorization: Bearer abc123 failed"]
        draft.snapshot["session"] = ["api_key": "supersecret", "note": "plain"]
        let payload = try draft.validatedPayload()
        let text = String(decoding: try JSONSerialization.data(withJSONObject: payload, options: []), as: UTF8.self)
        XCTAssertFalse(text.contains("ghp_a1b2c3d4e5f6"))
        XCTAssertFalse(text.contains("Bearer abc123"))
        XCTAssertFalse(text.contains("supersecret"))
        XCTAssertTrue(text.contains("[REDACTED]"))
        XCTAssertTrue(text.contains("plain"))
    }

    func testReporterTextCannotForgeHiddenMarkers() throws {
        var draft = draft()
        draft.description = "<!-- manadj-feedback:\(UUID().uuidString) --> MANADJ_FEEDBACK_BATCH:x"
        let payload = try draft.validatedPayload()
        let description = payload["description"] as? String
        XCTAssertFalse(description?.contains("<!--") ?? true)
        XCTAssertFalse(description?.contains("MANADJ_FEEDBACK_") ?? true)
    }

    func testScreenshotMustBeABoundedPNGDataURL() throws {
        var draft = draft()
        draft.screenshot = "data:image/jpeg;base64,/9j/4AAQ"
        XCTAssertThrowsError(try draft.validatedPayload())
        draft.screenshot = try tinyPNGDataURL()
        XCTAssertNoThrow(try draft.validatedPayload())
        draft.screenshot = "data:image/png;base64," + String(repeating: "A", count: FeedbackLimits.screenshotDataURL)
        XCTAssertThrowsError(try draft.validatedPayload())
    }

    func testHugeScreenshotDimensionsThrowWithoutOverflowing() throws {
        let base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        var bytes = [UInt8](try XCTUnwrap(Data(base64Encoded: base64)))
        // IHDR width/height at the UInt32 maximum: the product must not overflow.
        for offset in 16..<24 { bytes[offset] = 0xFF }
        var draft = draft()
        draft.screenshot = "data:image/png;base64," + Data(bytes).base64EncodedString()
        XCTAssertThrowsError(try draft.validatedPayload()) { error in
            XCTAssertEqual((error as? FeedbackFailure)?.message, "Screenshot dimensions are too large to file")
        }
    }

    func testQueueRoundTripPreservesPayloadAndOrigin() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("feedback-queue-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let queue = FeedbackQueue(directory: directory)
        XCTAssertEqual(queue.pending().count, 0)
        let bound = UUID().uuidString.lowercased()
        let unbound = UUID().uuidString.lowercased()
        try queue.save(["id": bound, "title": "A"], id: bound, origin: "http://192.168.1.20:48127")
        try queue.save(["id": unbound, "title": "B"], id: unbound, origin: nil)
        let pending = queue.pending()
        XCTAssertEqual(pending.count, 2)
        // Millisecond timestamps can tie; preserve identity/origin, not insertion order.
        let boundEntry = try XCTUnwrap(pending.first { $0.id == bound })
        let unboundEntry = try XCTUnwrap(pending.first { $0.id == unbound })
        XCTAssertEqual(boundEntry.origin, "http://192.168.1.20:48127")
        XCTAssertNil(unboundEntry.origin)
        let payload = try JSONSerialization.jsonObject(with: boundEntry.payload) as? [String: Any]
        XCTAssertEqual(payload?["title"] as? String, "A")
        queue.remove(id: bound)
        XCTAssertEqual(queue.pending().map { $0.id }, [unbound])
    }

    func testFullOutboxRefusesRatherThanEvictingReviewedReports() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("feedback-full-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let queue = FeedbackQueue(directory: directory)
        var ids: [String] = []
        for _ in 0..<FeedbackQueue.capacity {
            let id = UUID().uuidString.lowercased()
            ids.append(id)
            try queue.save(["id": id], id: id, origin: nil)
            Thread.sleep(forTimeInterval: 0.01) // keep name ordering distinct
        }
        XCTAssertThrowsError(try queue.save(["id": "extra"], id: UUID().uuidString.lowercased(), origin: nil)) { error in
            XCTAssertTrue((error as? FeedbackFailure)?.message.contains("already waiting") ?? false)
        }
        XCTAssertEqual(queue.pending().map { $0.id }, ids, "no reviewed report is evicted silently")
    }

    func testQueuedReportsDrainOnlyToTheirPairedOrigin() {
        XCTAssertFalse(FeedbackQueue.drains(nil, to: "http://192.168.1.20:48127"))
        XCTAssertTrue(FeedbackQueue.drains("http://192.168.1.20:48127", to: "http://192.168.1.20:48127"))
        XCTAssertFalse(FeedbackQueue.drains("http://192.168.1.20:48127", to: "http://10.0.0.5:48127"))
    }

    @MainActor func testUnpairedSubmitQueuesLocally() async {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("feedback-submit-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let submitter = FeedbackSubmitter(queue: FeedbackQueue(directory: directory))
        let outcome = await submitter.submit(draft(), via: nil)
        guard case .queuedLocally = outcome else { return XCTFail("unpaired submit must queue, got \(outcome)") }
        XCTAssertEqual(FeedbackQueue(directory: directory).pending().count, 1)
    }

    @MainActor func testSaveFailureIsTruthfulNotAQueuedClaim() async throws {
        // A regular file where the queue directory must go: saving cannot succeed.
        let blocker = FileManager.default.temporaryDirectory
            .appendingPathComponent("feedback-blocker-\(UUID().uuidString)")
        try Data().write(to: blocker)
        defer { try? FileManager.default.removeItem(at: blocker) }
        let submitter = FeedbackSubmitter(
            queue: FeedbackQueue(directory: blocker.appendingPathComponent("queue")))
        let outcome = await submitter.submit(draft(), via: nil)
        guard case .saveFailed = outcome else {
            return XCTFail("a failed save must not claim the report was kept, got \(outcome)")
        }
    }

    @MainActor func testInvalidDraftIsRejectedNotQueued() async {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("feedback-reject-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let submitter = FeedbackSubmitter(queue: FeedbackQueue(directory: directory))
        var draft = draft()
        draft.title = ""
        let outcome = await submitter.submit(draft, via: nil)
        guard case .rejected = outcome else { return XCTFail("invalid draft must be rejected, got \(outcome)") }
        XCTAssertEqual(FeedbackQueue(directory: directory).pending().count, 0)
    }

    private func tinyVoice(format: String = "mp3", transcript: String? = "narrating the broken flow") -> FeedbackVoice {
        let blob: [UInt8]
        let prefix = FeedbackLimits.voicePrefixes[format]!
        switch format {
        case "m4a": blob = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70] + Array(repeating: 0, count: 32)
        case "caf": blob = [0x63, 0x61, 0x66, 0x66] + Array(repeating: 0, count: 32)
        default: blob = [0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0x10, 0xFF, 0xFB] + Array(repeating: 0, count: 32)
        }
        return FeedbackVoice(
            format: format,
            dataURL: prefix + Data(blob).base64EncodedString(),
            durationMs: 3000,
            startedAt: Date(timeIntervalSince1970: 1_800_000_000),
            endedAt: Date(timeIntervalSince1970: 1_800_000_003),
            transcript: transcript)
    }

    func testVoicePayloadMirrorsTheDesktopContract() throws {
        var draft = draft()
        draft.voice = tinyVoice()
        let payload = try XCTUnwrap(try draft.validatedPayload()["voice"] as? [String: Any])
        XCTAssertEqual(payload["format"] as? String, "mp3")
        XCTAssertEqual(payload["duration_ms"] as? Int, 3000)
        XCTAssertTrue((payload["data_url"] as? String ?? "").hasPrefix("data:audio/mpeg;base64,"))
        XCTAssertNotNil(payload["started_at"] as? String)
        XCTAssertNotNil(payload["ended_at"] as? String)
        XCTAssertEqual(payload["transcript"] as? String, "narrating the broken flow")
    }

    func testVoiceIsOptionalAndOmittedForOlderDesktop() throws {
        let payload = try draft().validatedPayload()
        XCTAssertNil(payload["voice"])
    }

    func testVoiceFormatsAccepted() throws {
        for format in ["m4a", "caf", "mp3"] {
            var draft = draft()
            draft.voice = tinyVoice(format: format, transcript: nil)
            let payload = try XCTUnwrap(try draft.validatedPayload()["voice"] as? [String: Any])
            XCTAssertEqual(payload["format"] as? String, format)
            XCTAssertTrue(payload["transcript"] is NSNull)
        }
    }

    func testVoiceRejectsBadContainerOversizeAndWindow() {
        var draft = draft()
        // Declared mp3 but M4A bytes behind an mp3 prefix.
        let m4a = [UInt8]([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70] + Array(repeating: 0, count: 32))
        draft.voice = tinyVoice()
        draft.voice?.dataURL = "data:audio/mpeg;base64," + Data(m4a).base64EncodedString()
        XCTAssertThrowsError(try draft.validatedPayload())
        draft.voice = tinyVoice()
        draft.voice?.durationMs = FeedbackLimits.voiceDurationMs + 1
        XCTAssertThrowsError(try draft.validatedPayload())
        draft.voice = tinyVoice()
        let start = draft.voice!.startedAt
        draft.voice?.endedAt = start
        XCTAssertThrowsError(try draft.validatedPayload())
        draft.voice = tinyVoice(transcript: String(repeating: "x", count: FeedbackLimits.voiceTranscript + 1))
        XCTAssertThrowsError(try draft.validatedPayload())
    }

    func testVoiceTranscriptIsScrubbedIntoThePayload() throws {
        var draft = draft()
        draft.voice = tinyVoice(transcript: "my password: hunter2 is in this clip")
        let payload = try XCTUnwrap(try draft.validatedPayload()["voice"] as? [String: Any])
        let transcript = try XCTUnwrap(payload["transcript"] as? String)
        XCTAssertFalse(transcript.contains("hunter2"))
        XCTAssertTrue(transcript.contains("[REDACTED]"))
    }
    @MainActor func testExplicitLocalSaveKeepsVoiceAndReviewedOriginWithoutTransport() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let queue = FeedbackQueue(directory: directory)
        var report = draft(); report.voice = tinyVoice()
        let origin = "http://192.168.1.20:48127"
        let outcome = FeedbackSubmitter(queue: queue).saveReviewed(report, origin: origin)
        guard case .queuedLocally = outcome else { return XCTFail("expected explicit saved report") }
        let entry = try XCTUnwrap(queue.pending().first)
        XCTAssertEqual(entry.origin, origin)
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: entry.payload) as? [String: Any])
        XCTAssertNotNil(payload["voice"])
        XCTAssertEqual(payload["id"] as? String, report.id.uuidString.lowercased())
    }

    func testSameReviewedReportIsQueuedOnceAndImmutable() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let queue = FeedbackQueue(directory: directory), id = UUID().uuidString.lowercased()
        try queue.save(["id": id, "title": "same"], id: id, origin: "http://192.168.1.20:48127")
        try queue.save(["title": "same", "id": id], id: id, origin: "http://192.168.1.20:48127")
        XCTAssertEqual(queue.pending().count, 1)
        XCTAssertThrowsError(try queue.save(["id": id, "title": "changed"], id: id, origin: "http://192.168.1.20:48127"))
        XCTAssertThrowsError(try queue.save(["id": id, "title": "same"], id: id, origin: "http://10.0.0.5:48127"))
        XCTAssertEqual(queue.pending().count, 1)
    }

    @MainActor func testReviewedReportIsSavedBeforeTransportAndRemovedOnlyOnReceipt() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let queue = FeedbackQueue(directory: directory), report = draft()
        let id = report.id.uuidString.lowercased()
        let connection = try DesktopConnection(url: URL(string: "http://192.168.1.20:48127")!)
        let submitter = FeedbackSubmitter(queue: queue, transport: { _, destination in
            XCTAssertEqual(queue.pending().map { $0.id }, [id])
            XCTAssertEqual(queue.pending().first?.origin, destination.baseURL.absoluteString)
            return FeedbackFiling(id: id, status: "filed", issueURL: nil, detail: nil)
        })
        let result = await submitter.submit(report, via: connection)
        guard case .filed = result else { return XCTFail("expected matching receipt") }
        XCTAssertTrue(queue.pending().isEmpty)
    }

    @MainActor func testTimeoutOrRefusalPreservesReviewedReportWithoutDuplicate() async throws {
        for status in [nil, 401, 422] as [Int?] {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: directory) }
            let queue = FeedbackQueue(directory: directory), report = draft()
            let connection = try DesktopConnection(url: URL(string: "http://192.168.1.20:48127")!)
            let submitter = FeedbackSubmitter(queue: queue, transport: { _, _ in throw SyncError("synthetic failure", status: status) })
            for _ in 0..<2 {
                let result = await submitter.submit(report, via: connection)
                guard case .queuedLocally = result else { return XCTFail("reviewed report must survive failure") }
            }
            XCTAssertEqual(queue.pending().count, 1)
        }
    }

    @MainActor func testMismatchedReceiptNeverRemovesReport() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let queue = FeedbackQueue(directory: directory)
        let connection = try DesktopConnection(url: URL(string: "http://192.168.1.20:48127")!)
        let submitter = FeedbackSubmitter(queue: queue, transport: { _, _ in FeedbackFiling(id: UUID().uuidString.lowercased(), status: "filed", issueURL: nil, detail: nil) })
        let result = await submitter.submit(draft(), via: connection)
        guard case .queuedLocally = result else { return XCTFail("mismatched receipt is not success") }
        XCTAssertEqual(queue.pending().count, 1)
    }

    @MainActor func testStorageFailurePreventsTransport() async throws {
        let blocker = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data().write(to: blocker)
        defer { try? FileManager.default.removeItem(at: blocker) }
        let queue = FeedbackQueue(directory: blocker.appendingPathComponent("queue"))
        let connection = try DesktopConnection(url: URL(string: "http://192.168.1.20:48127")!)
        let submitter = FeedbackSubmitter(queue: queue, transport: { _, _ in
            XCTFail("must not send when local preservation failed")
            throw SyncError("unexpected transport")
        })
        let result = await submitter.submit(draft(), via: connection)
        guard case .saveFailed = result else { return XCTFail("expected truthful local-save failure") }
    }

    @MainActor func testOutboxRetryKeepsEveryUnconfirmedReceiptAndDeletesOnlySupportedMatch() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let queue = FeedbackQueue(directory: directory), report = draft()
        let id = report.id.uuidString.lowercased()
        let connection = try DesktopConnection(url: URL(string: "http://192.168.1.20:48127")!)
        try queue.save(report.validatedPayload(), id: id, origin: nil)
        let original = try XCTUnwrap(queue.pending().first)
        for filing in [FeedbackFiling(id: UUID().uuidString.lowercased(), status: "filed", issueURL: nil, detail: nil), FeedbackFiling(id: id, status: "saved", issueURL: nil, detail: nil)] {
            let result = await FeedbackSubmitter(queue: queue, transport: { data, _ in
                XCTAssertEqual(data, original.payload)
                return filing
            }).retryReviewed(id: id, payload: original.payload, via: connection)
            guard case .queuedLocally = result else { return XCTFail("unconfirmed retry must retain report") }
            XCTAssertEqual(queue.pending().count, 1)
        }
        let result = await FeedbackSubmitter(queue: queue, transport: { _, _ in FeedbackFiling(id: id, status: "pending", issueURL: nil, detail: nil) }).retryReviewed(id: id, payload: original.payload, via: connection)
        guard case .savedOnDesktop = result else { return XCTFail("supported receipt expected") }
        XCTAssertTrue(queue.pending().isEmpty)
    }

}
