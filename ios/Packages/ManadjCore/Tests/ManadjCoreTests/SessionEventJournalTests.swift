import XCTest
@testable import ManadjCore

final class SessionEventJournalTests: XCTestCase {
    func testDurableActiveChunksRestartExactAckAndIncompleteClose() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("sessions.json"), id = UUID(), start = Date()
        let first = Data(#"[{"t":0,"kind":"tick","playheads":{}}]"#.utf8)
        let second = Data(#"[{"t":1,"kind":"tick","playheads":{"A":1}}]"#.utf8)
        let journal = try SessionEventJournal(file: file)
        try await journal.open(uuid: id, libraryIdentity: "generated-library", startedAt: start, context: first)
        try await journal.append(uuid: id, expectedSequence: 1, events: second)
        let reopened = try SessionEventJournal(file: file)
        let active = await reopened.all()
        XCTAssertEqual(active[0].endedAt, start.addingTimeInterval(1))
        XCTAssertTrue(active[0].incomplete)
        XCTAssertEqual(active[0].chunks.count, 2)
        do { try await reopened.acknowledge(uuid: id, libraryIdentity: "generated-library", sequence: 1, exactEvents: second); XCTFail() }
        catch { XCTAssertEqual(error as? SessionJournalError, .sequenceMismatch) }
        do { try await reopened.acknowledge(uuid: id, libraryIdentity: "wrong-library", sequence: 0, exactEvents: first); XCTFail() }
        catch { XCTAssertEqual(error as? SessionJournalError, .sequenceMismatch) }
        try await reopened.acknowledge(uuid: id, libraryIdentity: "generated-library", sequence: 0, exactEvents: first)
        try await reopened.close(uuid: id, endedAt: start.addingTimeInterval(1), incomplete: true)
        let final = try SessionEventJournal(file: file)
        let saved = await final.all()
        XCTAssertTrue(saved[0].incomplete)
        XCTAssertEqual(saved[0].acknowledgedThrough, 0)
        XCTAssertEqual(saved[0].chunks[1].events, second)
    }

    func testWriteFailureDoesNotAdvanceMemoryAndMalformedFileIsNotDiscarded() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        let journal = try SessionEventJournal(file: file, writer: { _, _ in throw SessionJournalError.persistence })
        do { try await journal.open(uuid: UUID(), libraryIdentity: "generated", startedAt: Date(),
            context: Data(#"[{"t":0,"kind":"tick","playheads":{}}]"#.utf8)); XCTFail() }
        catch { XCTAssertEqual(error as? SessionJournalError, .persistence) }
        let sessions = await journal.all(); XCTAssertTrue(sessions.isEmpty)
        try Data("broken envelope".utf8).write(to: file)
        XCTAssertThrowsError(try SessionEventJournal(file: file))
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), "broken envelope")
    }
}

extension SessionEventJournalTests {
    func testSequenceTimeAndCloseGuardsKeepLastGoodEvidence() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        let journal = try SessionEventJournal(file: file), id = UUID(), start = Date()
        let context = Data(#"[{"t":5,"kind":"tick","playheads":{}}]"#.utf8)
        try await journal.open(uuid: id, libraryIdentity: "generated", startedAt: start, context: context)
        do { try await journal.append(uuid: id, expectedSequence: 1, events: Data(#"[{"t":4,"kind":"tick"}]"#.utf8)); XCTFail() }
        catch { XCTAssertEqual(error as? SessionJournalError, .invalidEvents) }
        do { try await journal.append(uuid: id, expectedSequence: 2, events: context); XCTFail() }
        catch { XCTAssertEqual(error as? SessionJournalError, .sequenceMismatch) }
        try await journal.close(uuid: id, endedAt: start)
        do { try await journal.append(uuid: id, expectedSequence: 1, events: context); XCTFail() }
        catch { XCTAssertEqual(error as? SessionJournalError, .sessionClosed) }
        let saved = await journal.all(); XCTAssertEqual(saved[0].chunks.count, 1)
    }
}

extension SessionEventJournalTests {
    func testRecoveredFileCrossChunkRegressionIsRejectedWithoutRewrite() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        let journal = try SessionEventJournal(file: file), id = UUID()
        try await journal.open(uuid: id, libraryIdentity: "generated", startedAt: Date(),
            context: Data(#"[{"t":5,"kind":"tick"}]"#.utf8))
        var envelope = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
        var sessions = envelope["sessions"] as! [[String: Any]]
        sessions[0]["chunkCount"] = 2; envelope["sessions"] = sessions
        let second = file.appendingPathExtension("chunks").appendingPathComponent(id.uuidString).appendingPathComponent("1.json")
        try SessionEventJournal.durableWrite(Data(#"[{"t":4,"kind":"tick"}]"#.utf8), second)
        let malformed = try JSONSerialization.data(withJSONObject: envelope)
        try malformed.write(to: file)
        let isolated = try SessionEventJournal(file: file)
        let damaged = await isolated.damagedSessionIDs
        XCTAssertEqual(damaged, [id])
        XCTAssertEqual(try Data(contentsOf: file), malformed)
    }

    func testRecoveryPersistenceFailurePreservesEvidenceAndFailsConstruction() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        let journal = try SessionEventJournal(file: file)
        try await journal.open(uuid: UUID(), libraryIdentity: "generated", startedAt: Date(),
            context: Data(#"[{"t":0,"kind":"tick"}]"#.utf8))
        let before = try Data(contentsOf: file)
        XCTAssertThrowsError(try SessionEventJournal(file: file, writer: { _, _ in throw SessionJournalError.persistence }))
        XCTAssertEqual(try Data(contentsOf: file), before)
        let reopened = try SessionEventJournal(file: file)
        let recovered = await reopened.all()
        XCTAssertTrue(recovered[0].incomplete)
        XCTAssertNotNil(recovered[0].endedAt)
    }
}

extension SessionEventJournalTests {
    func testMeasuredGeneratedTenMinuteChunkBudget() async throws {
        final class Metrics: @unchecked Sendable {
            let lock = NSLock(); var bytes = 0; var writes = 0; var maximum = 0.0
            func record(_ data: Data, _ file: URL) throws {
                let start = Date()
                try SessionEventJournal.durableWrite(data, file)
                lock.lock(); defer { lock.unlock() }
                bytes += data.count; writes += 1; maximum = max(maximum, Date().timeIntervalSince(start))
            }
        }
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        let metrics = Metrics()
        let journal = try SessionEventJournal(file: file, writer: { try metrics.record($0, $1) })
        let id = UUID()
        try await journal.open(uuid: id, libraryIdentity: "generated-budget", startedAt: Date(),
            context: Data(#"[{"t":0,"kind":"tick","playheads":{"A":0,"B":0,"C":0,"D":0}}]"#.utf8))
        let start = Date()
        for second in 1...600 {
            let events = try JSONSerialization.data(withJSONObject: [["t": second, "kind": "tick", "playheads": ["A": second, "B": 0, "C": 0, "D": 0]]], options: [.sortedKeys])
            try await journal.append(uuid: id, expectedSequence: second, events: events)
        }
        print("JOURNAL_BUDGET generated600ticks writes=\(metrics.writes) bytes=\(metrics.bytes) final=\(try Data(contentsOf: file).count) elapsed=\(Date().timeIntervalSince(start)) maxWrite=\(metrics.maximum)")
        XCTAssertEqual(metrics.writes, 1202)
        XCTAssertLessThan(metrics.bytes, 400_000)
    }
}

extension SessionEventJournalTests {
    func testChunkLandedManifestFailedReopensOnlyCommittedPrefix() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("manifest.json"), id = UUID(), start = Date()
        let journal = try SessionEventJournal(file: file, writer: { data, target in
            if target == file, FileManager.default.fileExists(atPath: file.path) {
                throw SessionJournalError.persistence
            }
            try SessionEventJournal.durableWrite(data, target)
        })
        let first = Data(#"[{"t":0,"kind":"tick"}]"#.utf8)
        let second = Data(#"[{"t":1,"kind":"tick"}]"#.utf8)
        try await journal.open(uuid: id, libraryIdentity: "generated", startedAt: start, context: first)
        do { try await journal.append(uuid: id, expectedSequence: 1, events: second); XCTFail() } catch {}
        do { try await journal.append(uuid: id, expectedSequence: 1, events: second); XCTFail() } catch {}
        let reopened = try SessionEventJournal(file: file)
        let saved = await reopened.all()
        XCTAssertEqual(saved[0].chunks.count, 1); XCTAssertTrue(saved[0].incomplete)
        let orphan = file.appendingPathExtension("chunks").appendingPathComponent(id.uuidString).appendingPathComponent("1.json")
        XCTAssertEqual(try Data(contentsOf: orphan), second)
    }
}

extension SessionEventJournalTests {
    func testDamagedOldSessionIsIsolatedAndHealthyEvidenceRemainsWritable() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("manifest.json"), bad = UUID(), good = UUID(), at = Date()
        let context = Data(#"[{"t":0,"kind":"tick"}]"#.utf8)
        let journal = try SessionEventJournal(file: file)
        try await journal.open(uuid: bad, libraryIdentity: "generated", startedAt: at, context: context)
        try await journal.close(uuid: bad, endedAt: at)
        try await journal.open(uuid: good, libraryIdentity: "generated", startedAt: at, context: context)
        let damaged = file.appendingPathExtension("chunks").appendingPathComponent(bad.uuidString).appendingPathComponent("0.json")
        for corrupt in [false, true] {
            if corrupt { try Data("corrupt".utf8).write(to: damaged) }
            else { try FileManager.default.removeItem(at: damaged) }
            let reopened = try SessionEventJournal(file: file)
            let healthy = await reopened.all(), ids = await reopened.damagedSessionIDs
            XCTAssertEqual(healthy.map(\.uuid), [good]); XCTAssertEqual(ids, [bad])
            try await reopened.acknowledge(uuid: good, libraryIdentity: "generated", sequence: 0, exactEvents: context)
        }
        XCTAssertEqual(try Data(contentsOf: damaged), Data("corrupt".utf8))
        let final = try SessionEventJournal(file: file)
        let ids = await final.damagedSessionIDs; XCTAssertEqual(ids, [bad])
        let evidence = try await final.damagedEvidence(uuid: bad)
        XCTAssertFalse(evidence.descriptor.isEmpty)
        XCTAssertEqual(evidence.readableChunks.first?.events, Data("corrupt".utf8))
    }

    func testOrphanDiskBudgetBlocksWritesWithoutDeletingOrHidingHealthyEvidence() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("manifest.json")
        let journal = try SessionEventJournal(file: file), id = UUID()
        let context = Data(#"[{"t":0,"kind":"tick"}]"#.utf8)
        try await journal.open(uuid: id, libraryIdentity: "generated", startedAt: Date(), context: context)
        let orphan = file.appendingPathExtension("chunks").appendingPathComponent("orphan.bin")
        try Data(count: 5_000_000).write(to: orphan)
        let counted = try SessionEventJournal(file: file)
        let bytes = await counted.storageBytes; XCTAssertGreaterThanOrEqual(bytes, 5_000_000)
        try Data(count: SessionEventJournal.maximumDiskBytes).write(to: orphan)
        let saturated = try SessionEventJournal(file: file)
        let healthy = await saturated.all(), blocked = await saturated.isReadOnly
        XCTAssertEqual(healthy.count, 1); XCTAssertTrue(blocked)
        do { try await saturated.open(uuid: UUID(), libraryIdentity: "generated", startedAt: Date(), context: context); XCTFail() }
        catch { XCTAssertEqual(error as? SessionJournalError, .full) }
        XCTAssertEqual(try orphan.resourceValues(forKeys: [.fileSizeKey]).fileSize, SessionEventJournal.maximumDiskBytes)
    }
}

extension SessionEventJournalTests {
    func testSymlinkDoesNotHideHealthyAndCountersAdvance() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("manifest.json"), journal = try SessionEventJournal(file: file)
        let id = UUID(), context = Data(#"[{"t":0,"kind":"tick"}]"#.utf8)
        try await journal.open(uuid: id, libraryIdentity: "generated", startedAt: Date(), context: context)
        let count = await journal.storageFiles; XCTAssertGreaterThan(count, 0)
        let usageBeforeReopen = await journal.storageBytes
        let checkpoint = try SessionEventJournal(file: file)
        let scanned = await checkpoint.storageBytes, scannedFiles = await checkpoint.storageFiles
        // Recovery changes only a small manifest, directory allocation may vary.
        XCTAssertLessThan(abs(scanned - usageBeforeReopen), 65536)
        XCTAssertEqual(scannedFiles, count)
        try FileManager.default.createSymbolicLink(at: file.appendingPathExtension("chunks").appendingPathComponent("stray"), withDestinationURL: root)
        let reopened = try SessionEventJournal(file: file)
        let healthy = await reopened.all(), blocked = await reopened.isReadOnly
        XCTAssertEqual(healthy.count, 1); XCTAssertTrue(blocked); XCTAssertTrue(healthy[0].incomplete)
        do { try await reopened.append(uuid: id, expectedSequence: 1, events: context); XCTFail() }
        catch { XCTAssertEqual(error as? SessionJournalError, .full) }
    }
}
