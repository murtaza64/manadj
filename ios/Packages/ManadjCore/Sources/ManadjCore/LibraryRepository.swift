import Foundation

public struct LibrarySyncProgress: Sendable, Equatable {
    public enum Phase: Sendable, Equatable { case library, previews, details, audio }
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
    private var editJournal: LibraryEditJournal?
    private var editBindings: [Int: UUID] = [:]
    private var editTail: Task<Void, Error>?
    private var editTailID = UUID()
    private var editLibraryIdentity: String?
    private var editReady = false
    private let editWriter: @Sendable (Data, URL) throws -> Void
    public private(set) var editRecoveryError: String?

    /// Source revision here is the snapshot's revision plus exact file size/name,
    /// not a content hash or proof of remote authorship. Missing evidence blocks.
    private static func sourceRevision(_ track: LibraryTrack) -> String? {
        guard let rev = track.audioRev, !rev.isEmpty, let bytes = track.fileSizeBytes, bytes > 0 else { return nil }
        return "\(rev)|\(bytes)|\(track.fileName)"
    }

    public func prepareEdits(libraryIdentity: String, bindings: [Int: UUID]) async throws {
        guard editJournal == nil, editTail == nil, !syncing,
              Set(bindings.values).count == bindings.count,
              bindings.keys.allSatisfy({ id in snapshot?.tracks.contains { $0.id == id && Self.sourceRevision($0) != nil } == true }) else {
            throw LibraryEditJournalError.unavailableSource
        }
        editLibraryIdentity = libraryIdentity; editBindings = bindings
        do {
            let journal = try LibraryEditJournal(file: store.root.appendingPathComponent("continuous-edits.json"), libraryIdentity: libraryIdentity, writer: editWriter)
            editBindings = bindings; editLibraryIdentity = libraryIdentity; editJournal = journal
            let problems = await unresolvedEdits()
            editRecoveryError = problems.isEmpty ? nil : "Some pending edits need source binding review; healthy tracks remain editable"
            editReady = true
        } catch {
            editRecoveryError = "Edits unavailable; original journal retained: \(error)"
            throw error
        }
    }

    /// Serialization retains concurrent requests, including while audio sync is
    /// awaiting network. Each request receives success only after durable commit.
    public func editTrack(_ localID: Int, to value: LibraryEditValue, parents: [UUID]) async throws {
        let previous = editTail
        let token = UUID(); editTailID = token
        let work = Task { [weak self] in
            _ = try? await previous?.value
            guard let self else { throw CancellationError() }
            try await self.performEdit(localID, value: value, parents: parents)
        }
        editTail = work
        defer { if editTailID == token { editTail = nil } }
        try await work.value
    }

    private func performEdit(_ localID: Int, value: LibraryEditValue, parents: [UUID]) async throws {
        // No trusted signed head ledger is wired yet. Do not label arbitrary
        // caller UUIDs as validated causality; nonempty parents fail closed.
        guard parents.isEmpty else { throw LibraryEditJournalError.invalid }
        guard editReady, let journal = editJournal, let logical = editBindings[localID],
              let track = snapshot?.tracks.first(where: { $0.id == localID }),
              let revision = Self.sourceRevision(track) else { throw LibraryEditJournalError.unavailableSource }
        let pending = await journal.pending()
        guard pending.filter({ $0.logicalTrackID == logical }).allSatisfy({ $0.sourceRevision == revision }) else {
            throw LibraryEditJournalError.identityMismatch
        }
        let base: LibraryEditValue = value.field == "title" ? .title(track.title) : .mainCue(track.mainCue)
        let previous = LibraryEditJournal.project(pending, logicalTrackID: logical, base: base)
        _ = try await journal.append(logicalTrackID: logical, oldValue: previous.value, newValue: value,
            parents: parents, sourceRevision: revision)
    }

    /// Explicit non-destructive reopen after uncertain persistence, no restart.
    public func reopenEdits() async throws {
        let previous = editTail
        let token = UUID(); editTailID = token
        let work = Task { [weak self] in
            _ = try? await previous?.value
            guard let self else { throw CancellationError() }
            try await self.performReopen()
        }
        editTail = work
        defer { if editTailID == token { editTail = nil } }
        try await work.value
    }

    private func performReopen() async throws {
        guard let identity = editLibraryIdentity else { throw LibraryEditJournalError.invalid }
        do {
            let journal = try LibraryEditJournal(file: store.root.appendingPathComponent("continuous-edits.json"), libraryIdentity: identity, writer: editWriter)
            editJournal = journal
            let problems = await unresolvedEdits()
            editRecoveryError = problems.isEmpty ? nil : "Some pending edits need source binding review; healthy tracks remain editable"
            editReady = true
        } catch {
            editReady = false; editRecoveryError = "Journal reopen failed; original bytes retained: \(error)"
            throw error
        }
    }

    /// Explicitly set aside one whole track's pending intent chain. Original
    /// evidence remains retrievable; this never purges or resolves server state.
    public func setAsideEdits(logicalTrackID: UUID) async throws {
        let previous = editTail
        let token = UUID(); editTailID = token
        let work = Task { [weak self] in
            _ = try? await previous?.value
            guard let self else { throw CancellationError() }
            try await self.performSetAside(logicalTrackID)
        }
        editTail = work
        defer { if editTailID == token { editTail = nil } }
        try await work.value
    }

    private func performSetAside(_ logical: UUID) async throws {
        guard let journal = editJournal else { throw LibraryEditJournalError.invalid }
        let ids = Set(await journal.pending().filter { $0.logicalTrackID == logical }.map(\.id))
        try await journal.setAsideIntents(ids)
    }

    public func editEvidence() async -> [LibraryEditIntent] { await editJournal?.evidence() ?? [] }

    public func pendingEdits() async -> [LibraryEditIntent] { await editJournal?.pending() ?? [] }

    public func unresolvedEdits() async -> [LibraryEditIntent] {
        guard let journal = editJournal else { return [] }
        let tracks = snapshot?.tracks ?? [], bindings = editBindings
        let pending = await journal.pending()
        return pending.filter { intent in
            !tracks.contains { track in bindings[track.id] == intent.logicalTrackID && Self.sourceRevision(track) == intent.sourceRevision }
        }
    }

    private func projectedSnapshot() async -> Snapshot? {
        guard var result = snapshot, let journal = editJournal else { return snapshot }
        let bindings = editBindings
        let intents = await journal.pending()
        for index in result.tracks.indices {
            guard let logical = bindings[result.tracks[index].id], let revision = Self.sourceRevision(result.tracks[index]) else { continue }
            let edits = intents.filter { $0.logicalTrackID == logical }
            guard edits.allSatisfy({ $0.sourceRevision == revision }) else { continue }
            let title = LibraryEditJournal.project(edits, logicalTrackID: logical, base: .title(result.tracks[index].title))
            let cue = LibraryEditJournal.project(edits, logicalTrackID: logical, base: .mainCue(result.tracks[index].mainCue))
            // Differing base never silently displays an unresolved local winner.
            if title.conflictingBase == nil, case .title(let value) = title.value { result.tracks[index].title = value }
            if cue.conflictingBase == nil, case .mainCue(let value) = cue.value { result.tracks[index].mainCue = value }
        }
        return result
    }

    public func editConflicts() async -> [UUID: [LibraryEditProjection]] {
        guard let snapshot, let journal = editJournal else { return [:] }
        var result: [UUID: [LibraryEditProjection]] = [:]
        let intents = await journal.pending()
        for track in snapshot.tracks {
            guard let logical = editBindings[track.id] else { continue }
            for base in [LibraryEditValue.title(track.title), .mainCue(track.mainCue)] {
                let projection = LibraryEditJournal.project(intents, logicalTrackID: logical, base: base)
                if projection.conflictingBase != nil { result[logical, default: []].append(projection) }
            }
        }
        return result
    }
    public init(root: URL, editWriter: @escaping @Sendable (Data, URL) throws -> Void = SessionEventJournal.durableWrite) throws {
        self.editWriter = editWriter
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
    /// Snapshot commit uses the same lane as edits, so an edit cannot return
    /// success against a source revision replaced halfway through its append.
    private func installSnapshot(_ text: String, snapshot next: Snapshot) async throws {
        let previous = editTail
        let token = UUID(); editTailID = token
        let work = Task { [weak self] in
            _ = try? await previous?.value
            guard let self else { throw CancellationError() }
            try await self.commitSnapshot(text, snapshot: next)
        }
        editTail = work
        defer { if editTailID == token { editTail = nil } }
        try await work.value
    }

    private func commitSnapshot(_ text: String, snapshot next: Snapshot) throws {
        try store.saveSnapshot(text)
        snapshot = next
    }

    public func cachedSnapshot() async -> Snapshot? { await projectedSnapshot() }
    public func sync(_ connection: DesktopConnection, allAudio: Bool = false, progress: (@Sendable (LibrarySyncProgress) async -> Void)? = nil) async throws -> Snapshot {
        guard !syncing else { throw SyncError("A library sync is already in progress") }
        syncing = true
        defer { syncing = false }
        await progress?(.init(phase: .library))
        let client = SyncClient(connection)
        let text = try await client.snapshotText()
        try Task.checkCancellation()
        let next = try SnapshotJson.parse(text)
        try await installSnapshot(text, snapshot: next)
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
        // Full-resolution, revision-keyed detail belongs in library sync too.
        // Sequential requests bound memory and preserve complete cached files
        // when the network fails or the user cancels mid-sync.
        let detailed = next.tracks.filter { $0.waveformRev != nil }
        var detailsReady = detailed.filter { store.detail($0) != nil }.count
        await progress?(.init(phase: .details, completed: detailsReady, total: detailed.count))
        for track in detailed where store.detail(track) == nil {
            try Task.checkCancellation()
            do { _ = try await detail(track, connection: connection) }
            catch is CancellationError { throw CancellationError() }
            catch { if Task.isCancelled { throw CancellationError() }; throw SyncError("Full waveform for track \(track.id): \(error.localizedDescription)") }
            detailsReady += 1
            await progress?(.init(phase: .details, completed: detailsReady, total: detailed.count))
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
        return await projectedSnapshot() ?? next
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
