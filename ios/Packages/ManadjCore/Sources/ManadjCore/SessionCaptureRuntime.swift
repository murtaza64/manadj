import Foundation

/// Disabled host integration building block. One caller supplies ordered applied
/// segments, exact identities and explicit interruption/gap signals. No timers,
/// engine enabling, network, or lifecycle assumptions are hidden here.
public actor SessionCaptureRuntime {
    private let journal: SessionEventJournal
    private let libraryIdentity: String
    private var mapper = AppliedSessionRecorder()
    private var sequence = 1
    private var pending: [[String: Any]] = []
    private var pendingBytes = 0
    private var pendingSession: UUID?
    private var lastFlushFrame: UInt64?
    private var failed = false
    private var busy = false

    public init(journal: SessionEventJournal, libraryIdentity: String) {
        self.journal = journal; self.libraryIdentity = libraryIdentity
    }

    /// Pending events are not acknowledged durable until flush. At most one
    /// rendered second is batched; explicit stop flushes before terminal close.
    public func observe(_ segment: AppliedSessionSegment, wallTime: Date) async throws {
        guard !failed, !busy else { throw AppliedRecorderError.stopped }
        busy = true
        defer { busy = false }
        do {
            let actions = try mapper.observe(segment, wallTime: wallTime)
            for action in actions {
                switch action {
                case .open(let id, let start, let context):
                    try await flush()
                    try await journal.open(uuid: id, libraryIdentity: libraryIdentity, startedAt: start, context: context)
                    sequence = 1; pendingSession = id; lastFlushFrame = segment.endFrame
                case .append(let id, _, let bytes):
                    let events = try JSONSerialization.jsonObject(with: bytes) as! [[String: Any]]
                    if pending.count + events.count > 1024 || pendingBytes + bytes.count > 128 * 1024 { try await flush() }
                    guard pendingSession == id else { throw SessionJournalError.invalidState }
                    pending += events; pendingBytes += bytes.count
                case .close(let id, let date, let incomplete):
                    try await flush()
                    try await journal.close(uuid: id, endedAt: date, incomplete: incomplete)
                    pendingSession = nil
                }
            }
            if let previous = lastFlushFrame, segment.endFrame - previous >= UInt64(segment.sampleRate) {
                try await flush(); lastFlushFrame = segment.endFrame
            }
        } catch {
            failed = true
            // Never convert unpersisted or unsupported history to a complete close.
            if let id = pendingSession { try? await journal.close(uuid: id, endedAt: wallTime, incomplete: true) }
            throw error
        }
    }

    public func stop(at date: Date, incomplete: Bool) async throws {
        guard !failed, !busy else { throw AppliedRecorderError.stopped }
        busy = true
        defer { busy = false }
        failed = true
        try await flush()
        for action in mapper.stop(at: date, incomplete: incomplete) {
            if case .close(let id, let end, let gap) = action { try await journal.close(uuid: id, endedAt: end, incomplete: gap) }
        }
    }

    private func flush() async throws {
        guard !pending.isEmpty, let id = pendingSession else { return }
        let data = try JSONSerialization.data(withJSONObject: pending, options: [.sortedKeys])
        try await journal.append(uuid: id, expectedSequence: sequence, events: data)
        sequence += 1; pending = []; pendingBytes = 0
    }
}
