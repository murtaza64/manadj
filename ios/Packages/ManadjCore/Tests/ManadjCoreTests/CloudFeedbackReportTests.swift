import XCTest
@testable import ManadjCore

final class CloudFeedbackReportTests: XCTestCase {
    func testCloudPayloadHasNoRawVoiceMusicOrSnapshot() throws {
        let voice = FeedbackVoice(format: "mp3", dataURL: "raw-private-voice-never-copy", durationMs: 1000,
            startedAt: Date(timeIntervalSince1970: 1), endedAt: Date(timeIntervalSince1970: 2), transcript: "reviewed words")
        let draft = FeedbackDraft(kind: .bug, title: "Synthetic", description: "Synthetic only",
            snapshot: ["decks": [["file": "private-track.wav"]]], voice: voice)
        let report = try CloudFeedbackReport(reviewed: draft)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: report.encoded()) as? [String: Any])
        XCTAssertEqual(Set(object.keys), ["version", "id", "title", "description", "transcript"])
        XCTAssertEqual(object["transcript"] as? String, "reviewed words")
        let text = String(decoding: try report.encoded(), as: UTF8.self)
        XCTAssertFalse(text.contains("private-track")); XCTAssertFalse(text.contains("raw-private"))
    }
    func testCloudPreviewIsScrubbedAndTranscriptCanBeExcluded() throws {
        let draft = FeedbackDraft(kind: .bug, title: "token=synthetic", description: "password=synthetic")
        let report = try CloudFeedbackReport(reviewed: draft, reviewedLogs: "authorization=synthetic", includeTranscript: false)
        XCTAssertEqual(report.title, "[REDACTED]"); XCTAssertEqual(report.description, "[REDACTED]")
        XCTAssertEqual(report.logs, "[REDACTED]"); XCTAssertNil(report.transcript)
    }
    func testInvalidScreenshotAndOversizedTextReject() {
        XCTAssertThrowsError(try CloudFeedbackReport(reviewed: FeedbackDraft(kind: .bug, title: "Synthetic", screenshot: "data:audio/mp3;base64,AAAA")))
        XCTAssertThrowsError(try CloudFeedbackReport(reviewed: FeedbackDraft(kind: .bug, title: "")))
        XCTAssertThrowsError(try CloudFeedbackReport(reviewed: FeedbackDraft(kind: .bug, title: "Synthetic"), reviewedLogs: String(repeating: "x", count: 200001)))
    }
}
