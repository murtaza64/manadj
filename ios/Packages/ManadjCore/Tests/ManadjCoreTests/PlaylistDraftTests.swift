import XCTest
@testable import ManadjCore

final class PlaylistDraftTests: XCTestCase, @unchecked Sendable {
    private func location() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("drafts.json")
    }
    private let base = PlaylistDraftState(playlistId: 9, name: "B2b", trackIds: [1, 2, 3])
    private let changed = PlaylistDraftState(playlistId: 9, name: "Local draft", trackIds: [3, 1])

    func testDurableDraftAndDiscardNeverMutateOriginal() async throws {
        let file = location(); defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let store = try PlaylistDraftStore(file: file)
        let draft = try await store.stage(libraryIdentity: "paired-A", base: base, desired: changed, knownTrackIds: [1, 2, 3])
        let reopened = try PlaylistDraftStore(file: file)
        let pending = await reopened.pending()
        XCTAssertEqual(pending, [draft])
        XCTAssertEqual(base.trackIds, [1, 2, 3])
        let projection = await reopened.project(draft, libraryIdentity: "paired-A", current: base, knownTrackIds: [1, 2, 3])
        XCTAssertEqual(projection, .localDraft(changed))
        try await reopened.discard(draft.id)
        let empty = await reopened.pending(); XCTAssertTrue(empty.isEmpty)
        let reload = try PlaylistDraftStore(file: file)
        let durableEmpty = await reload.pending(); XCTAssertTrue(durableEmpty.isEmpty)
    }

    func testStaleWrongLibraryDeletedPlaylistAndMissingTrackHoldDraft() async throws {
        let file = location(); defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let store = try PlaylistDraftStore(file: file)
        let draft = try await store.stage(libraryIdentity: "paired-A", base: base, desired: changed, knownTrackIds: [1, 2, 3])
        let cases: [(String, PlaylistDraftState?, Set<Int>)] = [
            ("paired-B", base, [1, 2, 3]), ("paired-A", nil, [1, 2, 3]),
            ("paired-A", changed, [1, 2, 3]), ("paired-A", base, [1, 2]),
        ]
        for (identity, current, tracks) in cases {
            let projection = await store.project(draft, libraryIdentity: identity, current: current, knownTrackIds: tracks)
            guard case .held = projection else { return XCTFail("Unsafe projection: \(projection)") }
        }
        let pending = await store.pending(); XCTAssertEqual(pending, [draft])
    }

    func testValidationAndSaveFailureLeaveQueueUntouched() async throws {
        let file = location(); defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let store = try PlaylistDraftStore(file: file)
        let draft = try await store.stage(libraryIdentity: "paired-A", base: base, desired: changed, knownTrackIds: [1, 2, 3])
        for invalid in [PlaylistDraftState(playlistId: 9, name: "x", trackIds: [1, 1]),
                        PlaylistDraftState(playlistId: 9, name: " ", trackIds: [1]),
                        PlaylistDraftState(playlistId: 9, name: "x", trackIds: [999]), base] {
            do { _ = try await store.stage(libraryIdentity: "paired-A", base: base, desired: invalid, knownTrackIds: [1, 2, 3]); XCTFail("Invalid draft accepted") }
            catch { }
        }
        try FileManager.default.removeItem(at: file)
        try FileManager.default.createDirectory(at: file, withIntermediateDirectories: false)
        do { try await store.discard(draft.id); XCTFail("Expected file replacement failure") } catch { }
        let pending = await store.pending(); XCTAssertEqual(pending, [draft])
    }

    func testUnreadableLedgerIsNotSilentlyReset() throws {
        let file = location(); defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        let original = Data("broken ledger".utf8); try original.write(to: file)
        XCTAssertThrowsError(try PlaylistDraftStore(file: file))
        XCTAssertEqual(try Data(contentsOf: file), original)
    }
}
