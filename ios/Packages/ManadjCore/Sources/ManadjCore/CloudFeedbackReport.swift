import Foundation

/// V2 is deliberately separate from the LAN report. No raw voice, music,
/// arbitrary context, filesystem paths or database fields can be encoded here.
public struct CloudFeedbackReport: Codable, Sendable, Equatable {
    public struct Screenshot: Codable, Sendable, Equatable {
        public let mime: String
        public let base64: String
    }
    public let version: Int
    public let id: String
    public let kind: String
    public let title: String
    public let description: String?
    public let transcript: String?
    public let logs: String?
    public let screenshot: Screenshot?

    public init(reviewed draft: FeedbackDraft, reviewedLogs: String? = nil, includeTranscript: Bool = true) throws {
        guard draft.id.uuidString.split(separator: "-")[2].first == "4" else { throw FeedbackFailure("Cloud reports need a fresh UUIDv4 identity") }
        let title = FeedbackScrub.text(draft.title)
        let description = FeedbackScrub.text(draft.description)
        let transcript = includeTranscript ? draft.voice.flatMap(\.transcript).map(FeedbackScrub.text) : nil
        let logs = reviewedLogs.map(FeedbackScrub.text)
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              title.unicodeScalars.count <= 200, description.unicodeScalars.count <= 20000,
              (transcript?.unicodeScalars.count ?? 0) <= 50000, (logs?.unicodeScalars.count ?? 0) <= 200000 else {
            throw FeedbackFailure("The cloud feedback text is missing or too large")
        }
        var picture: Screenshot?
        if let source = draft.screenshot {
            guard source.hasPrefix(FeedbackLimits.pngPrefix) else { throw FeedbackFailure("Cloud screenshot must be PNG") }
            let encoded = String(source.dropFirst(FeedbackLimits.pngPrefix.count))
            guard let data = Data(base64Encoded: encoded), data.count <= 4 * 1024 * 1024, data.starts(with: [137,80,78,71,13,10,26,10]) else {
                throw FeedbackFailure("Cloud screenshots must be PNG images under 4 MiB")
            }
            let b = [UInt8](data)
            func word(_ offset: Int) -> UInt32 { b[offset..<offset+4].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) } }
            guard b.count >= 33, word(8) == 13, Array(b[12..<16]) == [73,72,68,82],
                  (1...8192).contains(word(16)), (1...8192).contains(word(20)) else {
                throw FeedbackFailure("Cloud screenshot PNG dimensions are invalid")
            }
            picture = Screenshot(mime: "image/png", base64: data.base64EncodedString())
        }
        version = 2; id = draft.id.uuidString.lowercased(); kind = draft.kind.rawValue
        self.title = title; self.description = description.isEmpty ? nil : description
        self.transcript = transcript; self.logs = logs; screenshot = picture
    }

    /// Freeze this return value on disk before Send. Retrying must reuse it,
    /// never re-encode a report or recapture context behind the same identity.
    public func frozenBytes() throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let bytes = try encoder.encode(self)
        guard bytes.count <= 8 * 1024 * 1024 else { throw FeedbackFailure("The cloud report is too large") }
        return bytes
    }
}

public struct CloudFeedbackReceipt: Decodable, Sendable, Equatable {
    public let version: Int
    public let id: String
    public let received: Bool
    public let repeated: Bool
    public let receivedAt: String
    public let retainedUntil: String
    public let sha256: String

    public static func confirmed(body: Data, status: Int, reportID: String, digest: String, lookup: Bool = false) throws -> Self {
        guard body.count <= 4096, status == 200 || (!lookup && status == 201),
              let value = try? JSONDecoder().decode(Self.self, from: body),
              value.version == 2, value.id == reportID, value.received,
              value.sha256 == digest, digest.count == 64,
              digest.allSatisfy({ "0123456789abcdef".contains($0) }),
              lookup || ((status == 200 && value.repeated) || (status == 201 && !value.repeated)) else {
            throw FeedbackFailure("No matching private cloud receipt. The frozen report stays on this iPhone")
        }
        let iso = ISO8601DateFormatter(); iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let basic = ISO8601DateFormatter()
        guard let first = iso.date(from: value.receivedAt) ?? basic.date(from: value.receivedAt),
              let until = iso.date(from: value.retainedUntil) ?? basic.date(from: value.retainedUntil),
              abs(until.timeIntervalSince(first) - 30 * 86400) < 1 else {
            throw FeedbackFailure("Cloud receipt retention did not match the 30-day policy. Keep the local report")
        }
        return value
    }
}
