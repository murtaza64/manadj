import Foundation

// MARK: - Library domain models (port of android/library Model.kt + SnapshotJson.kt)

/// A Tag as the track list shows it: color resolved (tag ?? category).
public struct LibraryTag: Equatable, Sendable {
    public let id: Int
    public let name: String
    public let categoryId: Int
    public let categoryName: String
    public let color: String?
    public let displayOrder: Int
}

/// `#rrggbb` -> opaque ARGB (0xffRRGGBB), nil when unset/unparseable.
public func parseHexColor(_ color: String?) -> UInt32? {
    guard let color else { return nil }
    let hex = color.hasPrefix("#") ? String(color.dropFirst()) : color
    guard hex.count == 6, let value = UInt32(hex, radix: 16) else { return nil }
    return value | 0xff00_0000
}

public struct TagCategory: Equatable, Sendable {
    public let id: Int
    public let name: String
    public let color: String?
    public let displayOrder: Int
}

public struct HotCue: Equatable, Sendable {
    public let slot: Int
    public let time: Double
    public let label: String?
    public let color: String?
}

/// One tempo segment of a saved Beatgrid (desktop ADR 0027 shape).
public struct TempoChange: Equatable, Sendable {
    public var startTime: Double
    public var bpm: Double
    public var timeSignatureNum: Int
    public var barPosition: Int
    public var timeSignatureDen: Int

    public init(startTime: Double, bpm: Double, timeSignatureNum: Int, barPosition: Int, timeSignatureDen: Int = 4) {
        self.startTime = startTime
        self.bpm = bpm
        self.timeSignatureNum = timeSignatureNum
        self.barPosition = barPosition
        self.timeSignatureDen = timeSignatureDen
    }
}

public struct Beatgrid: Equatable, Sendable {
    public let origin: String
    public let anchorTime: Double?
    public let tempoChanges: [TempoChange]

    public init(origin: String, anchorTime: Double?, tempoChanges: [TempoChange]) {
        self.origin = origin
        self.anchorTime = anchorTime
        self.tempoChanges = tempoChanges
    }
}

/// A Track's persisted Metric-ladder deviation (ADR 0029).
public struct MetricLadder: Equatable, Sendable {
    public let arities: [Int]
    public let resetMarks: [Double]
}

/// A desktop Library Track as synced to the device. `id` is the desktop Track id.
public struct LibraryTrack: Equatable, Sendable, Identifiable {
    public let id: Int
    public var title: String
    public let artist: String?
    public let fileName: String
    public let bpm: Double?
    /// The desktop's centiBPM column (Follow's BPM gate filters on it); nil when unknown.
    public let bpmCenti: Int64?
    public let key: Int?
    public let keyOpenKey: String?
    public let keyCamelot: String?
    public let energy: Int?
    public let durationSecs: Double?
    public let dateAdded: Date?
    public var mainCue: Double?
    public let codec: String?
    public let fileSizeBytes: Int64?
    public let audioRev: String?
    public let previewRev: String?
    public let waveformRev: String?
    public let stemsRev: String?
    public let tagIds: [Int]
    public let hotCues: [HotCue]
    public let grid: Beatgrid?
    public let ladder: MetricLadder?
}

/// A desktop Playlist (flat); `trackIds` in Play order.
public struct Playlist: Equatable, Sendable, Identifiable {
    public let id: Int
    public let name: String
    public let color: String?
    public let displayOrder: Int
    public let trackIds: [Int]
}

/// Aggregated saved Transitions for one ordered pair (a = outgoing).
public struct TransitionEdge: Equatable, Sendable {
    public let a: Int
    public let b: Int
    public let count: Int
    public let favorite: Bool
}

public struct CameoEdge: Equatable, Sendable {
    public let host: Int
    public let guest: Int
    public let count: Int
    public let favorite: Bool
}

/// Handover Takes for one ordered pair.
public struct TakeEdge: Equatable, Sendable {
    public let a: Int
    public let b: Int
    public let count: Int
    public let lastAt: Date?
}

/// One synced desktop setting as the snapshot carries it.
public struct SyncedSetting: Equatable, Sendable {
    /// The value JSON as the desktop persists it (nil when unset/unparseable).
    public let json: String?
    /// Nil when it's the shipped default rather than a user value.
    public let updatedAt: Date?

    public init(json: String?, updatedAt: Date?) {
        self.json = json
        self.updatedAt = updatedAt
    }
}

/// The whole pulled snapshot, as the desktop served it.
public struct Snapshot: Sendable {
    public static let supportedVersion = 1

    public let version: Int
    public let generatedAt: Date?
    public let categories: [TagCategory]
    public let tags: [LibraryTag]
    public var tracks: [LibraryTrack]
    public let playlists: [Playlist]
    public let links: [(Int, Int)]
    public let transitions: [TransitionEdge]
    public let cameos: [CameoEdge]
    public let takes: [TakeEdge]
    /// Parsed from an older snapshot schema (fields missing): resync before trusting it.
    public let schemaStale: Bool
    /// Synced performance settings (desktop settings key -> value).
    public let settings: [String: SyncedSetting]

    public var performance: PerformanceSettings { PerformanceSettings.of(settings) }
}
