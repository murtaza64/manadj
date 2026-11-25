import XCTest
@testable import ManadjCore

final class LibraryEditJournalTests: XCTestCase, @unchecked Sendable {
    func file() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("edits.json") }

    func testDurableOverlayRetryAndConflict() async throws {
        let file = file(); defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let track = UUID(), parent = UUID(), id = UUID()
        let journal = try LibraryEditJournal(file: file, libraryIdentity: "generated-library")
        let first = try await journal.append(id: id, logicalTrackID: track, oldValue: .title("Before"), newValue: .title("After"), parents: [parent])
        let retry = try await journal.append(id: id, logicalTrackID: track, oldValue: .title("Before"), newValue: .title("After"), parents: [parent])
        XCTAssertEqual(first, retry)
        let second = try await journal.append(logicalTrackID: track, oldValue: .title("After"), newValue: .title("Final"), parents: [parent])
        XCTAssertEqual(second.sequence, 2)
        let reopened = try LibraryEditJournal(file: file, libraryIdentity: "generated-library")
        let pending = await reopened.pending()
        XCTAssertEqual(pending, [first, second])
        let clean = await reopened.project(logicalTrackID: track, base: .title("Before"))
        XCTAssertEqual(clean, .init(value: .title("Final"), conflictingBase: nil))
        let conflict = await reopened.project(logicalTrackID: track, base: .title("Remote"))
        XCTAssertEqual(conflict, .init(value: .title("Final"), conflictingBase: .title("Remote")))
        let matching = await reopened.project(logicalTrackID: track, base: .title("Final"))
        XCTAssertNil(matching.conflictingBase)
        let retained = await reopened.pending()
        XCTAssertEqual(retained.count, 2, "Value equality is not transport acknowledgement")
        XCTAssertThrowsError(try LibraryEditJournal(file: file, libraryIdentity: "other-library"))
    }

    func testInvalidStaleAndRetryMismatchDoNotChangeDisk() async throws {
        let file = file(); defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let journal = try LibraryEditJournal(file: file, libraryIdentity: "test")
        let track = UUID(), id = UUID()
        _ = try await journal.append(id: id, logicalTrackID: track, oldValue: .mainCue(nil), newValue: .mainCue(2), parents: [])
        let before = try Data(contentsOf: file)
        let attempts: [(UUID, LibraryEditValue, LibraryEditValue, [UUID])] = [
            (id, .mainCue(nil), .mainCue(3), []),
            (UUID(), .mainCue(nil), .mainCue(3), []),
            (UUID(), .mainCue(2), .mainCue(.nan), []),
            (UUID(), .mainCue(2), .title("bad"), []),
            (UUID(), .title("same"), .title("same"), []),
            (UUID(), .mainCue(2), .mainCue(-1), [])
        ]
        for (id, old, new, parents) in attempts {
            do { _ = try await journal.append(id: id, logicalTrackID: track, oldValue: old, newValue: new, parents: parents); XCTFail("accepted invalid/stale") }
            catch { }
        }
        XCTAssertEqual(try Data(contentsOf: file), before)
        let second = try await journal.append(logicalTrackID: UUID(), oldValue: .mainCue(nil), newValue: .mainCue(3), parents: [])
        XCTAssertEqual(second.sequence, 2)
    }

    func testUncertainWriteFreezesUntilReopen() async throws {
        let file = file(); defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let id = UUID(), track = UUID()
        let journal = try LibraryEditJournal(file: file, libraryIdentity: "test", writer: { bytes, target in
            try SessionEventJournal.durableWrite(bytes, target)
            throw LibraryEditJournalError.persistence
        })
        for _ in 0..<2 {
            do { _ = try await journal.append(id: id, logicalTrackID: track, oldValue: .title("a"), newValue: .title("b"), parents: []); XCTFail("uncertain write succeeded") }
            catch { XCTAssertEqual(error as? LibraryEditJournalError, .persistence) }
        }
        let reopened = try LibraryEditJournal(file: file, libraryIdentity: "test")
        let retry = try await reopened.append(id: id, logicalTrackID: track, oldValue: .title("a"), newValue: .title("b"), parents: [])
        XCTAssertEqual(retry.sequence, 1)
        let pending = await reopened.pending()
        XCTAssertEqual(pending.count, 1)
    }

    func testActualRepositoryOverlaySurvivesSnapshotReplacementAndLocalIDsStayScoped() async throws {
        let root = file().deletingLastPathComponent(); defer { try? FileManager.default.removeItem(at: root) }
        let initial = #"{"version":1,"tag_categories":[],"tags":[],"playlists":[],"settings":{},"tracks":[{"id":42,"title":"Original","file_name":"generated.wav","audio_rev":"generated-rev","filesize_bytes":4,"main_cue":1}]}"#
        let remote = #"{"version":1,"tag_categories":[],"tags":[],"playlists":[],"settings":{},"tracks":[{"id":42,"title":"Remote edit","file_name":"generated.wav","audio_rev":"generated-rev","filesize_bytes":4,"main_cue":1}]}"#
        let store = try LibraryStore(root: root)
        try store.saveSnapshot(initial)
        let logical = UUID()
        let repository = try LibraryRepository(root: root)
        try await repository.prepareEdits(libraryIdentity: "generated-library", bindings: [42: logical])
        try await repository.editTrack(42, to: .title("Offline local edit"), parents: [])
        try await repository.editTrack(42, to: .mainCue(12.5), parents: [])
        let overlay = await repository.cachedSnapshot()
        XCTAssertEqual(overlay?.tracks[0].title, "Offline local edit")
        XCTAssertEqual(overlay?.tracks[0].mainCue, 12.5)
        XCTAssertEqual(try store.readSnapshot()?.tracks[0].title, "Original", "Overlay never mutates base snapshot")
        try store.saveSnapshot(remote)
        let reopened = try LibraryRepository(root: root)
        try await reopened.prepareEdits(libraryIdentity: "generated-library", bindings: [42: logical])
        let recovered = await reopened.cachedSnapshot()
        XCTAssertEqual(recovered?.tracks[0].title, "Remote edit", "Conflicting values are not silently overlaid")
        let conflicts = await reopened.editConflicts()
        XCTAssertEqual(conflicts[logical]?.first?.conflictingBase, .title("Remote edit"))
        let pending = await reopened.pendingEdits()
        XCTAssertEqual(pending.count, 2)
        XCTAssertEqual(pending.map(\.logicalTrackID), [logical, logical])
        do { try await reopened.editTrack(99, to: .title("Wrong local ID"), parents: []); XCTFail("unbound edit accepted") } catch { }
        let other = try LibraryRepository(root: root)
        do { try await other.prepareEdits(libraryIdentity: "other-library", bindings: [42: UUID()]); XCTFail("cross-library intent accepted") } catch { }
    }

    func testMissingChangedBindingsAndReusedIDCannotHideOrMisapplyIntents() async throws {
        let root = file().deletingLastPathComponent(); defer { try? FileManager.default.removeItem(at: root) }
        let store = try LibraryStore(root: root), logical = UUID()
        let original = #"{"version":1,"tag_categories":[],"tags":[],"playlists":[],"settings":{},"tracks":[{"id":42,"title":"A","file_name":"a.wav","audio_rev":"revision-a","filesize_bytes":4}]}"#
        try store.saveSnapshot(original)
        let repository = try LibraryRepository(root: root)
        try await repository.prepareEdits(libraryIdentity: "test", bindings: [42: logical])
        try await repository.editTrack(42, to: .title("Rename A"), parents: [])
        for bindings in [[:], [42: UUID()]] as [[Int: UUID]] {
            let other = try LibraryRepository(root: root)
            try await other.prepareEdits(libraryIdentity: "test", bindings: bindings)
            let unresolved = await other.unresolvedEdits()
            XCTAssertEqual(unresolved.count, 1)
        }
        try store.saveSnapshot(original.replacingOccurrences(of: "revision-a", with: "revision-b").replacingOccurrences(of: "a.wav", with: "b.wav"))
        let reused = try LibraryRepository(root: root)
        try await reused.prepareEdits(libraryIdentity: "test", bindings: [42: logical])
        let snapshot = await reused.cachedSnapshot()
        XCTAssertEqual(snapshot?.tracks[0].title, "A")
        let unresolved = await reused.unresolvedEdits()
        XCTAssertEqual(unresolved.count, 1)
    }

    func testConcurrentRepositoryRequestsAreDurablySerializedAndCanReopen() async throws {
        let root = file().deletingLastPathComponent(); defer { try? FileManager.default.removeItem(at: root) }
        let store = try LibraryStore(root: root)
        try store.saveSnapshot(#"{"version":1,"tag_categories":[],"tags":[],"playlists":[],"settings":{},"tracks":[{"id":1,"title":"A","file_name":"a.wav","audio_rev":"a","filesize_bytes":4},{"id":2,"title":"B","file_name":"b.wav","audio_rev":"b","filesize_bytes":4}]}"#)
        let repository = try LibraryRepository(root: root)
        try await repository.prepareEdits(libraryIdentity: "test", bindings: [1: UUID(), 2: UUID()])
        try await withThrowingTaskGroup(of: Void.self) { group in
            for id in [1,2] { group.addTask { try await repository.editTrack(id, to: .title("Edit"), parents: []) } }
            try await group.waitForAll()
        }
        try await repository.reopenEdits()
        let pending = await repository.pendingEdits()
        XCTAssertEqual(pending.count, 2)
        XCTAssertEqual(Set(pending.map(\.sequence)), [1,2])
    }

    func testRepositoryAmbiguousWriteCanReopenWithoutRestart() async throws {
        let root = file().deletingLastPathComponent(); defer { try? FileManager.default.removeItem(at: root) }
        let store = try LibraryStore(root: root)
        try store.saveSnapshot(#"{"version":1,"tag_categories":[],"tags":[],"playlists":[],"settings":{},"tracks":[{"id":1,"title":"A","file_name":"a.wav","audio_rev":"a","filesize_bytes":4}]}"#)
        let repository = try LibraryRepository(root: root, editWriter: { bytes, file in
            try SessionEventJournal.durableWrite(bytes, file)
            throw LibraryEditJournalError.persistence
        })
        try await repository.prepareEdits(libraryIdentity: "test", bindings: [1: UUID()])
        do { try await repository.editTrack(1, to: .title("Recovered"), parents: []); XCTFail("uncertain write succeeded") } catch { }
        try await repository.reopenEdits()
        let snapshot = await repository.cachedSnapshot()
        XCTAssertEqual(snapshot?.tracks[0].title, "Recovered")
        let pending = await repository.pendingEdits()
        XCTAssertEqual(pending.count, 1)
        do { try await repository.editTrack(1, to: .title("unverified causal parent"), parents: [UUID()]); XCTFail("arbitrary parent accepted") } catch { }
    }

    func testChangedSourceIsolatesPendingTrackNotHealthyLibrary() async throws {
        let root = file().deletingLastPathComponent(); defer { try? FileManager.default.removeItem(at: root) }
        let store = try LibraryStore(root: root), first = UUID(), second = UUID()
        let original = #"{"version":1,"tag_categories":[],"tags":[],"playlists":[],"settings":{},"tracks":[{"id":1,"title":"A","file_name":"a.wav","audio_rev":"a1","filesize_bytes":4},{"id":2,"title":"B","file_name":"b.wav","audio_rev":"b","filesize_bytes":4}]}"#
        try store.saveSnapshot(original)
        let repository = try LibraryRepository(root: root)
        try await repository.prepareEdits(libraryIdentity: "test", bindings: [1: first, 2: second])
        try await repository.editTrack(1, to: .title("Keep evidence"), parents: [])
        try store.saveSnapshot(original.replacingOccurrences(of: "a1", with: "a2"))
        let reopened = try LibraryRepository(root: root)
        try await reopened.prepareEdits(libraryIdentity: "test", bindings: [1: first, 2: second])
        try await reopened.editTrack(2, to: .title("Healthy edit"), parents: [])
        try await reopened.reopenEdits()
        let unresolved = await reopened.unresolvedEdits()
        XCTAssertEqual(unresolved.count, 1)
        XCTAssertEqual(unresolved.first?.newValue, .title("Keep evidence"))
        let snapshot = await reopened.cachedSnapshot()
        XCTAssertEqual(snapshot?.tracks[0].title, "A")
        XCTAssertEqual(snapshot?.tracks[1].title, "Healthy edit")
        do { try await reopened.editTrack(1, to: .title("Wrong revision"), parents: []); XCTFail("unresolved track edited") } catch { }
        let pending = await reopened.pendingEdits()
        XCTAssertEqual(pending.count, 2)
        try await reopened.setAsideEdits(logicalTrackID: first)
        let unresolvedAfter = await reopened.unresolvedEdits()
        XCTAssertTrue(unresolvedAfter.isEmpty)
        try await reopened.editTrack(1, to: .title("Explicit new-source edit"), parents: [])
        try await reopened.reopenEdits()
        let evidence = await reopened.editEvidence()
        XCTAssertEqual(evidence.count, 3, "Original unresolved edit retained after explicit disposition")
        let next = await reopened.pendingEdits()
        XCTAssertEqual(next.count, 2)
        XCTAssertEqual(next.last?.sequence, 3)
    }

    func testV2NoDispositionReadMigrationRetainsEvidenceAndNextWriteV3() async throws {
        let file = file(); defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let track = UUID()
        let journal = try LibraryEditJournal(file: file, libraryIdentity: "migration")
        let first = try await journal.append(logicalTrackID: track, oldValue: .title("a"), newValue: .title("b"), parents: [])
        var old = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        old["version"] = 2; old.removeValue(forKey: "setAside")
        try JSONSerialization.data(withJSONObject: old).write(to: file)
        let original = try Data(contentsOf: file)
        let reopened = try LibraryEditJournal(file: file, libraryIdentity: "migration")
        let recovered = await reopened.evidence()
        XCTAssertEqual(recovered, [first])
        XCTAssertEqual(try Data(contentsOf: file), original, "Opening legacy journal never rewrites evidence")
        _ = try await reopened.append(logicalTrackID: track, oldValue: .title("b"), newValue: .title("c"), parents: [])
        let next = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        XCTAssertEqual(next["version"] as? Int, 3)
        let entries = await reopened.evidence()
        XCTAssertEqual(entries.first, first)
    }

    func testCapacityFailureRetainsAllCommittedIntents() async throws {
        let file = file(); defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let journal = try LibraryEditJournal(file: file, libraryIdentity: "capacity")
        let track = UUID()
        for index in 0..<LibraryEditJournal.maximumIntents {
            _ = try await journal.append(logicalTrackID: track, oldValue: .title(String(index)), newValue: .title(String(index + 1)), parents: [])
        }
        let before = try Data(contentsOf: file)
        do { _ = try await journal.append(logicalTrackID: track, oldValue: .title("1024"), newValue: .title("1025"), parents: []); XCTFail("capacity ignored") }
        catch { XCTAssertEqual(error as? LibraryEditJournalError, .full) }
        XCTAssertEqual(try Data(contentsOf: file), before)
        let reopened = try LibraryEditJournal(file: file, libraryIdentity: "capacity")
        let pending = await reopened.pending()
        XCTAssertEqual(pending.count, LibraryEditJournal.maximumIntents)
    }

    func testCorruptAndSymlinkEvidencePreserved() throws {
        let file = file(); defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        let original = Data("bad generated bytes".utf8)
        try original.write(to: file)
        XCTAssertThrowsError(try LibraryEditJournal(file: file, libraryIdentity: "test"))
        XCTAssertEqual(try Data(contentsOf: file), original)
        let link = file.deletingLastPathComponent().appendingPathComponent("link.json")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: file)
        XCTAssertThrowsError(try LibraryEditJournal(file: link, libraryIdentity: "test"))
        XCTAssertEqual(try Data(contentsOf: file), original)
    }
}
