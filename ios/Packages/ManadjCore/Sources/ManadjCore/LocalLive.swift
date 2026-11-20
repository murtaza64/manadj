import Foundation

/// Experimental sampled state, not a complete Session event log or audio stream.
public struct LiveDeckAnchor: Codable, Sendable {
    public let trackId: Int?
    public let audioRev: String?
    public let position: Double
    public let playing: Bool
    public let pitch: Double
    public let bend: Double
    public let fader: Double
    public let trim: Double
    public let low: Double
    public let mid: Double
    public let high: Double
    public let filter: Double
    public let keyLock: Bool
    public let unsupported: [String]

    public func target(age: Double, roundTrip: Double, elapsed: Double = 0) throws -> Double {
        guard position.isFinite, position >= 0, pitch.isFinite, (-25...25).contains(pitch),
              bend.isFinite, (-25...25).contains(bend), age.isFinite, age >= 0, age <= 2,
              roundTrip.isFinite, roundTrip >= 0, roundTrip <= 1, elapsed.isFinite, elapsed >= 0, elapsed <= 2,
              [fader, trim, low, mid, high].allSatisfy({ $0.isFinite && (0...1).contains($0) }),
              filter.isFinite, (-1...1).contains(filter), unsupported.isEmpty else {
            throw SyncError("Unsupported, stale or invalid live state. Phone playback paused.")
        }
        // Midpoint network estimate only. Asymmetry and source-to-server delay
        // remain measured prototype risks, not an audio-clock sync guarantee.
        let rate = (1 + pitch / 100) * (1 + bend / 100)
        return position + (playing ? (age + roundTrip / 2 + elapsed) * rate : 0)
    }
}

public struct LiveAnchor: Codable, Sendable {
    public let streamId: String
    public let seq: Int
    public let decks: [LiveDeckAnchor]
    public let unsupported: [String]
}

public struct LiveEnvelope: Codable, Sendable {
    public let version: Int
    public let state: String
    public let age: Double
    public let anchor: LiveAnchor?
    public static func parse(_ data: Data) throws -> LiveEnvelope {
        let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
        let value = try decoder.decode(Self.self, from: data)
        guard value.version == 1, ["live", "offline"].contains(value.state), value.age.isFinite, value.age >= 0 else {
            throw SyncError("Unknown local-live protocol")
        }
        if value.state == "live" {
            guard let anchor = value.anchor, UUID(uuidString: anchor.streamId) != nil,
                  anchor.seq >= 0, anchor.decks.count == 4 else { throw SyncError("Invalid live anchor") }
        }
        return value
    }
}
