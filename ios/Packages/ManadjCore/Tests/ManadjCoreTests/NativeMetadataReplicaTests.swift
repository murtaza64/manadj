#if canImport(CryptoKit) && canImport(JavaScriptCore)
import XCTest
import CryptoKit
@testable import ManadjCore

final class NativeMetadataReplicaTests: XCTestCase, @unchecked Sendable {
    @MainActor func testTwoActualNativeStoresConvergeAfterOfflineRestartRetryAndConflict() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let group = UUID(), aID = UUID(), bID = UUID(), logical = UUID()
        let aKey = Curve25519.Signing.PrivateKey(), bKey = Curve25519.Signing.PrivateKey()
        let members = [aID: aKey.publicKey, bID: bKey.publicKey]
        let bindingsA = [NativeTrackBinding(logicalID: logical, localID: 42, contentSHA256: String(repeating: "a", count: 64), byteLength: 4096)]
        let bindingsB = [NativeTrackBinding(logicalID: logical, localID: 99, contentSHA256: String(repeating: "a", count: 64), byteLength: 4096)]
        func makeA() throws -> NativeMetadataReplica {
            try NativeMetadataReplica(file: root.appendingPathComponent("a.json"), group: group, origin: aID, key: aKey, members: members, bindings: bindingsA)
        }
        func makeB() throws -> NativeMetadataReplica {
            try NativeMetadataReplica(file: root.appendingPathComponent("b.json"), group: group, origin: bID, key: bKey, members: members, bindings: bindingsB)
        }
        var a = try makeA(), b = try makeB()
        let title = try a.edit(localID: 42, value: .title("From native A"))
        try b.receive(title); try b.receive(title)
        XCTAssertEqual(b.cursor(aID), 1)
        let cue = try b.edit(localID: 99, value: .mainCue(12.5))
        a = try makeA(); b = try makeB()
        XCTAssertEqual(try b.outgoing(after: 0), [cue])
        try a.receive(cue); try a.receive(cue)
        XCTAssertEqual(try a.values(localID: 42, field: "title").first?["value"] as? String, "From native A")
        XCTAssertEqual(try b.values(localID: 99, field: "main_cue").first?["value"] as? Double, 12.5)
        let left = try a.edit(localID: 42, value: .title("Left offline"))
        let right = try b.edit(localID: 99, value: .title("Right offline"))
        try a.receive(right); try b.receive(left)
        XCTAssertEqual(try a.values(localID: 42, field: "title").count, 2)
        XCTAssertEqual(try b.values(localID: 99, field: "title").count, 2)
        let chosen = try a.edit(localID: 42, value: .title("Explicit choice"))
        try b.receive(chosen)
        a = try makeA(); b = try makeB()
        XCTAssertEqual(try a.values(localID: 42, field: "title").count, 1)
        XCTAssertEqual(try b.values(localID: 99, field: "title").first?["value"] as? String, "Explicit choice")
        XCTAssertEqual(a.allPackets().count, 5); XCTAssertEqual(b.allPackets().count, 5)
    }

    @MainActor func testActiveNativeSessionCoalescesDurableChunksAndReopensOnOtherDevice() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let group = UUID(), aID = UUID(), bID = UUID(), logical = UUID(), session = UUID()
        let aKey = Curve25519.Signing.PrivateKey(), bKey = Curve25519.Signing.PrivateKey()
        let members = [aID: aKey.publicKey, bID: bKey.publicKey]
        let a = try NativeMetadataReplica(file: root.appendingPathComponent("a.json"), group: group, origin: aID, key: aKey, members: members,
            bindings: [.init(logicalID: logical, localID: 12, contentSHA256: String(repeating: "a", count: 64), byteLength: 10)])
        func makeB() throws -> NativeMetadataReplica {
            try NativeMetadataReplica(file: root.appendingPathComponent("b.json"), group: group, origin: bID, key: bKey, members: members,
                bindings: [.init(logicalID: logical, localID: 2, contentSHA256: String(repeating: "a", count: 64), byteLength: 10)])
        }
        let journal = try SessionEventJournal(file: root.appendingPathComponent("journal.json"))
        let context = Data("[{\"t\":0,\"kind\":\"load\",\"channel\":\"A\",\"trackId\":12,\"bpm\":174}]".utf8)
        try await journal.open(uuid: session, libraryIdentity: "generated-library", startedAt: Date(timeIntervalSince1970: 1790000000), context: context)
        for second in 1...61 {
            let event = try JSONSerialization.data(withJSONObject: [["t": second, "kind": "tick", "playheads": ["A": second]]])
            try await journal.append(uuid: session, expectedSequence: second, events: event)
        }
        try a.captureHistory(await journal.all(), libraryIdentity: "generated-library")
        XCTAssertEqual(try a.historySummary().chunks, 2)
        XCTAssertEqual(try a.historySummary().active, 1)
        XCTAssertEqual(a.allPackets().count, 3) // 62 events are not 62 cloud ops.
        let b = try makeB()
        for packet in a.allPackets() { try b.receive(packet); try b.receive(packet) }
        XCTAssertEqual(try makeB().historySummary().sessions, 1)
        try await journal.close(uuid: session, endedAt: Date(timeIntervalSince1970: 1790000062))
        try a.captureHistory(await journal.all(), libraryIdentity: "generated-library")
        for packet in a.allPackets() { try b.receive(packet) }
        XCTAssertEqual(try b.historySummary().chunks, 3)
        XCTAssertEqual(try b.historySummary().active, 0)
        let count = a.allPackets().count
        try a.captureHistory(await journal.all(), libraryIdentity: "generated-library")
        XCTAssertEqual(a.allPackets().count, count)
        if let directory = ProcessInfo.processInfo.environment["MANADJ_NATIVE_VECTOR_OUTPUT"] {
            let object: [String: Any] = ["group": group.uuidString.lowercased(), "origin": aID.uuidString.lowercased(),
                "publicKey": aKey.publicKey.rawRepresentation.base64EncodedString(), "logical": logical.uuidString.lowercased(),
                "packets": try a.allPackets().map { try JSONSerialization.jsonObject(with: $0) }]
            try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
            try JSONSerialization.data(withJSONObject: object).write(to: URL(fileURLWithPath: directory).appendingPathComponent("native-history-packets.json"))
        }
        let raw = try NativeOperationCodec.canonical(["tracks": ["2": "two", "12": "twelve"]])
        XCTAssertEqual(String(decoding: raw, as: UTF8.self), "{\"tracks\":{\"12\":\"twelve\",\"2\":\"two\"}}")
    }

    @MainActor func testFailedCommitDoesNotAdvanceCursorAndUnboundTrackRejected() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let group = UUID(), aID = UUID(), bID = UUID(), logical = UUID()
        let aKey = Curve25519.Signing.PrivateKey(), bKey = Curve25519.Signing.PrivateKey()
        let members = [aID: aKey.publicKey, bID: bKey.publicKey]
        let binding = NativeTrackBinding(logicalID: logical, localID: 1, contentSHA256: String(repeating: "b", count: 64), byteLength: 8)
        let store = try NativeMetadataReplica(file: root.appendingPathComponent("failed.json"), group: group, origin: bID, key: bKey, members: members, bindings: [binding], writer: { _, _ in throw NativeReplicaError.persistence })
        let packet = try NativeOperationCodec.sign(group: group, origin: aID, sequence: 1, id: UUID(), track: logical, value: .title("Generated"), parents: [], key: aKey)
        XCTAssertThrowsError(try store.receive(packet)); XCTAssertEqual(store.cursor(aID), 0)
        XCTAssertTrue(store.allPackets().isEmpty)
        let healthy = try NativeMetadataReplica(file: root.appendingPathComponent("healthy.json"), group: group, origin: bID, key: bKey, members: members, bindings: [binding])
        let wrong = try NativeOperationCodec.sign(group: group, origin: aID, sequence: 1, id: UUID(), track: UUID(), value: .title("Unknown"), parents: [], key: aKey)
        XCTAssertThrowsError(try healthy.receive(wrong)); XCTAssertEqual(healthy.cursor(aID), 0)
    }
}
#endif
