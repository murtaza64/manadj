#if canImport(CryptoKit) && canImport(JavaScriptCore)
import Foundation
import CryptoKit

public enum NativeReplicaError: Error { case invalid, full, gap, fork, missingParent, unresolvedBinding, persistence, frozen }

public struct NativeTrackBinding: Codable, Equatable, Sendable {
    public let logicalID: UUID
    public let localID: Int
    public let contentSHA256: String
    public let byteLength: Int
    public init(logicalID: UUID, localID: Int, contentSHA256: String, byteLength: Int) {
        self.logicalID = logicalID; self.localID = localID; self.contentSHA256 = contentSHA256; self.byteLength = byteLength
    }
}

/// Exact signed metadata packets plus receive cursors and causal heads commit in
/// one file transaction. No remote acknowledgement discards original evidence.
/// Single foreground owner. All identity/key/binding input is local provisioning,
/// never learned from incoming signed content. Not enabled by app startup.
@MainActor public final class NativeMetadataReplica {
    private struct Stored: Codable {
        let version: Int
        let group: UUID
        let origin: UUID
        let bindings: [NativeTrackBinding]
        var packets: [Data]
        var cursors: [String: Int]
        var heads: [String: [String]]
    }
    public static let maximumPackets = 2048
    public static let maximumBytes = 16 * 1024 * 1024
    private let file: URL
    private let key: Curve25519.Signing.PrivateKey
    private let members: [UUID: Curve25519.Signing.PublicKey]
    private let writer: (Data, URL) throws -> Void
    private var stored: Stored
    private var frozen = false

    public init(file: URL, group: UUID, origin: UUID, key: Curve25519.Signing.PrivateKey,
                members: [UUID: Curve25519.Signing.PublicKey], bindings: [NativeTrackBinding],
                writer: @escaping (Data, URL) throws -> Void = SessionEventJournal.durableWrite) throws {
        guard file.isFileURL, members[origin]?.rawRepresentation == key.publicKey.rawRepresentation,
              !members.isEmpty, members.count <= 4,
              Set(bindings.map(\.localID)).count == bindings.count,
              Set(bindings.map(\.logicalID)).count == bindings.count,
              bindings.allSatisfy({ $0.localID > 0 && $0.byteLength > 0 && $0.contentSHA256.count == 64 && $0.contentSHA256.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) } }) else { throw NativeReplicaError.invalid }
        self.file = file; self.key = key; self.members = members; self.writer = writer
        if FileManager.default.fileExists(atPath: file.path) {
            let attrs = try file.resourceValues(forKeys: [.fileSizeKey, .isSymbolicLinkKey])
            guard attrs.isSymbolicLink != true, let size = attrs.fileSize, size <= Self.maximumBytes else { throw NativeReplicaError.full }
            let bytes = try Data(contentsOf: file)
            guard bytes.count <= Self.maximumBytes else { throw NativeReplicaError.full }
            let old = try JSONDecoder().decode(Stored.self, from: bytes)
            guard old.version == 1, old.group == group, old.origin == origin, old.bindings == bindings,
                  old.packets.count <= Self.maximumPackets else { throw NativeReplicaError.invalid }
            stored = Stored(version: 1, group: group, origin: origin, bindings: bindings, packets: [], cursors: [:], heads: [:])
            // Rebuild from signed evidence instead of trusting serialized cursor
            // or projection maps that could advance beyond committed packets.
            var rebuilt = stored
            for packet in old.packets { try apply(packet, to: &rebuilt) }
            guard rebuilt.cursors == old.cursors, rebuilt.heads == old.heads else { throw NativeReplicaError.fork }
            stored = rebuilt
        } else {
            stored = Stored(version: 1, group: group, origin: origin, bindings: bindings, packets: [], cursors: [:], heads: [:])
        }
    }

    public func cursor(_ origin: UUID) -> Int { stored.cursors[origin.uuidString.lowercased()] ?? 0 }
    public func allPackets() -> [Data] { stored.packets }

    public func outgoing(after: Int, limit: Int = 4) throws -> [Data] {
        guard after >= 0, (1...4).contains(limit) else { throw NativeReplicaError.invalid }
        return try stored.packets.filter { packet in
            let b = try Self.object(packet)
            return b["origin_id"] as? String == stored.origin.uuidString.lowercased() && (b["sequence"] as? Int ?? 0) > after
        }.prefix(limit).map { $0 }
    }

    @discardableResult public func edit(localID: Int, value: LibraryEditValue) throws -> Data {
        guard !frozen, let binding = stored.bindings.first(where: { $0.localID == localID }) else { throw NativeReplicaError.unresolvedBinding }
        let entity = "track:" + binding.logicalID.uuidString.lowercased(), fieldKey = entity + "/" + value.field
        let parents = try (stored.heads[fieldKey] ?? []).map { text -> UUID in
            guard let id = UUID(uuidString: text) else { throw NativeReplicaError.invalid }; return id
        }
        let packet = try NativeOperationCodec.sign(group: stored.group, origin: stored.origin,
            sequence: cursor(stored.origin) + 1, id: UUID(), track: binding.logicalID, value: value, parents: parents, key: key)
        try receive(packet)
        return packet
    }

    /// An exact retry is a no-op. Remote write receipt is not required to retain
    /// local durability. Caller advances its network cursor only after return.
    public func receive(_ packet: Data) throws {
        guard !frozen else { throw NativeReplicaError.frozen }
        var next = stored
        try apply(packet, to: &next)
        if next.packets.count == stored.packets.count { return }
        let bytes = try JSONEncoder().encode(next)
        guard bytes.count <= Self.maximumBytes else { throw NativeReplicaError.full }
        do { try writer(bytes, file) }
        catch { frozen = true; throw NativeReplicaError.persistence }
        stored = next
    }

    /// One value means resolved; multiple values are an explicit conflict.
    /// Values are packet bodies, not auto-applied local Track rows.
    public func values(localID: Int, field: String) throws -> [[String: Any]] {
        guard let binding = stored.bindings.first(where: { $0.localID == localID }), ["title", "main_cue"].contains(field) else { throw NativeReplicaError.invalid }
        let entity = "track:" + binding.logicalID.uuidString.lowercased()
        let ids = Set(stored.heads[entity + "/" + field] ?? [])
        return try stored.packets.compactMap { packet in
            let b = try Self.object(packet)
            return ids.contains(b["operation_id"] as? String ?? "") ? b : nil
        }
    }

    private func apply(_ packet: Data, to next: inout Stored) throws {
        let body = try Self.object(packet)
        guard let originText = body["origin_id"] as? String, let origin = UUID(uuidString: originText),
              let pin = members[origin], let sequence = body["sequence"] as? Int,
              let operationID = body["operation_id"] as? String,
              let entity = body["entity"] as? String, let field = body["field"] as? String,
              let parents = body["parents"] as? [String] else { throw NativeReplicaError.invalid }
        let isSession = entity.hasPrefix("session:")
        let canonical = try isSession ? NativeSessionOperationCodec.verify(packet, group: next.group, origin: origin, pin: pin) : NativeOperationCodec.verify(packet, expectedGroup: next.group, expectedOrigin: origin, pinnedKey: pin)
        for old in next.packets {
            let b = try Self.object(old)
            if b["operation_id"] as? String == operationID || (b["origin_id"] as? String == originText && b["sequence"] as? Int == sequence) {
                guard let previousPin = members[origin], try (isSession ? NativeSessionOperationCodec.verify(old, group: next.group, origin: origin, pin: previousPin) : NativeOperationCodec.verify(old, expectedGroup: next.group, expectedOrigin: origin, pinnedKey: previousPin)) == canonical else { throw NativeReplicaError.fork }
                return
            }
        }
        guard sequence == (next.cursors[originText] ?? 0) + 1 else { throw NativeReplicaError.gap }
        if isSession { try validateSession(body, stored: next) }
        else { guard next.bindings.contains(where: { entity == "track:" + $0.logicalID.uuidString.lowercased() }) else { throw NativeReplicaError.unresolvedBinding } }
        for parent in parents {
            guard try next.packets.contains(where: { old in
                let b = try Self.object(old)
                return b["operation_id"] as? String == parent && b["entity"] as? String == entity && b["field"] as? String == field
            }) else { throw NativeReplicaError.missingParent }
        }
        guard next.packets.count < Self.maximumPackets else { throw NativeReplicaError.full }
        let fieldKey = entity + "/" + field
        let remaining = Set(next.heads[fieldKey] ?? []).subtracting(parents)
        next.heads[fieldKey] = Array(remaining.union([operationID])).sorted()
        next.packets.append(packet); next.cursors[originText] = sequence
    }

    /// Capture only complete durable local journal chunks. Coalescing preserves
    /// all events, but uses at most one signed chunk per 30 seconds of history.
    public func captureHistory(_ sessions: [JournalSession], libraryIdentity: String) throws {
        for session in sessions where session.libraryIdentity == libraryIdentity {
            // Protocol v1 has no incomplete/end-reason marker. Retain evidence
            // locally and stop, never silently skip or label a gap complete.
            guard !session.incomplete else { throw NativeReplicaError.invalid }
            let entity = "session:" + session.uuid.uuidString.lowercased()
            let existing = try stored.packets.map { try Self.object($0) }.filter { $0["entity"] as? String == entity }
            if existing.isEmpty { try issueSession(session.uuid, field: "start", value: Self.iso(session.startedAt)) }
            var consumed = 0
            let chunks = try stored.packets.map { try Self.object($0) }.filter { $0["entity"] as? String == entity && ($0["field"] as? String ?? "").hasPrefix("chunk:") }
            // Rebuild exact source prefix against stored signed batches. Never
            // republish a journal with a changed event prefix after restart.
            var source = try session.chunks.flatMap { try JSONSerialization.jsonObject(with: $0.events) as! [[String: Any]] }
            for body in chunks {
                guard let value = body["value"] as? [String: Any], let events = value["events"] as? [[String: Any]], consumed + events.count <= source.count else { throw NativeReplicaError.fork }
                let expected = Array(source[consumed..<(consumed + events.count)])
                guard try NativeOperationCodec.canonical(["events": events]) == NativeOperationCodec.canonical(["events": expected]) else { throw NativeReplicaError.fork }
                consumed += events.count
            }
            source.removeFirst(consumed)
            var index = chunks.count
            while !source.isEmpty {
                let firstTime = NativeSessionOperationCodec.number(source[0]["t"]) ?? 0
                var count = 0, mapping: [String: String] = [:], events: [[String: Any]] = []
                for event in source.prefix(1024) {
                    if !events.isEmpty && (NativeSessionOperationCodec.number(event["t"]) ?? 0) - firstTime >= 30 { break }
                    if let local = NativeSessionOperationCodec.integer(event["trackId"]) {
                        guard let binding = stored.bindings.first(where: { $0.localID == local }) else { throw NativeReplicaError.unresolvedBinding }
                        mapping[String(local)] = binding.logicalID.uuidString.lowercased()
                    }
                    events.append(event); count += 1
                    if try NativeOperationCodec.canonical(["events": events]).count > 128 * 1024 { events.removeLast(); count -= 1; break }
                }
                guard !events.isEmpty else { throw NativeReplicaError.full }
                let lastTime = NativeSessionOperationCodec.number(events.last?["t"]) ?? firstTime
                if session.endedAt == nil && source.count == count && lastTime - firstTime < 30 && count < 1024 { break }
                try issueSession(session.uuid, field: "chunk:\(index)", value: ["events": events, "tracks": mapping])
                source.removeFirst(count); index += 1
            }
            if let end = session.endedAt, source.isEmpty, !existing.contains(where: { $0["field"] as? String == "end" }) {
                try issueSession(session.uuid, field: "end", value: Self.iso(end))
            }
        }
    }
    private func issueSession(_ id: UUID, field: String, value: Any) throws {
        let packet = try NativeSessionOperationCodec.sign(group: stored.group, origin: stored.origin, sequence: cursor(stored.origin) + 1,
            id: UUID(), session: id, field: field, value: value, key: key)
        try receive(packet)
    }
    public func historySummary() throws -> (sessions: Int, chunks: Int, active: Int) {
        let bodies = try stored.packets.map { try Self.object($0) }.filter { ($0["entity"] as? String ?? "").hasPrefix("session:") }
        let starts = Set(bodies.filter { $0["field"] as? String == "start" }.compactMap { $0["entity"] as? String })
        let ends = Set(bodies.filter { $0["field"] as? String == "end" }.compactMap { $0["entity"] as? String })
        return (starts.count, bodies.filter { ($0["field"] as? String ?? "").hasPrefix("chunk:") }.count, starts.subtracting(ends).count)
    }
    private func validateSession(_ body: [String: Any], stored: Stored) throws {
        let entity = body["entity"] as! String, field = body["field"] as! String, origin = body["origin_id"] as! String
        let prior = try stored.packets.map { try Self.object($0) }.filter { $0["entity"] as? String == entity }
        if field == "start" { guard prior.isEmpty else { throw NativeReplicaError.fork }; return }
        guard let start = prior.first(where: { $0["field"] as? String == "start" }), start["origin_id"] as? String == origin,
              !prior.contains(where: { $0["field"] as? String == "end" }), !prior.contains(where: { $0["field"] as? String == field }) else { throw NativeReplicaError.fork }
        if field == "end" {
            guard let end = NativeSessionOperationCodec.date(body["value"]!), let begin = NativeSessionOperationCodec.date(start["value"]!), end >= begin else { throw NativeReplicaError.invalid }; return
        }
        let chunk = body["value"] as! [String: Any], tracks = chunk["tracks"] as! [String: String]
        guard tracks.values.allSatisfy({ logical in stored.bindings.contains { $0.logicalID.uuidString.lowercased() == logical } }) else { throw NativeReplicaError.unresolvedBinding }
        let index = Int(field.dropFirst(6))!
        let previous = prior.filter { ($0["field"] as? String ?? "").hasPrefix("chunk:") }
        guard index == previous.count else { throw NativeReplicaError.gap }
        if let last = previous.last, let old = last["value"] as? [String: Any], let events = old["events"] as? [[String: Any]], let current = chunk["events"] as? [[String: Any]],
           let before = NativeSessionOperationCodec.number(events.last?["t"]), let after = NativeSessionOperationCodec.number(current.first?["t"]), after < before { throw NativeReplicaError.invalid }
    }
    private static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return formatter.string(from: date)
    }

    private static func object(_ packet: Data) throws -> [String: Any] {
        guard packet.count <= 248 * 1024, let envelope = try JSONSerialization.jsonObject(with: packet) as? [String: Any],
              let body = envelope["body"] as? [String: Any] else { throw NativeReplicaError.invalid }
        return body
    }
}
#endif
