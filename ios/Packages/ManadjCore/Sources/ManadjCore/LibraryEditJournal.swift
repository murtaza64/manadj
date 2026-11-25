import Foundation

public enum LibraryEditJournalError: Error, Equatable {
    case invalid, staleValue, full, persistence, identityMismatch, unavailableSource
}

/// Local edit intent, not a signed continuous-sync operation or a relay receipt.
/// This scope deliberately has no pruning/ack API until verified transport exists.
public enum LibraryEditValue: Codable, Equatable, Sendable {
    case title(String)
    case mainCue(Double?)

    public var field: String {
        switch self { case .title: return "title"; case .mainCue: return "main_cue" }
    }
    fileprivate var valid: Bool {
        switch self {
        case .title(let text): return text.utf8.count <= 4096
        case .mainCue(let value): return value.map { $0.isFinite && $0 >= 0 } ?? true
        }
    }
}

public struct LibraryEditIntent: Codable, Equatable, Sendable {
    public let id: UUID
    public let sequence: Int
    public let logicalTrackID: UUID
    public let sourceRevision: String
    public let oldValue: LibraryEditValue
    public let newValue: LibraryEditValue
    /// Known signed causal operation IDs when the edit was made. Never wall-clock LWW.
    public let parents: [UUID]
}

public struct LibraryEditProjection: Equatable, Sendable {
    public let value: LibraryEditValue
    /// A differing remote/base value is preserved for an explicit later decision.
    public let conflictingBase: LibraryEditValue?
}

/// One exclusive owner, generated qualification limits. All pending edits survive
/// restart, and local overlays become visible only after durable persistence.
/// No caller in the app enables this candidate yet.
public actor LibraryEditJournal {
    private struct Envelope: Codable {
        let version: Int
        let libraryIdentity: String
        let intents: [LibraryEditIntent]
        let setAside: [UUID]
        private enum CodingKeys: String, CodingKey { case version, libraryIdentity, intents, setAside }
        init(version: Int, libraryIdentity: String, intents: [LibraryEditIntent], setAside: [UUID]) {
            self.version = version; self.libraryIdentity = libraryIdentity; self.intents = intents; self.setAside = setAside
        }
        init(from decoder: Decoder) throws {
            let box = try decoder.container(keyedBy: CodingKeys.self)
            version = try box.decode(Int.self, forKey: .version)
            libraryIdentity = try box.decode(String.self, forKey: .libraryIdentity)
            intents = try box.decode([LibraryEditIntent].self, forKey: .intents)
            if version == 2 { setAside = try box.decodeIfPresent([UUID].self, forKey: .setAside) ?? [] }
            else { setAside = try box.decode([UUID].self, forKey: .setAside) }
        }
    }
    public static let maximumBytes = 1024 * 1024
    public static let maximumIntents = 1024
    private let file: URL
    public let libraryIdentity: String
    private var intents: [LibraryEditIntent]
    private var setAside: Set<UUID> = []
    private var frozen = false
    private let writer: @Sendable (Data, URL) throws -> Void

    public init(file: URL, libraryIdentity: String,
                writer: @escaping @Sendable (Data, URL) throws -> Void = SessionEventJournal.durableWrite) throws {
        guard file.isFileURL, !libraryIdentity.isEmpty, libraryIdentity.utf8.count <= 256 else {
            throw LibraryEditJournalError.invalid
        }
        self.file = file; self.libraryIdentity = libraryIdentity; self.writer = writer
        if FileManager.default.fileExists(atPath: file.path) {
            let properties = try file.resourceValues(forKeys: [.fileSizeKey, .isSymbolicLinkKey])
            guard properties.isSymbolicLink != true,
                  let size = properties.fileSize, size <= Self.maximumBytes else { throw LibraryEditJournalError.invalid }
            let bytes = try Data(contentsOf: file)
            guard bytes.count <= Self.maximumBytes else { throw LibraryEditJournalError.full }
            let envelope = try JSONDecoder().decode(Envelope.self, from: bytes)
            guard [2, 3].contains(envelope.version), envelope.libraryIdentity == libraryIdentity else {
                throw LibraryEditJournalError.identityMismatch
            }
            guard envelope.intents.count <= Self.maximumIntents,
                  Set(envelope.intents.map(\.id)).count == envelope.intents.count else { throw LibraryEditJournalError.invalid }
            for (index, intent) in envelope.intents.enumerated() {
                guard intent.sequence == index + 1, Self.valid(intent) else { throw LibraryEditJournalError.invalid }
            }
            guard Set(envelope.setAside).count == envelope.setAside.count,
                  Set(envelope.setAside).isSubset(of: Set(envelope.intents.map(\.id))) else { throw LibraryEditJournalError.invalid }
            intents = envelope.intents; setAside = Set(envelope.setAside)
        } else { intents = [] }
    }

    public func pending() -> [LibraryEditIntent] { intents.filter { !setAside.contains($0.id) } }
    public func evidence() -> [LibraryEditIntent] { intents }

    /// Explicit local disposition, not deletion or a remote acknowledgement.
    /// Evidence and sequences remain immutable and continue to count toward cap.
    public func setAsideIntents(_ ids: Set<UUID>) throws {
        guard !frozen, !ids.isEmpty, ids.isSubset(of: Set(intents.map(\.id))) else { throw LibraryEditJournalError.invalid }
        let next = setAside.union(ids)
        let bytes = try JSONEncoder().encode(Envelope(version: 3, libraryIdentity: libraryIdentity, intents: intents, setAside: next.sorted { $0.uuidString < $1.uuidString }))
        guard bytes.count <= Self.maximumBytes else { throw LibraryEditJournalError.full }
        do { try writer(bytes, file) } catch { frozen = true; throw LibraryEditJournalError.persistence }
        setAside = next
    }

    @discardableResult
    public func append(id: UUID = UUID(), logicalTrackID: UUID, oldValue: LibraryEditValue,
                       newValue: LibraryEditValue, parents: [UUID], sourceRevision: String = "generated-journal-only") throws -> LibraryEditIntent {
        guard !frozen else { throw LibraryEditJournalError.persistence }
        if let existing = intents.first(where: { $0.id == id }) {
            guard existing.logicalTrackID == logicalTrackID, existing.oldValue == oldValue,
                  existing.newValue == newValue, existing.parents == parents, existing.sourceRevision == sourceRevision else { throw LibraryEditJournalError.invalid }
            return existing
        }
        let intent = LibraryEditIntent(id: id, sequence: intents.count + 1, logicalTrackID: logicalTrackID,
            sourceRevision: sourceRevision, oldValue: oldValue, newValue: newValue, parents: parents)
        guard Self.valid(intent) else { throw LibraryEditJournalError.invalid }
        if let previous = pending().last(where: {
            $0.logicalTrackID == logicalTrackID && $0.newValue.field == newValue.field
        }), previous.newValue != oldValue { throw LibraryEditJournalError.staleValue }
        guard intents.count < Self.maximumIntents else { throw LibraryEditJournalError.full }
        let next = intents + [intent]
        let bytes = try JSONEncoder().encode(Envelope(version: 3, libraryIdentity: libraryIdentity, intents: next, setAside: setAside.sorted { $0.uuidString < $1.uuidString }))
        guard bytes.count <= Self.maximumBytes else { throw LibraryEditJournalError.full }
        do { try writer(bytes, file) }
        catch {
            // A writer can fail after rename. Reopen before any retry so sequence
            // and UUID never diverge from uncertain persisted state.
            frozen = true
            throw LibraryEditJournalError.persistence
        }
        intents = next
        return intent
    }

    public func project(logicalTrackID: UUID, base: LibraryEditValue) -> LibraryEditProjection {
        Self.project(pending(), logicalTrackID: logicalTrackID, base: base)
    }

    public nonisolated static func project(_ intents: [LibraryEditIntent], logicalTrackID: UUID,
                                           base: LibraryEditValue) -> LibraryEditProjection {
        let edits = intents.filter { $0.logicalTrackID == logicalTrackID && $0.newValue.field == base.field }
        guard let first = edits.first, let last = edits.last else {
            return .init(value: base, conflictingBase: nil)
        }
        // Matching a value is not a verified receipt, so retain every intent.
        let conflict = base != first.oldValue && base != last.newValue
        return .init(value: last.newValue, conflictingBase: conflict ? base : nil)
    }

    private static func valid(_ intent: LibraryEditIntent) -> Bool {
        !intent.sourceRevision.isEmpty && intent.sourceRevision.utf8.count <= 1024 && intent.sequence > 0 && intent.oldValue.valid && intent.newValue.valid &&
        intent.oldValue.field == intent.newValue.field && intent.oldValue != intent.newValue &&
        intent.parents.count <= 32 && Set(intent.parents).count == intent.parents.count
    }
}
