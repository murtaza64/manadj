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
        let text = String(decoding: JSONSerialization.data(withJSONObject: payload, options: []), as: UTF8.self)
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
        XCTAssertEqual(pending[0].id, bound)
        XCTAssertEqual(pending[0].origin, "http://192.168.1.20:48127")
        XCTAssertNil(pending[1].origin)
        let payload = try JSONSerialization.jsonObject(with: pending[0].payload) as? [String: Any]
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

    func testUnpairedSubmitQueuesLocally() async {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("feedback-submit-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let submitter = FeedbackSubmitter(queue: FeedbackQueue(directory: directory))
        let outcome = await submitter.submit(draft(), via: nil)
        guard case .queuedLocally = outcome else { return XCTFail("unpaired submit must queue, got \(outcome)") }
        XCTAssertEqual(FeedbackQueue(directory: directory).pending().count, 1)
    }

    func testSaveFailureIsTruthfulNotAQueuedClaim() async throws {
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

    func testInvalidDraftIsRejectedNotQueued() async {
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
}
