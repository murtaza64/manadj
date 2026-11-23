import Foundation

public enum TagMatch: Sendable { case any, all }
public enum SortColumn: String, CaseIterable, Sendable {
    case playOrder, dateAdded, title, artist, bpm, key, energy, duration
}

public struct LibraryQuery: Sendable {
    public var playlistId: Int? = nil
    public var search = ""
    public var tagIds: Set<Int> = []
    public var tagMatch: TagMatch = .any
    public var energy: ClosedRange<Int>? = nil
    public var bpmCenter: Double? = nil
    public var bpmPercent = 5.0
    /// Current Android app browser uses absolute ±6 after folding track BPM.
    /// Nil preserves the library package's percentage-window contract.
    public var bpmTolerance: Double? = nil
    public var keysOpenKey: Set<String> = []
    public var sort: SortColumn = .dateAdded
    public var descending = true
    public var downloadedOnly = false
    public init() {}
}

public enum LibraryFilter {
    public static func matches(_ t: LibraryTrack, _ q: LibraryQuery, downloaded: (LibraryTrack) -> Bool = { _ in true }) -> Bool {
        if q.downloadedOnly && !downloaded(t) { return false }
        let needle = q.search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if !needle.isEmpty && ![t.title, t.artist ?? "", t.fileName].contains(where: { $0.lowercased().contains(needle) }) { return false }
        if let e = q.energy, !(e.lowerBound <= 1 && e.upperBound >= 5) {
            guard let value = t.energy, e.contains(value) else { return false }
        }
        if !q.tagIds.isEmpty {
            let shared = q.tagIds.intersection(t.tagIds).count
            if q.tagMatch == .all ? shared != q.tagIds.count : shared == 0 { return false }
        }
        if let center = q.bpmCenter {
            guard let bpm = t.bpm else { return false }
            if let tolerance = q.bpmTolerance {
                guard [bpm, bpm * 2, bpm / 2].contains(where: { abs($0 - center) <= tolerance }) else { return false }
            } else if !inBpmWindow(bpm, center: center, percent: q.bpmPercent) { return false }
        }
        if !q.keysOpenKey.isEmpty && !q.keysOpenKey.contains(t.keyOpenKey ?? "") { return false }
        return true
    }

    public static func inBpmWindow(_ bpm: Double, center: Double, percent: Double) -> Bool {
        [center, center * 2, center / 2].contains {
            let threshold = $0 * percent / 100
            return bpm >= $0 - threshold && bpm <= $0 + threshold
        }
    }

    public static func apply(_ tracks: [LibraryTrack], _ q: LibraryQuery, downloaded: (LibraryTrack) -> Bool = { _ in true }, inPlaylist: Bool = false) -> [LibraryTrack] {
        let kept = tracks.filter { matches($0, q, downloaded: downloaded) }
        if inPlaylist && q.sort == .playOrder { return q.descending ? Array(kept.reversed()) : kept }
        return kept.sorted { a, b in
            let order: Int
            switch q.sort {
            case .dateAdded, .playOrder: order = compare(a.dateAdded, b.dateAdded, q.descending)
            case .title: order = compare(a.title.lowercased(), b.title.lowercased(), q.descending)
            case .artist: order = compare(a.artist?.lowercased(), b.artist?.lowercased(), q.descending)
            case .bpm: order = compare(a.bpm, b.bpm, q.descending)
            case .key: order = compare(a.key ?? openKeyOrder(a.keyOpenKey), b.key ?? openKeyOrder(b.keyOpenKey), q.descending)
            case .energy: order = compare(a.energy, b.energy, q.descending)
            case .duration: order = compare(a.durationSecs, b.durationSecs, q.descending)
            }
            return order == 0 ? a.id > b.id : order < 0
        }
    }

    private static func compare<T: Comparable>(_ a: T?, _ b: T?, _ descending: Bool) -> Int {
        switch (a, b) {
        case (nil, nil): return 0
        case (nil, _): return 1
        case (_, nil): return -1
        case let (a?, b?): return a == b ? 0 : (a < b ? -1 : 1) * (descending ? -1 : 1)
        }
    }

    static func openKeyOrder(_ text: String?) -> Int? {
        guard let text, let suffix = text.last, suffix == "m" || suffix == "d",
              let number = Int(text.dropLast()), (1...12).contains(number) else { return nil }
        return (number - 1) * 2 + (suffix == "m" ? 1 : 0)
    }
}

/// Immutable view. Files are read through caller-owned closures, never from the UI clock.
public struct Library {
    public let snapshot: Snapshot
    private let downloaded: (LibraryTrack) -> Bool
    public init(_ snapshot: Snapshot, downloaded: @escaping (LibraryTrack) -> Bool = { _ in false }) {
        self.snapshot = snapshot
        self.downloaded = downloaded
    }
    public func track(_ id: Int) -> LibraryTrack? { snapshot.tracks.first { $0.id == id } }
    public var playlists: [Playlist] { snapshot.playlists.sorted { ($0.displayOrder, $0.id) < ($1.displayOrder, $1.id) } }
    public func playlistTracks(_ id: Int) -> [LibraryTrack] {
        let byId = Dictionary(uniqueKeysWithValues: snapshot.tracks.map { ($0.id, $0) })
        return snapshot.playlists.first { $0.id == id }?.trackIds.compactMap { byId[$0] } ?? []
    }
    public func query(_ q: LibraryQuery = LibraryQuery()) -> [LibraryTrack] {
        LibraryFilter.apply(q.playlistId.map(playlistTracks) ?? snapshot.tracks, q, downloaded: downloaded, inPlaylist: q.playlistId != nil)
    }
    public func follow(_ ids: [Int], params: FollowParams? = nil, within: LibraryQuery? = nil) -> [FollowRow] {
        let pool = within.map(query) ?? snapshot.tracks
        return FollowRanker.rank(pool, snapshot: snapshot, references: ids.compactMap(track), params: params ?? snapshot.performance.follow)
    }
}

/// Immutable inputs captured by the native browser before leaving the main actor.
/// Keeps the existing query, fixed-track Follow latch and post-query tag scope.
public struct BrowserQueryRequest: Sendable {
    public let query: LibraryQuery
    public let downloadedIds: Set<Int>
    public let referenceId: Int?
    public let sourceIsContainer: Bool
    public let sourceTagId: Int?
    public init(query: LibraryQuery, downloadedIds: Set<Int>, referenceId: Int?, sourceIsContainer: Bool, sourceTagId: Int?) {
        self.query = query
        self.downloadedIds = downloadedIds
        self.referenceId = referenceId
        self.sourceIsContainer = sourceIsContainer
        self.sourceTagId = sourceTagId
    }
    public func evaluate(_ snapshot: Snapshot) -> BrowserQueryResult {
        let library = Library(snapshot, downloaded: { downloadedIds.contains($0.id) })
        if let referenceId, !sourceIsContainer {
            let ranked = library.follow([referenceId], within: query)
            return BrowserQueryResult(rows: ranked.map(\.track).filter(inSource),
                followLabels: Dictionary(uniqueKeysWithValues: ranked.map { ($0.id, $0.label) }))
        }
        return BrowserQueryResult(rows: library.query(query).filter(inSource), followLabels: [:])
    }
    private func inSource(_ track: LibraryTrack) -> Bool {
        sourceTagId.map { track.tagIds.contains($0) } ?? true
    }
}
public struct BrowserQueryResult: Sendable {
    public let rows: [LibraryTrack]
    public let followLabels: [Int: String]
}
