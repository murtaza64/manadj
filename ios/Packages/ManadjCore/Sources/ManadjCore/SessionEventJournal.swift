import Foundation
import CoreFoundation
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

public enum SessionJournalError: Error, Equatable {
    case invalidState, invalidEvents, full, sessionClosed, sequenceMismatch, persistence
}

public struct SessionEventChunk: Codable, Equatable, Sendable {
    public let sequence: Int
    /// Existing capture-events JSON, local IDs still scoped to this journal's library.
    public let events: Data
}

public struct JournalSession: Codable, Equatable, Sendable {
    public let uuid: UUID
    public let libraryIdentity: String
    public let startedAt: Date
    public var endedAt: Date?
    public var incomplete: Bool
    public var acknowledgedThrough: Int
    public var chunks: [SessionEventChunk]
}

/// Local-only session evidence. One actor owns the manifest and its chunk tree.
/// Chunks are flushed before the committed-prefix manifest. Unreferenced orphans
/// are retained, not guessed away. Acknowledgement does not delete evidence.
/// This test-bounded store still has no qualified long-session retention policy.
public actor SessionEventJournal {
    public static let maximumBytes = 8 * 1024 * 1024
    private struct StoredSession: Codable {
        let uuid: UUID
        let libraryIdentity: String
        let startedAt: Date
        let endedAt: Date?
        let incomplete: Bool
        let acknowledgedThrough: Int
        let chunkCount: Int
    }
    private struct Envelope: Codable { let version: Int; let sessions: [StoredSession] }
    private let file: URL
    private var sessions: [JournalSession]
    private var quarantined: [StoredSession] = []
    private var storageBlocked = false
    public private(set) var damagedSessionIDs: [UUID] = []
    public private(set) var storageBytes = 0
    public private(set) var storageFiles = 0
    public static let maximumDiskBytes = 64 * 1024 * 1024
    public static let maximumFiles = 8192
    private var uncertainWrite = false
    private var eventByteCount = 0
    private let writer: @Sendable (Data, URL) throws -> Void

    public init(file: URL, writer: @escaping @Sendable (Data, URL) throws -> Void = SessionEventJournal.durableWrite) throws {
        guard file.isFileURL else { throw SessionJournalError.invalidState }
        self.file = file; self.writer = writer
        let usage = try Self.diskUsage(file)
        storageBytes = usage.bytes; storageFiles = usage.files
        storageBlocked = usage.bytes >= Self.maximumDiskBytes || usage.files >= Self.maximumFiles
        if FileManager.default.fileExists(atPath: file.path) {
            let data = try Data(contentsOf: file)
            guard data.count <= Self.maximumBytes else { throw SessionJournalError.full }
            let stored = try JSONDecoder().decode(Envelope.self, from: data)
            guard stored.version == 2, stored.sessions.count <= 512 else { throw SessionJournalError.invalidState }
            var saved: [JournalSession] = []
            for entry in stored.sessions {
                do {
                guard entry.chunkCount > 0, entry.chunkCount <= Self.maximumBytes / 16 else { throw SessionJournalError.invalidState }
                var chunks: [SessionEventChunk] = []
                for sequence in 0..<entry.chunkCount {
                    let chunkFile = Self.chunkURL(file, entry.uuid, sequence)
                    let properties = try chunkFile.resourceValues(forKeys: [.fileSizeKey, .isSymbolicLinkKey])
                    guard properties.isSymbolicLink != true else { throw SessionJournalError.invalidState }
                    let size = properties.fileSize ?? Self.maximumBytes
                    guard size <= 160 * 1024 else { throw SessionJournalError.full }
                    let bytes = try Data(contentsOf: chunkFile, options: [.mappedIfSafe])
                    guard bytes.count <= 160 * 1024 else { throw SessionJournalError.full }
                    chunks.append(.init(sequence: sequence, events: bytes))
                }
                let session = JournalSession(uuid: entry.uuid, libraryIdentity: entry.libraryIdentity, startedAt: entry.startedAt,
                    endedAt: entry.endedAt, incomplete: entry.incomplete, acknowledgedThrough: entry.acknowledgedThrough, chunks: chunks)
                guard !session.libraryIdentity.isEmpty, session.libraryIdentity.utf8.count <= 256,
                      session.startedAt.timeIntervalSince1970.isFinite,
                      session.endedAt.map({ $0.timeIntervalSince1970.isFinite && $0 >= session.startedAt }) ?? true,
                      session.acknowledgedThrough >= -1, session.acknowledgedThrough < chunks.count,
                      !session.incomplete || session.endedAt != nil else { throw SessionJournalError.invalidState }
                var previousTime = -Double.infinity
                for chunk in chunks {
                    let bounds = try Self.validateEvents(chunk.events)
                    guard bounds.first >= previousTime else { throw SessionJournalError.invalidEvents }
                    previousTime = bounds.last
                }
                saved.append(session)
                } catch {
                    // Preserve original manifest entry and every recoverable byte.
                    // Never export a silently truncated session as complete.
                    quarantined.append(entry); damagedSessionIDs.append(entry.uuid)
                }
            }
            guard Set(stored.sessions.map(\.uuid)).count == stored.sessions.count else { throw SessionJournalError.invalidState }
            // The exact last persisted event is the only supported recovery boundary.
            // No new mapper may leave a crashed/uncertain prior session open.
            var recovered = false
            for i in saved.indices where saved[i].endedAt == nil && usage.bytes < Self.maximumDiskBytes && usage.files < Self.maximumFiles {
                let last = try Self.validateEvents(saved[i].chunks.last!.events).last
                let end = saved[i].startedAt.addingTimeInterval(last)
                guard end.timeIntervalSince1970.isFinite else { throw SessionJournalError.invalidState }
                saved[i].endedAt = end
                saved[i].incomplete = true
                recovered = true
            }
            if recovered, usage.bytes < Self.maximumDiskBytes, usage.files < Self.maximumFiles {
                do { try writer(Self.encodeManifest(saved, preserving: quarantined), file) }
                catch { throw SessionJournalError.persistence }
            }
            sessions = saved
            eventByteCount = saved.reduce(0) { $0 + $1.chunks.reduce(0) { $0 + $1.events.count } }
        } else { sessions = [] }
    }

    public func all() -> [JournalSession] { sessions }
    public var isReadOnly: Bool { storageBlocked || uncertainWrite }

    /// Local recovery evidence only, not authorization to share or delete it.
    /// Manifest descriptor preserves identity and committed chunk count. Each
    /// safely readable original chunk is returned independently, without filling
    /// a missing/corrupt suffix with invented events.
    public func damagedEvidence(uuid: UUID) throws -> (descriptor: Data, readableChunks: [SessionEventChunk]) {
        guard let entry = quarantined.first(where: { $0.uuid == uuid }) else { throw SessionJournalError.invalidState }
        var chunks: [SessionEventChunk] = []
        for sequence in 0..<min(entry.chunkCount, Self.maximumFiles) {
            let source = Self.chunkURL(file, uuid, sequence)
            guard let properties = try? source.resourceValues(forKeys: [.isSymbolicLinkKey, .fileSizeKey]),
                  properties.isSymbolicLink != true, let size = properties.fileSize, size <= 160 * 1024,
                  let bytes = try? Data(contentsOf: source) else { continue }
            chunks.append(.init(sequence: sequence, events: bytes))
        }
        return (try JSONEncoder().encode(entry), chunks)
    }

    public func open(uuid: UUID, libraryIdentity: String, startedAt: Date, context: Data) throws {
        guard startedAt.timeIntervalSince1970.isFinite, sessions.count < 512, !libraryIdentity.isEmpty, libraryIdentity.utf8.count <= 256,
              !sessions.contains(where: { $0.uuid == uuid }), !quarantined.contains(where: { $0.uuid == uuid }) else { throw SessionJournalError.invalidState }
        try Self.validateEvents(context)
        let value = JournalSession(uuid: uuid, libraryIdentity: libraryIdentity, startedAt: startedAt,
            incomplete: false, acknowledgedThrough: -1, chunks: [.init(sequence: 0, events: context)])
        try replace(sessions + [value])
    }

    public func append(uuid: UUID, expectedSequence: Int, events: Data) throws {
        guard let i = sessions.firstIndex(where: { $0.uuid == uuid }) else { throw SessionJournalError.invalidState }
        guard !storageBlocked else { throw SessionJournalError.full }
        guard sessions[i].endedAt == nil else { throw SessionJournalError.sessionClosed }
        guard expectedSequence == sessions[i].chunks.count else { throw SessionJournalError.sequenceMismatch }
        try Self.validateEvents(events)
        if let previous = sessions[i].chunks.last {
            let old = try JSONSerialization.jsonObject(with: previous.events) as! [[String: Any]]
            let new = try JSONSerialization.jsonObject(with: events) as! [[String: Any]]
            guard (new.first!["t"] as! NSNumber).doubleValue >= (old.last!["t"] as! NSNumber).doubleValue else {
                throw SessionJournalError.invalidEvents
            }
        }
        var next = sessions
        next[i].chunks.append(.init(sequence: expectedSequence, events: events))
        try replace(next)
    }

    public func close(uuid: UUID, endedAt: Date, incomplete: Bool = false) throws {
        guard endedAt.timeIntervalSince1970.isFinite, let i = sessions.firstIndex(where: { $0.uuid == uuid }), endedAt >= sessions[i].startedAt else { throw SessionJournalError.invalidState }
        if let previous = sessions[i].endedAt {
            guard previous == endedAt, sessions[i].incomplete == incomplete else { throw SessionJournalError.sessionClosed }
            return
        }
        var next = sessions; next[i].endedAt = endedAt; next[i].incomplete = incomplete
        try replace(next)
    }

    /// Only a transport with a verified exact durable receipt should call this.
    /// Out-of-order or future receipts cannot skip uncommitted local evidence.
    public func acknowledge(uuid: UUID, libraryIdentity: String, sequence: Int, exactEvents: Data) throws {
        guard let i = sessions.firstIndex(where: { $0.uuid == uuid }), sessions[i].libraryIdentity == libraryIdentity,
              sequence >= 0, sequence < sessions[i].chunks.count,
              sessions[i].chunks[sequence].events == exactEvents,
              sequence <= sessions[i].acknowledgedThrough + 1 else { throw SessionJournalError.sequenceMismatch }
        if sequence <= sessions[i].acknowledgedThrough { return }
        var next = sessions; next[i].acknowledgedThrough = sequence; try replace(next)
    }

    private func replace(_ next: [JournalSession]) throws {
        guard !uncertainWrite else { throw SessionJournalError.persistence }
        // A sole actor owns this tree. Startup reconciles all retained/orphan
        // entries; subsequent writes update only touched paths, never rescan
        // historical chunks. External writes require closing and reopening.
        guard !storageBlocked, storageBytes < Self.maximumDiskBytes - 512 * 1024,
              storageFiles < Self.maximumFiles - 4 else { storageBlocked = true; throw SessionJournalError.full }
        let data = try Self.encodeManifest(next, preserving: quarantined)
        var addedBytes = 0
        var touched: Set<URL> = [file, file.appendingPathExtension("chunks")]
        for session in next {
            let previous = sessions.first { $0.uuid == session.uuid }
            for chunk in session.chunks.dropFirst(previous?.chunks.count ?? 0) {
                addedBytes += chunk.events.count
                let target = Self.chunkURL(file, session.uuid, chunk.sequence)
                touched.insert(target); touched.insert(target.deletingLastPathComponent())
            }
        }
        guard data.count + eventByteCount + addedBytes <= Self.maximumBytes else { throw SessionJournalError.full }
        let before = try Self.pathUsage(touched)
        do {
            for session in next {
                let previous = sessions.first { $0.uuid == session.uuid }
                for chunk in session.chunks.dropFirst(previous?.chunks.count ?? 0) {
                    // Immutable bytes first. A crash before manifest publication
                    // leaves an unreferenced orphan, never an advanced prefix.
                    let destination = Self.chunkURL(file, session.uuid, chunk.sequence)
                    if FileManager.default.fileExists(atPath: destination.path) {
                        guard try Data(contentsOf: destination) == chunk.events else { throw SessionJournalError.persistence }
                    } else { try writer(chunk.events, destination) }
                }
            }
            try writer(data, file)
        } catch {
            // Rename may have landed before directory flush failed. Force a
            // reopen/reconciliation instead of overwriting uncertain disk state.
            uncertainWrite = true
            throw SessionJournalError.persistence
        }
        sessions = next
        eventByteCount += addedBytes
        let after: (bytes: Int, files: Int)
        do { after = try Self.pathUsage(touched) }
        catch { uncertainWrite = true; throw SessionJournalError.persistence }
        storageBytes += after.bytes - before.bytes
        storageFiles += after.files - before.files
        storageBlocked = storageBytes >= Self.maximumDiskBytes || storageFiles >= Self.maximumFiles
    }

    private static func chunkURL(_ file: URL, _ id: UUID, _ sequence: Int) -> URL {
        file.appendingPathExtension("chunks").appendingPathComponent(id.uuidString)
            .appendingPathComponent(String(sequence) + ".json")
    }

    private static func encodeManifest(_ sessions: [JournalSession], preserving damaged: [StoredSession] = []) throws -> Data {
        try JSONEncoder().encode(Envelope(version: 2, sessions: sessions.map {
            StoredSession(uuid: $0.uuid, libraryIdentity: $0.libraryIdentity, startedAt: $0.startedAt,
                endedAt: $0.endedAt, incomplete: $0.incomplete, acknowledgedThrough: $0.acknowledgedThrough,
                chunkCount: $0.chunks.count)
        } + damaged))
    }

    private static func pathUsage(_ paths: Set<URL>) throws -> (bytes: Int, files: Int) {
        var bytes = 0, files = 0
        for path in paths where FileManager.default.fileExists(atPath: path.path) {
            let value = try path.resourceValues(forKeys: [.isSymbolicLinkKey, .fileAllocatedSizeKey, .fileSizeKey])
            guard value.isSymbolicLink != true else { throw SessionJournalError.invalidState }
            bytes += max(value.fileAllocatedSize ?? 0, value.fileSize ?? 0); files += 1
        }
        return (bytes, files)
    }

    private static func diskUsage(_ file: URL) throws -> (bytes: Int, files: Int) {
        var bytes = 0, files = 0
        let root = file.appendingPathExtension("chunks")
        if FileManager.default.fileExists(atPath: file.path) {
            let value = try file.resourceValues(forKeys: [.fileAllocatedSizeKey, .fileSizeKey])
            bytes += max(value.fileAllocatedSize ?? 0, value.fileSize ?? 0); files += 1
        }
        if FileManager.default.fileExists(atPath: root.path) {
            let rootUsage = try pathUsage([root])
            bytes += rootUsage.bytes; files += rootUsage.files
            guard let iterator = FileManager.default.enumerator(at: root,
                includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileAllocatedSizeKey, .fileSizeKey]) else { throw SessionJournalError.persistence }
            for case let child as URL in iterator {
                let value = try child.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileAllocatedSizeKey, .fileSizeKey])
                if value.isSymbolicLink == true {
                    // Do not follow external content or hide healthy evidence.
                    // Preserve the entry and freeze writes for host repair.
                    return (maximumDiskBytes, max(files + 1, 1))
                }
                files += 1
                bytes += max(value.fileAllocatedSize ?? 0, value.fileSize ?? 0)
                // Bounded enumeration. Saturation blocks writes, preserves reads.
                if files >= maximumFiles || bytes >= maximumDiskBytes { break }
            }
        }
        return (bytes, files)
    }

    @discardableResult private static func validateEvents(_ data: Data) throws -> (first: Double, last: Double) {
        guard data.count <= 160 * 1024,
              let events = try JSONSerialization.jsonObject(with: data) as? [[String: Any]],
              !events.isEmpty, events.count <= 1024 else { throw SessionJournalError.invalidEvents }
        var previous = -Double.infinity
        for event in events {
            guard let time = event["t"] as? NSNumber, CFGetTypeID(time) != CFBooleanGetTypeID(),
                  time.doubleValue.isFinite, time.doubleValue >= 0, time.doubleValue >= previous,
                  event["kind"] is String else { throw SessionJournalError.invalidEvents }
            previous = time.doubleValue
        }
        return ((events.first!["t"] as! NSNumber).doubleValue, previous)
    }

    /// New bytes are flushed before rename; parent directory is flushed after it.
    /// Atomic replacement is intended to retain old or complete new JSON. Power-loss
    /// durability on Apple filesystems is not qualified by Linux tests.
    public static func durableWrite(_ data: Data, _ file: URL) throws {
        let parent = file.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
        let temporary = parent.appendingPathComponent(".session-journal-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: temporary) }
        guard FileManager.default.createFile(atPath: temporary.path, contents: nil,
              attributes: [.posixPermissions: 0o600]) else { throw SessionJournalError.persistence }
        let handle = try FileHandle(forWritingTo: temporary)
        do { try handle.write(contentsOf: data); try handle.synchronize(); try handle.close() }
        catch { try? handle.close(); throw error }
        guard rename(temporary.path, file.path) == 0 else { throw SessionJournalError.persistence }
        let directory = parent.path.withCString { systemOpen($0) }
        guard directory >= 0 else { throw SessionJournalError.persistence }
        defer { _ = systemClose(directory) }
        guard fsync(directory) == 0 else { throw SessionJournalError.persistence }
    }
}

private func systemOpen(_ path: UnsafePointer<CChar>) -> Int32 {
    #if canImport(Darwin)
    Darwin.open(path, O_RDONLY)
    #else
    Glibc.open(path, O_RDONLY | O_DIRECTORY)
    #endif
}
private func systemClose(_ fd: Int32) -> Int32 {
    #if canImport(Darwin)
    Darwin.close(fd)
    #else
    Glibc.close(fd)
    #endif
}
