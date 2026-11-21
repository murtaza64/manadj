import Foundation

public struct LibrarySyncProgress: Sendable, Equatable {
    public enum Phase: Sendable, Equatable { case library, previews, audio }
    public let phase: Phase
    public let completed: Int
    public let total: Int
    public init(phase: Phase, completed: Int = 0, total: Int = 0) {
        self.phase = phase; self.completed = completed; self.total = total
    }
}

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
    public func sync(_ connection: DesktopConnection, allAudio: Bool = false, progress: (@Sendable (LibrarySyncProgress) async -> Void)? = nil) async throws -> Snapshot {
        guard !syncing else { throw SyncError("A library sync is already in progress") }
        syncing = true
        defer { syncing = false }
        await progress?(.init(phase: .library))
        let client = SyncClient(connection)
        let text = try await client.snapshotText()
        try Task.checkCancellation()
        let next = try SnapshotJson.parse(text)
        try store.saveSnapshot(text)
        snapshot = next
        // Preview failure does not erase the last good library. Caller receives the error and can retry.
        let missing = next.tracks.filter { store.preview($0) == nil && $0.previewRev != nil }
        await progress?(.init(phase: .previews, total: missing.count))
        for start in stride(from: 0, to: missing.count, by: 100) {
            try Task.checkCancellation()
            let batch = Array(missing[start..<min(start + 100, missing.count)])
            let pack = try await client.previews(batch.map(\.id))
            try Task.checkCancellation()
            for track in batch { if let blob = pack[track.id] { try store.savePreview(blob, track: track) } }
            await progress?(.init(phase: .previews, completed: min(start + batch.count, missing.count), total: missing.count))
        }
        if allAudio {
            let eligible = next.tracks.filter { $0.audioRev != nil }
            var completed = eligible.filter(store.hasAudio).count
            await progress?(.init(phase: .audio, completed: completed, total: eligible.count))
            for track in eligible where !store.hasAudio(track) {
                try Task.checkCancellation()
                do { _ = try await audio(track, connection: connection) }
                catch is CancellationError { throw CancellationError() }
                catch { if Task.isCancelled { throw CancellationError() }; throw SyncError("Track \(track.id): \(error.localizedDescription)") }
                completed += 1
                await progress?(.init(phase: .audio, completed: completed, total: eligible.count))
            }
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
    public func detail(_ track: LibraryTrack, connection: DesktopConnection?) async throws -> PreviewWaveform? {
        if let cached = store.detail(track) { return cached }
        guard track.waveformRev != nil else { return nil }
        guard let connection else { throw SyncError("Full waveform not cached. Connect to desktop to fetch detail; audio remains playable.") }
        let data = try await SyncClient(connection).detailWaveform(track)
        try Task.checkCancellation()
        try store.saveDetail(data, track: track)
        return try PreviewWaveform.parse(data)
    }
    public func downloadedIds() -> Set<Int> { Set((snapshot?.tracks ?? []).filter(store.hasAudio).map(\.id)) }
    public func preview(_ track: LibraryTrack) -> PreviewWaveform? { previewCache.preview(track, store: store) }
    /// Android PreviewBitmaps: parsed row previews are cached, byte-budgeted.
    private let previewCache = PreviewParseCache()
}
