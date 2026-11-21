import Foundation

public struct FollowParams: Sendable {
    public var bpm = true
    public var bpmThresholdPercent = 5.0
    public var knownOnly = false
    public var temperature = 0.0
    public var seed: UInt32 = 0
    public init() {}
}
public enum KnownKind: Int, Sendable { case favoritedTransition, linked, savedTransition }
public enum EvidenceTier: String, Sendable { case known = "KNOWN", compatible = "COMPATIBLE" }
public struct ScoreBreakdown: Sendable {
    public let referenceId: Int
    public let keyRelation: MatchScore.KeyRelation
    public let key: Double
    public let sharedTags: Int
    public let tags: Double
    public let artist: Double
    public let energy: Double
    public let bpm: Double
    public var affinity: Double { key + tags + artist }
    public var total: Double { affinity + energy + bpm }
}
public struct FollowRow: Sendable, Identifiable {
    public let track: LibraryTrack
    public let known: KnownKind?
    public let score: Double
    public let keyMatched: Bool
    public let matchedTagIds: Set<Int>
    public let sharedArtist: Bool
    public let breakdown: ScoreBreakdown?
    public var id: Int { track.id }
    public var tier: EvidenceTier { known == nil ? .compatible : .known }
    public var label: String {
        switch known {
        case .favoritedTransition: "★ Favorited transition"
        case .linked: "🔗 Linked"
        case .savedTransition: "◆ Saved transition"
        case nil: "Compatible"
        }
    }
}

public enum MatchScore {
    public enum KeyRelation: String, Sendable {
        case same = "SAME", relative = "RELATIVE", up = "UP", down = "DOWN", other = "OTHER"
        public var bonus: Double {
            switch self { case .same: 1; case .relative: 0.8; case .up: 0.7; case .down: 0.6; case .other: 0 }
        }
    }
    public static func keyRelation(_ reference: String?, _ candidate: String?) -> KeyRelation {
        guard let r = key(reference), let c = key(candidate) else { return .other }
        if c.0 == r.0 { return c.1 == r.1 ? .same : .relative }
        if c.1 != r.1 { return .other }
        if c.0 == (r.0 == 12 ? 1 : r.0 + 1) { return .up }
        if c.0 == (r.0 == 1 ? 12 : r.0 - 1) { return .down }
        return .other
    }
    private static func key(_ s: String?) -> (Int, Character)? {
        guard let s, let suffix = s.last, suffix == "m" || suffix == "d", let n = Int(s.dropLast()) else { return nil }
        return (n, suffix)
    }
    public static func tagContribution(_ count: Int) -> Double {
        let ladder = [0.0, 0.3, 0.5, 0.9, 1.0]
        return count <= 0 ? 0 : (count < 5 ? ladder[count] : 1 + Double(count - 4) * 0.03)
    }
    public static func energyContribution(_ a: Int?, _ b: Int?) -> Double {
        guard let a, let b else { return 0 }
        switch b - a { case 0: return 1; case 1: return 0.9; case -1: return 0.7; default: return 0 }
    }
    public static func bpmContribution(_ a: Double?, _ b: Double?, threshold: Double) -> Double {
        guard let a, let b, a > 0, b > 0 else { return 0 }
        let d = [a, a * 2, a / 2].map { abs(b - $0) / $0 * 100 }.min()!
        if d <= 2 { return 1 }
        if d >= threshold { return 0 }
        return 1 - (d - 2) / (threshold - 2)
    }
    public static func artistTokens(_ artist: String?) -> [String] {
        guard let artist else { return [] }
        let separated = artist.lowercased().replacingOccurrences(of: "\\bfeat\\.?\\b|\\bfeaturing\\b|\\bft\\.?\\b|\\bvs\\.?\\b|\\band\\b|\\bx\\b|[&,+]", with: "\u{0}", options: .regularExpression)
        return separated.components(separatedBy: "\u{0}").map {
            $0.replacingOccurrences(of: "[^\\p{L}\\p{N} ]", with: "", options: .regularExpression)
                .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
                .trimmingCharacters(in: .whitespaces)
        }.filter { $0.utf16.count > 1 }
    }
    public static func sharedArtist(_ a: String?, _ b: String?) -> Bool {
        artistTokens(a).contains { x in artistTokens(b).contains { y in
            // Kotlin and JS both compare UTF-16 code units, not grapheme clusters.
            let a = Array(x.utf16), b = Array(y.utf16)
            var previous = Array(0...b.count)
            for (i, ac) in a.enumerated() {
                var current = [i + 1] + Array(repeating: 0, count: b.count)
                for (j, bc) in b.enumerated() {
                    current[j + 1] = min(previous[j + 1] + 1, current[j] + 1, previous[j] + (ac == bc ? 0 : 1))
                }
                previous = current
            }
            return 1 - Double(previous[b.count]) / Double(max(a.count, b.count)) >= 0.8
        } }
    }
}

public struct BpmGate: Sendable {
    private let ranges: [ClosedRange<Int64>]?
    public init(reference: LibraryTrack, params: FollowParams) {
        guard params.bpm, let center = reference.bpm, center > 0 else { ranges = nil; return }
        let pct = Double(Int(params.bpmThresholdPercent))
        ranges = [center, center * 2, center / 2].map {
            let t = $0 * pct / 100
            return Int64(($0 - t) * 100)...Int64(($0 + t) * 100)
        }
    }
    public func admits(_ t: LibraryTrack) -> Bool {
        guard let ranges else { return true }
        guard let c = t.bpmCenti else { return false }
        return ranges.contains { $0.contains(c) }
    }
}

public enum FollowRanker {
    public static func breakdown(_ a: LibraryTrack, _ b: LibraryTrack, threshold: Double) -> ScoreBreakdown {
        let relation = MatchScore.keyRelation(a.keyOpenKey, b.keyOpenKey)
        let shared = Set(a.tagIds).intersection(b.tagIds).count
        return ScoreBreakdown(referenceId: a.id, keyRelation: relation, key: 25 * relation.bonus,
                              sharedTags: shared, tags: 30 * MatchScore.tagContribution(shared),
                              artist: MatchScore.sharedArtist(a.artist, b.artist) ? 20 : 0,
                              energy: 15 * MatchScore.energyContribution(a.energy, b.energy),
                              bpm: 10 * MatchScore.bpmContribution(a.bpm, b.bpm, threshold: threshold))
    }
    public static func rank(_ tracks: [LibraryTrack], snapshot: Snapshot, references: [LibraryTrack], params: FollowParams = FollowParams()) -> [FollowRow] {
        var seen = Set<Int>()
        let refs = references.filter { seen.insert($0.id).inserted }
        if refs.isEmpty { return [] }
        let gates = Dictionary(uniqueKeysWithValues: refs.map { ($0.id, BpmGate(reference: $0, params: params)) })
        var rows: [FollowRow] = []
        for c in tracks where !seen.contains(c.id) {
            var known: KnownKind? = nil
            var admitted = false
            var best: ScoreBreakdown? = nil
            var keyMatched = false
            var artist = false
            var tags = Set<Int>()
            for r in refs {
                let transition = snapshot.transitions.first { $0.a == r.id && $0.b == c.id }
                let linked = snapshot.links.contains { ($0.0 == r.id && $0.1 == c.id) || ($0.1 == r.id && $0.0 == c.id) }
                let k: KnownKind? = transition?.favorite == true ? .favoritedTransition : (linked ? .linked : (transition == nil ? nil : .savedTransition))
                if let k, known == nil || k.rawValue < known!.rawValue { known = k }
                let b = breakdown(r, c, threshold: params.bpmThresholdPercent)
                if best == nil || b.total > best!.total { best = b }
                if !params.knownOnly && b.affinity >= 15 && gates[r.id]!.admits(c) { admitted = true }
                keyMatched = keyMatched || b.keyRelation != .other
                artist = artist || b.artist > 0
                tags.formUnion(Set(r.tagIds).intersection(c.tagIds))
            }
            if known == nil && !admitted { continue }
            rows.append(FollowRow(track: c, known: known, score: best?.total ?? 0, keyMatched: keyMatched, matchedTagIds: tags, sharedArtist: artist, breakdown: best))
        }
        let salt = "\(params.seed):\(refs.map(\.id).sorted().map(String.init).joined(separator: ","))"
        func draw(_ r: FollowRow) -> Double {
            r.score - (r.known == nil && params.temperature > 0 ? 30 * params.temperature * log(-log(uniform("\(salt):\(r.id)"))) : 0)
        }
        // Explicit input ordinal preserves Android/desktop's stable ties.
        return rows.enumerated().sorted { a, b in
            let ka = a.element.known?.rawValue ?? 3, kb = b.element.known?.rawValue ?? 3
            if ka != kb { return ka < kb }
            let sa = draw(a.element), sb = draw(b.element)
            return sa == sb ? a.offset < b.offset : sa > sb
        }.map(\.element)
    }
    public static func uniform(_ key: String) -> Double {
        var h: UInt32 = 2_166_136_261
        for c in key.utf16 { h = (h ^ UInt32(c)) &* 16_777_619 }
        h = (h ^ (h >> 16)) &* 0x85ebca6b
        h = (h ^ (h >> 13)) &* 0xc2b2ae35
        h ^= h >> 16
        return (Double(h) + 0.5) / 4_294_967_296
    }
}

public struct PerformanceSettings: Sendable {
    public let filterJson: String?
    public let waveformStylesJson: String?
    public let follow: FollowParams
    public static func of(_ settings: [String: SyncedSetting]) -> PerformanceSettings {
        var p = FollowParams()
        if let text = settings["manadj-follow-params"]?.json, let data = text.data(using: .utf8),
           let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            p.bpm = o["bpm"] as? Bool ?? true
            p.knownOnly = o["knownOnly"] as? Bool ?? false
            if let t = o["bpmThresholdPercent"] as? Double, t.isFinite { p.bpmThresholdPercent = min(15, max(0, t)) }
            if let t = o["temperature"] as? Double, t.isFinite { p.temperature = min(1, max(0, t)) }
        }
        return PerformanceSettings(filterJson: settings["manadj-filter-settings"]?.json, waveformStylesJson: settings["manadj.waveformStyles"]?.json, follow: p)
    }
}
