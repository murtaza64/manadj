import Foundation

/// Serializes disk/cache work away from the UI. Snapshot replacement is all-or-nothing.
public actor LibraryRepository {
    public let store: LibraryStore
    public let recoveryWarning: String?
    private var snapshot: Snapshot?
    private var syncing = false
    public init(root: URL) throws {
        store = try LibraryStore(root: root)
        do {
            snapshot = try store.readSnapshot()
            recoveryWarning = nil
        } catch {
            // Preserve bad bytes for diagnosis, but do not make a fresh sync impossible.
            let source = root.appendingPathComponent("snapshot.json")
            let quarantine = root.appendingPathComponent("snapshot.invalid-\(UUID().uuidString).json")
            try FileManager.default.moveItem(at: source, to: quarantine)
            snapshot = nil
            recoveryWarning = "The offline snapshot was unreadable and was kept separately. Sync again to restore the library."
        }
    }
    public func cachedSnapshot() -> Snapshot? { snapshot }
    public func sync(_ connection: DesktopConnection, allAudio: Bool = false) async throws -> Snapshot {
        guard !syncing else { throw SyncError("A library sync is already in progress") }
        syncing = true
        defer { syncing = false }
        let client = SyncClient(connection)
        let text = try await client.snapshotText()
        try Task.checkCancellation()
        let next = try SnapshotJson.parse(text)
        try store.saveSnapshot(text)
        snapshot = next
        // Preview failure does not erase the last good library. Caller receives the error and can retry.
        let missing = next.tracks.filter { store.preview($0) == nil && $0.previewRev != nil }
        for start in stride(from: 0, to: missing.count, by: 100) {
            try Task.checkCancellation()
            let batch = Array(missing[start..<min(start + 100, missing.count)])
            let pack = try await client.previews(batch.map(\.id))
            try Task.checkCancellation()
            for track in batch { if let blob = pack[track.id] { try store.savePreview(blob, track: track) } }
        }
        if allAudio {
            for track in next.tracks where track.audioRev != nil { try Task.checkCancellation(); _ = try await audio(track, connection: connection) }
        }
        try Task.checkCancellation()
        return next
    }
    public func audio(_ track: LibraryTrack, connection: DesktopConnection?) async throws -> URL {
        guard let target = store.audioFile(track) else { throw SyncError("Track has no downloadable audio revision. Sync the desktop library again.") }
        if store.hasAudio(track) { return target }
        guard let connection else { throw SyncError("This track is not downloaded. Connect to the desktop first.") }
        try await SyncClient(connection).downloadAudio(track.id, to: target, expectedBytes: track.fileSizeBytes, expectedRevision: track.audioRev)
        return target
    }
    public func downloadedIds() -> Set<Int> { Set((snapshot?.tracks ?? []).filter(store.hasAudio).map(\.id)) }
    public func preview(_ track: LibraryTrack) -> PreviewWaveform? { previewCache.preview(track, store: store) }
    /// Android PreviewBitmaps: parsed row previews are cached, byte-budgeted.
    private let previewCache = PreviewParseCache()
}
