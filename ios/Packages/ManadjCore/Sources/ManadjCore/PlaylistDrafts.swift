import Foundation

/// Isolated local planning prototype. It does not mutate a snapshot, upload an edit,
/// choose a conflict policy or claim that a desktop playlist has been updated.
/// Integer IDs are scoped to an explicit paired-library identity, never global IDs.
public struct PlaylistDraftState: Codable, Equatable, Sendable {
    public let playlistId: Int
    public let name: String
    public let trackIds: [Int]

    public init(playlistId: Int, name: String, trackIds: [Int]) {
        self.playlistId = playlistId; self.name = name; self.trackIds = trackIds
    }
}

public struct PlaylistDraft: Codable, Equatable, Sendable, Identifiable {
    public let id: UUID
    public let libraryIdentity: String
    public let base: PlaylistDraftState
    public let desired: PlaylistDraftState
    public let createdAt: Date
}

public enum PlaylistDraftProjection: Equatable, Sendable {
    case localDraft(PlaylistDraftState)
    case held(String)
}

public enum PlaylistDraftError: Error, Equatable {
    case invalidIdentity, invalidName, duplicateMember, unknownMember, mismatchedPlaylist, noChange
    case invalidStoredDrafts
}

/// One local draft per playlist and library. Durable save happens before replacing
/// in-memory state. A failed save leaves the previous queue intact. No transport is
/// attached: future propagation must explicitly consume a reviewed draft and add
/// causal playlist/entry identity, server acknowledgement and conflict handling.
public actor PlaylistDraftStore {
    private let file: URL
    private var drafts: [PlaylistDraft]
    private struct Envelope: Codable { let version: Int; let drafts: [PlaylistDraft] }

    public init(file: URL) throws {
        guard file.isFileURL else { throw PlaylistDraftError.invalidStoredDrafts }
        self.file = file
        if FileManager.default.fileExists(atPath: file.path) {
            let data = try Data(contentsOf: file)
            guard data.count <= 4 * 1024 * 1024 else { throw PlaylistDraftError.invalidStoredDrafts }
            let saved = try JSONDecoder().decode(Envelope.self, from: data)
            guard saved.version == 1, Set(saved.drafts.map(\.id)).count == saved.drafts.count else {
                throw PlaylistDraftError.invalidStoredDrafts
            }
            var keys = Set<String>()
            for draft in saved.drafts {
                try Self.validate(identity: draft.libraryIdentity, base: draft.base, desired: draft.desired)
                guard keys.insert("\(draft.libraryIdentity.utf8.count):\(draft.libraryIdentity):\(draft.base.playlistId)").inserted else {
                    throw PlaylistDraftError.invalidStoredDrafts
                }
            }
            drafts = saved.drafts
        } else { drafts = [] }
    }

    public func pending() -> [PlaylistDraft] { drafts }

    @discardableResult
    public func stage(libraryIdentity: String, base: PlaylistDraftState, desired: PlaylistDraftState,
                      knownTrackIds: Set<Int>) throws -> PlaylistDraft {
        try Self.validate(identity: libraryIdentity, base: base, desired: desired)
        guard desired.trackIds.allSatisfy(knownTrackIds.contains) else { throw PlaylistDraftError.unknownMember }
        let draft = PlaylistDraft(id: UUID(), libraryIdentity: libraryIdentity, base: base, desired: desired, createdAt: Date())
        let next = drafts.filter { $0.libraryIdentity != libraryIdentity || $0.base.playlistId != base.playlistId } + [draft]
        try save(next); drafts = next
        return draft
    }

    public func discard(_ id: UUID) throws {
        let next = drafts.filter { $0.id != id }
        try save(next); drafts = next
    }

    public func project(_ draft: PlaylistDraft, libraryIdentity: String, current: PlaylistDraftState?,
                        knownTrackIds: Set<Int>) -> PlaylistDraftProjection {
        guard draft.libraryIdentity == libraryIdentity else { return .held("Different paired library. Draft kept locally.") }
        guard let current else { return .held("Playlist is missing. Draft kept locally; no recreation or deletion chosen.") }
        guard current == draft.base else { return .held("Playlist changed since this draft. Review both versions; no automatic merge chosen.") }
        guard draft.desired.trackIds.allSatisfy(knownTrackIds.contains) else {
            return .held("A draft track is no longer available. Draft kept locally.")
        }
        return .localDraft(draft.desired)
    }

    private static func validate(identity: String, base: PlaylistDraftState, desired: PlaylistDraftState) throws {
        guard !identity.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw PlaylistDraftError.invalidIdentity }
        guard base.playlistId == desired.playlistId else { throw PlaylistDraftError.mismatchedPlaylist }
        guard !desired.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw PlaylistDraftError.invalidName }
        guard Set(desired.trackIds).count == desired.trackIds.count else { throw PlaylistDraftError.duplicateMember }
        guard base != desired else { throw PlaylistDraftError.noChange }
    }

    private func save(_ next: [PlaylistDraft]) throws {
        let data = try JSONEncoder().encode(Envelope(version: 1, drafts: next))
        guard data.count <= 4 * 1024 * 1024 else { throw PlaylistDraftError.invalidStoredDrafts }
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: file, options: .atomic)
    }
}
