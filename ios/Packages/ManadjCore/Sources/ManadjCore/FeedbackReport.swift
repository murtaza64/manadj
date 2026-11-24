import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Phone shake-to-report feedback, platform-neutral half (capture, drawing and
/// the review sheet live in the app target). A reviewed report POSTs to the
/// paired desktop's scoped POST /api/device-sync/feedback; the desktop files
/// it through the same FeedbackService as the loopback feedback router
/// (scrubbed, durable; the GitHub issue is text-only, evidence stays local).
/// These limits and scrubs mirror backend/feedback.py so the desktop accepts
/// what the phone sends; the desktop re-validates and re-scrubs everything.
public enum FeedbackKind: String, Codable, CaseIterable, Sendable {
    case bug
    case feature
}

public struct FeedbackFailure: Error, LocalizedError, Equatable, Sendable {
    public let message: String
    public var errorDescription: String? { message }
    public init(_ message: String) { self.message = message }
}

public enum FeedbackLimits {
    public static let snapshotBytes = 256 * 1024
    public static let snapshotString = 16384
    public static let snapshotKey = 200
    public static let snapshotDepth = 12
    public static let snapshotNodes = 10000
    public static let screenshotDataURL = 4 * 1024 * 1024
    public static let screenshotPixels = 32_000_000
    public static let title = 200
    public static let description = 10000
    public static let warnings = 30
    public static let warning = 1000
    /// backend/feedback.py SNAPSHOT_FIELDS: the closed set the desktop accepts.
    public static let snapshotFields: Set<String> = [
        "captured_at", "view", "viewport", "user_agent", "browse", "filters",
        "decks", "mixer", "editor", "set", "session", "audible_surface",
        "errors", "crash",
    ]
    public static let pngPrefix = "data:image/png;base64,"
    /// Reviewed voice narration (Rec), mirroring backend/feedback.py. The byte
    /// cap covers 120 s of 320 kbps MP3 (4,800,000 bytes) plus tag/encoder
    /// headroom; duration_ms is the recorder's declared length — both ends
    /// sniff container magic and bound bytes, neither decodes audio.
    public static let voiceBytes = 5 * 1024 * 1024
    public static let voiceDataURL = (voiceBytes + 2) / 3 * 4 + 128
    public static let voiceDurationMs = 120_000
    public static let voiceTranscript = 10_000
    public static let voicePrefixes: [String: String] = [
        "m4a": "data:audio/mp4;base64,",
        "caf": "data:audio/caf;base64,",
        "mp3": "data:audio/mpeg;base64,",
    ]
}

/// Reviewed narration captured while reproducing the report. Raw audio stays
/// local evidence on the desktop; it is never uploaded to GitHub.
public struct FeedbackVoice: Sendable, Equatable {
    public var format: String  // "m4a", "caf" or "mp3"
    public var dataURL: String
    public var durationMs: Int
    public var startedAt: Date
    public var endedAt: Date
    public var transcript: String?

    public init(format: String, dataURL: String, durationMs: Int, startedAt: Date, endedAt: Date, transcript: String? = nil) {
        self.format = format
        self.dataURL = dataURL
        self.durationMs = durationMs
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.transcript = transcript
    }

    /// Mirrors the desktop's Voice model: declared format matches the data
    /// URL prefix, container magic matches the format, bounds hold.
    public func validate() throws {
        guard let prefix = FeedbackLimits.voicePrefixes[format], dataURL.hasPrefix(prefix) else {
            throw FeedbackFailure("Voice recording must be M4A, CAF or MP3 audio")
        }
        guard dataURL.count <= FeedbackLimits.voiceDataURL,
              let data = Data(base64Encoded: String(dataURL.dropFirst(prefix.count))),
              data.count >= 12, data.count <= FeedbackLimits.voiceBytes
        else { throw FeedbackFailure("Voice recording is too large to file") }
        let bytes = [UInt8](data)
        let magic: Bool
        switch format {
        case "m4a": magic = Array(bytes[4..<8]) == [0x66, 0x74, 0x79, 0x70]  // "ftyp"
        case "caf": magic = Array(bytes[0..<4]) == [0x63, 0x61, 0x66, 0x66]  // "caff"
        default:  // mp3: ID3v2 tag or MPEG frame sync
            magic = Array(bytes[0..<3]) == [0x49, 0x44, 0x33]
                || (bytes[0] == 0xFF && bytes[1] & 0xE0 == 0xE0)
        }
        guard magic else { throw FeedbackFailure("Voice recording does not match its format") }
        guard durationMs >= 1, durationMs <= FeedbackLimits.voiceDurationMs else {
            throw FeedbackFailure("Voice recording is too long (2 minutes max)")
        }
        guard endedAt > startedAt else {
            throw FeedbackFailure("Voice recording window is invalid")
        }
        if let transcript, transcript.count > FeedbackLimits.voiceTranscript {
            throw FeedbackFailure("Voice transcript is too long (10,000 characters max)")
        }
    }

    private static var timestampFormatter: ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }

    func payload() -> [String: Any] {
        [
            "format": format,
            "data_url": dataURL,
            "duration_ms": durationMs,
            "started_at": Self.timestampFormatter.string(from: startedAt),
            "ended_at": Self.timestampFormatter.string(from: endedAt),
            "transcript": transcript.map { FeedbackScrub.text($0) as Any } ?? NSNull(),
        ]
    }
}

public enum FeedbackScrub {
    private static func expression(_ pattern: String) -> NSRegularExpression {
        // Fixed patterns; a failure here is a programming error, not user input.
        try! NSRegularExpression(pattern: pattern)
    }
    private static let secretKey = expression(#"(?i)(password|passwd|secret|token|authorization|api[_-]?key|cookie)"#)
    private static let privateKey = expression(#"(?s)-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----"#)
    private static let secretText = expression(#"(?i)(?:bearer\s+\S+|(?:gh[pousr]_[\w]+|github_pat_[\w]+|sk-[\w-]{16,})|(?:password|passwd|secret|token|authorization|api[_-]?key|cookie)\s*[\"']?\s*[:=]\s*(?:\"[^\"]*\"|'[^']*'|[^\s,;}]+)|https?://[^\s/@]+:[^\s/@]+@)"#)
    private static let controlCharacters = expression(#"[\x00-\x08\x0b-\x1f\x7f]"#)

    /// Mirrors backend scrub(): secrets out, hidden markers unforgeable.
    public static func text(_ value: String) -> String {
        var text = value
        for pattern in [privateKey, secretText] {
            text = pattern.stringByReplacingMatches(
                in: text, range: NSRange(text.startIndex..., in: text),
                withTemplate: "[REDACTED]")
        }
        text = text.replacingOccurrences(of: "<!--", with: "&lt;!--")
        text = text.replacingOccurrences(of: "MANADJ_FEEDBACK_", with: "MANADJ-FEEDBACK-")
        return controlCharacters.stringByReplacingMatches(
            in: text, range: NSRange(text.startIndex..., in: text), withTemplate: "")
    }

    static func redacts(key: String) -> Bool {
        secretKey.firstMatch(in: key, range: NSRange(key.startIndex..., in: key)) != nil
    }

    /// Recursive scrub of a JSON value, mirroring the desktop's clean():
    /// secret-patterned keys redact their whole value; all strings scrub.
    /// The review sheet renders this exact output, so the preview IS the payload.
    public static func json(_ value: Any) -> Any {
        if let dict = value as? [String: Any] {
            var out: [String: Any] = [:]
            for (key, child) in dict {
                out[text(key)] = redacts(key: key) ? "[REDACTED]" : json(child)
            }
            return out
        }
        if let list = value as? [Any] { return list.map(json) }
        if let string = value as? String { return text(string) }
        return value
    }
}

/// One reviewed report. `snapshot` holds JSON values only (String, NSNumber,
/// Bool, NSNull, [String: Any], [Any]); validatedPayload() enforces that.
public struct FeedbackDraft {
    public var id: UUID
    public var kind: FeedbackKind
    public var title: String
    public var description: String
    public var snapshot: [String: Any]
    /// PNG data URL, already annotated. Nil means the reporter removed it.
    public var screenshot: String?
    public var captureWarnings: [String]
    /// Reviewed Rec narration. Nil when the reporter did not record one.
    public var voice: FeedbackVoice?

    public init(
        id: UUID = UUID(), kind: FeedbackKind, title: String = "", description: String = "",
        snapshot: [String: Any] = [:], screenshot: String? = nil, captureWarnings: [String] = [],
        voice: FeedbackVoice? = nil
    ) {
        self.id = id
        self.kind = kind
        self.title = title
        self.description = description
        self.snapshot = snapshot
        self.screenshot = screenshot
        self.captureWarnings = captureWarnings
        self.voice = voice
    }

    private static func checkSnapshot(_ value: Any, depth: Int, nodes: inout Int) throws {
        nodes += 1
        guard depth <= FeedbackLimits.snapshotDepth, nodes <= FeedbackLimits.snapshotNodes else {
            throw FeedbackFailure("Feedback context is too large to file")
        }
        switch value {
        case let string as String:
            guard string.count <= FeedbackLimits.snapshotString else {
                throw FeedbackFailure("Feedback context has an oversized entry")
            }
        case let dict as [String: Any]:
            for (key, child) in dict {
                guard key.count <= FeedbackLimits.snapshotKey else {
                    throw FeedbackFailure("Feedback context has an oversized key")
                }
                try checkSnapshot(child, depth: depth + 1, nodes: &nodes)
            }
        case let list as [Any]:
            for child in list { try checkSnapshot(child, depth: depth + 1, nodes: &nodes) }
        case is NSNull, is Bool:
            break
        case let number as NSNumber:
            // Booleans arrive as NSNumbers from JSONSerialization; objCType "c"
            // is the portable check (Linux corelibs has no isBoolValue).
            if String(cString: number.objCType) != "c", !number.doubleValue.isFinite {
                throw FeedbackFailure("Feedback context holds a non-finite number")
            }
        default:
            throw FeedbackFailure("Feedback context must contain JSON values only")
        }
    }

    static func validateScreenshot(_ screenshot: String) throws {
        guard screenshot.hasPrefix(FeedbackLimits.pngPrefix) else {
            throw FeedbackFailure("Screenshot must be a PNG image")
        }
        guard screenshot.count <= FeedbackLimits.screenshotDataURL,
              let data = Data(base64Encoded: String(screenshot.dropFirst(FeedbackLimits.pngPrefix.count))),
              data.count > 24
        else { throw FeedbackFailure("Screenshot is too large to file") }
        let bytes = [UInt8](data)
        let signature: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
        guard Array(bytes[0..<8]) == signature, Array(bytes[12..<16]) == [0x49, 0x48, 0x44, 0x52] else {
            throw FeedbackFailure("Screenshot must be a PNG image")
        }
        let width = bytes[16..<20].reduce(UInt32(0)) { $0 << 8 | UInt32($1) }
        let height = bytes[20..<24].reduce(UInt32(0)) { $0 << 8 | UInt32($1) }
        // Widen before multiplying: UInt32 dimensions can overflow the product.
        guard width > 0, height > 0,
              UInt64(width) * UInt64(height) <= UInt64(FeedbackLimits.screenshotPixels) else {
            throw FeedbackFailure("Screenshot dimensions are too large to file")
        }
    }

    /// Scrubbed, limit-checked JSON body for POST /api/device-sync/feedback.
    /// Throws FeedbackFailure with a reporter-facing message on any violation.
    public func validatedPayload() throws -> [String: Any] {
        let title = FeedbackScrub.text(self.title)
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              title.count <= FeedbackLimits.title
        else { throw FeedbackFailure("Give the report a short title (1-200 characters)") }
        let description = FeedbackScrub.text(self.description)
        guard description.count <= FeedbackLimits.description else {
            throw FeedbackFailure("The description is too long (10,000 characters max)")
        }
        guard Set(snapshot.keys).isSubset(of: FeedbackLimits.snapshotFields) else {
            throw FeedbackFailure("Feedback context holds a field the desktop does not accept")
        }
        var nodes = 0
        try Self.checkSnapshot(snapshot, depth: 0, nodes: &nodes)
        if let screenshot { try Self.validateScreenshot(screenshot) }
        if let voice { try voice.validate() }
        var warnings = captureWarnings.prefix(FeedbackLimits.warnings).map(FeedbackScrub.text)
        warnings = warnings.map { String($0.prefix(FeedbackLimits.warning)) }
        let cleanedSnapshot = FeedbackScrub.json(snapshot) as? [String: Any] ?? [:]
        var payload: [String: Any] = [
            "id": id.uuidString.lowercased(),
            "kind": kind.rawValue,
            "title": String(title.prefix(FeedbackLimits.title)),
            "description": description,
            "snapshot": cleanedSnapshot,
            "screenshot": screenshot.map { $0 as Any } ?? NSNull(),
            "capture_warnings": warnings,
        ]
        if let voice { payload["voice"] = voice.payload() }
        let snapshotData = try JSONSerialization.data(withJSONObject: cleanedSnapshot)
        guard snapshotData.count <= FeedbackLimits.snapshotBytes else {
            throw FeedbackFailure("Feedback context is too large to file")
        }
        guard JSONSerialization.isValidJSONObject(payload) else {
            throw FeedbackFailure("Feedback report must contain JSON values only")
        }
        return payload
    }
}

public struct FeedbackFiling: Sendable, Equatable {
    public let id: String
    public let status: String
    public let issueURL: String?
    public let detail: String?
}

extension SyncClient {
    /// POST one validated report payload to the paired desktop. The desktop
    /// files it via its own credentials; the phone never holds any.
    public func submitFeedback(_ payload: Data) async throws -> FeedbackFiling {
        final class NoRedirect: NSObject, URLSessionTaskDelegate, Sendable {
            func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                            newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 30
        let session = URLSession(configuration: configuration, delegate: NoRedirect(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = connection.request(path: "/feedback", method: "POST", body: payload)
        request.timeoutInterval = 20
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw SyncError("Invalid desktop response") }
        if http.statusCode == 401 { throw SyncError("Not paired, or this phone was unpaired on the desktop. Pair again.", status: 401) }
        guard (200..<300).contains(http.statusCode) else {
            throw SyncError("Desktop returned HTTP \(http.statusCode)", status: http.statusCode)
        }
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = object["id"] as? String, let status = object["status"] as? String
        else { throw SyncError("Invalid feedback response from the desktop") }
        return FeedbackFiling(
            id: id, status: status,
            issueURL: object["issue_url"] as? String, detail: object["error"] as? String)
    }
}

public enum FeedbackOutcome: Equatable, Sendable {
    /// GitHub issue created; the link is returned to show the reporter.
    case filed(issueURL: String?)
    /// Stored durably on the desktop, but GitHub filing needs a desktop-side retry.
    case savedOnDesktop(status: String, detail: String?)
    /// No usable desktop right now; kept on this iPhone for the retry paths
    /// named in the reason. Only ever reached after an explicit File.
    case queuedLocally(reason: String)
    /// Refused before saving; retrying the identical report cannot succeed.
    case rejected(reason: String)
    /// The desktop never saw it AND the iPhone could not keep it (storage
    /// failure or a full outbox). Nothing is filed or queued.
    case saveFailed(reason: String)
}

/// Disk-backed outbox for explicitly filed reports that could not reach the
/// desktop. Each entry is an envelope binding the payload to the desktop
/// origin it was filed against, so a re-pair to a different desktop never
/// receives it. Full means full: saving refuses rather than evicting a
/// reviewed report silently.
public final class FeedbackQueue: Sendable {
    public static let capacity = 10
    public let directory: URL

    public init(directory: URL) { self.directory = directory }

    /// Unbound entries never drain. A later pairing is not consent to disclose
    /// private context captured before the destination was known.
    static func drains(_ entryOrigin: String?, to connectionOrigin: String) -> Bool {
        entryOrigin != nil && entryOrigin == connectionOrigin
    }

    public func save(_ payload: [String: Any], id: String, origin: String?) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        // Repeated attempts preserve the same immutable report and destination.
        // Never enqueue two copies or replace reviewed bytes behind their ID.
        let payloadData = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        for file in try pendingFiles() where file.deletingPathExtension().lastPathComponent.hasSuffix(id) {
            guard let existing = try? JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any],
                  let oldPayload = existing["payload"] as? [String: Any],
                  (existing["origin"] as? String) == origin,
                  try JSONSerialization.data(withJSONObject: oldPayload, options: [.sortedKeys]) == payloadData
            else { throw FeedbackFailure("This saved report ID already belongs to different reviewed content or a different desktop. Nothing was replaced.") }
            return
        }
        guard try pendingFiles().count < Self.capacity else {
            throw FeedbackFailure(
                "\(Self.capacity) reports are already waiting for the desktop. Nothing was saved; review and send or discard saved reports before queueing more.")
        }
        let envelope: [String: Any] = ["origin": origin.map { $0 as Any } ?? NSNull(), "payload": payload]
        let data = try JSONSerialization.data(withJSONObject: envelope)
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let stamp = iso.string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let target = directory.appendingPathComponent("\(stamp)-\(id).json")
        let staging = directory.appendingPathComponent(".\(UUID().uuidString).part")
        try data.write(to: staging)
        // POSIX rename atomically replaces the target on the same filesystem.
        guard rename(staging.path, target.path) == 0 else {
            try? FileManager.default.removeItem(at: staging)
            throw FeedbackFailure("Could not save the report on this iPhone")
        }
    }

    private func pendingFiles() throws -> [URL] {
        try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    public func pending() -> [(id: String, origin: String?, payload: Data)] {
        (try? pendingFiles())?.compactMap { file in
            // Filename is <ISO stamp>-<uuid>; the uuid is the last 36 characters.
            let base = file.deletingPathExtension().lastPathComponent
            guard base.count > 36, let raw = try? Data(contentsOf: file),
                  let envelope = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
                  let payload = envelope["payload"] as? [String: Any],
                  let data = try? JSONSerialization.data(withJSONObject: payload)
            else { return nil }
            return (String(base.suffix(36)), envelope["origin"] as? String, data)
        } ?? []
    }

    public func remove(id: String) {
        for file in (try? pendingFiles()) ?? [] where file.deletingPathExtension().lastPathComponent.hasSuffix(id) {
            try? FileManager.default.removeItem(at: file)
        }
    }
}

@MainActor
public final class FeedbackSubmitter {
    public typealias Transport = @MainActor (Data, DesktopConnection) async throws -> FeedbackFiling
    private let queue: FeedbackQueue
    private let transport: Transport
    public init(queue: FeedbackQueue, transport: @escaping Transport = { data, connection in
        try await SyncClient(connection).submitFeedback(data)
    }) { self.queue = queue; self.transport = transport }

    /// Only the saved-report review UI calls this after naming the destination.
    /// Existing disk copy is never overwritten/rebound; delete only on the same
    /// receipt validation used by the first send.
    public func retryReviewed(id: String, payload: Data, via connection: DesktopConnection) async -> FeedbackOutcome {
        guard let object = try? JSONSerialization.jsonObject(with: payload) as? [String: Any],
              object["id"] as? String == id else { return .rejected(reason: "Saved report identity is invalid; nothing sent") }
        do {
            let filing = try await transport(payload, connection)
            guard Self.confirms(filing, id: id) else { return .queuedLocally(reason: "No matching desktop receipt. Saved report kept on this iPhone") }
            queue.remove(id: id)
            return filing.status == "filed" ? .filed(issueURL: filing.issueURL) : .savedOnDesktop(status: filing.status, detail: filing.detail)
        } catch { return .queuedLocally(reason: "No confirmed desktop receipt. Saved report kept on this iPhone") }
    }
    private static func confirms(_ filing: FeedbackFiling, id: String) -> Bool {
        filing.id.lowercased() == id && ["pending", "filed", "filing", "filing_failed", "filing_uncertain"].contains(filing.status)
    }

    /// Explicit local preservation after a server refusal, without another
    /// network request. Keep the reviewed destination binding intact.
    public func saveReviewed(_ draft: FeedbackDraft, origin: String?) -> FeedbackOutcome {
        do {
            let payload = try draft.validatedPayload()
            try queue.save(payload, id: draft.id.uuidString.lowercased(), origin: origin)
            return .queuedLocally(reason: "Saved on this iPhone. Nothing was sent. Review the saved report and approve its destination before any later send.")
        } catch let failure as FeedbackFailure { return .saveFailed(reason: failure.message) }
        catch { return .saveFailed(reason: "Could not save the reviewed report on this iPhone.") }
    }

    /// Validate, then file through the desktop or keep locally. Throws only
    /// for payload violations the reporter can fix in the review sheet.
    public func submit(_ draft: FeedbackDraft, via connection: DesktopConnection?) async -> FeedbackOutcome {
        let payload: [String: Any]
        do { payload = try draft.validatedPayload() } catch let failure as FeedbackFailure {
            return .rejected(reason: failure.message)
        } catch { return .rejected(reason: "The report could not be prepared") }
        let id = draft.id.uuidString.lowercased()
        let origin = connection?.baseURL.absoluteString
        func keepLocally(_ reason: String) -> FeedbackOutcome {
            do { try queue.save(payload, id: id, origin: origin) }
            catch let failure as FeedbackFailure { return .saveFailed(reason: failure.message) }
            catch { return .saveFailed(reason: "Could not save the report on this iPhone; it was not filed either.") }
            return .queuedLocally(reason: reason)
        }
        guard let connection else {
            return keepLocally("No desktop is paired. Saved on this iPhone; this report will not send after pairing unless you use REVIEW SAVED REPORTS and approve its destination.")
        }
        let body: Data
        do { body = try JSONSerialization.data(withJSONObject: payload) }
        catch { return .rejected(reason: "The report could not be prepared") }
        // Durability precedes the first network byte. A killed app, changed IP,
        // timeout or ambiguous response cannot make a reviewed report disappear.
        do { try queue.save(payload, id: id, origin: origin) }
        catch let failure as FeedbackFailure { return .saveFailed(reason: failure.message) }
        catch { return .saveFailed(reason: "Could not save the report on this iPhone. Nothing was sent.") }
        do {
            let filing = try await transport(body, connection)
            guard Self.confirms(filing, id: id) else {
                return .queuedLocally(reason: "The desktop returned a receipt that does not confirm this report. Your reviewed report stays on this iPhone; inspect it before retrying.")
            }
            queue.remove(id: id)
            if filing.status == "filed" {
                return .filed(issueURL: filing.issueURL)
            }
            return .savedOnDesktop(status: filing.status, detail: filing.detail)
        } catch let error as SyncError where error.status != nil && (400..<500).contains(error.status!) && error.status != 401 {
            // Keep the already-reviewed local copy on every refusal; no automatic retry.
            return .queuedLocally(reason: "The desktop refused this attempt. Your reviewed report is saved on this iPhone. Review it before retrying. " + error.message)
        } catch {
            return .queuedLocally(reason: "No confirmed desktop receipt. Saved on this iPhone; open REVIEW SAVED REPORTS to inspect it and approve sending when the desktop is reachable.")
        }
    }

}
