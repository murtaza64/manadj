import Foundation

/// Deliberately separate from the desktop payload. There is no raw voice,
/// snapshot, deck state, filesystem path list or music attachment field.
/// Construct only for an explicit Send after showing this exact cloud preview.
public struct CloudFeedbackReport: Codable, Sendable, Equatable {
    public let version: Int
    public let id: String
    public let title: String
    public let description: String
    public let transcript: String?
    public let logs: String?
    public let screenshot: String?

    public init(reviewed draft: FeedbackDraft, reviewedLogs: String? = nil, includeTranscript: Bool = true) throws {
        let title = FeedbackScrub.text(draft.title)
        let description = FeedbackScrub.text(draft.description)
        let transcript = includeTranscript ? draft.voice?.transcript.map(FeedbackScrub.text) : nil
        let logs = reviewedLogs.map(FeedbackScrub.text)
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, title.count <= 200,
              description.count <= 20000, (transcript?.count ?? 0) <= 50000,
              (logs?.count ?? 0) <= 200000 else {
            throw FeedbackFailure("The cloud feedback text is missing or too large")
        }
        if let screenshot = draft.screenshot { try FeedbackDraft.validateScreenshot(screenshot) }
        version = 1
        id = draft.id.uuidString.lowercased()
        self.title = title; self.description = description
        self.transcript = transcript; self.logs = logs; screenshot = draft.screenshot
    }

    public func encoded() throws -> Data {
        let body = try JSONEncoder().encode(self)
        guard body.count <= 8 * 1024 * 1024 else { throw FeedbackFailure("The cloud feedback report is too large") }
        return body
    }
}
