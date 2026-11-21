import Foundation

public enum TempoSyncStatus: String, Sendable { case off, synced, outOfLock, waiting }
public struct TempoSyncDeck: Sendable, Equatable {
    public var ready: Bool, playing: Bool
    public var bpm: Double?, pitch: Double, source: UInt64
    public init(ready: Bool = false, playing: Bool = false, bpm: Double? = nil, pitch: Double = 0, source: UInt64 = 0) {
        self.ready = ready; self.playing = playing; self.bpm = bpm.flatMap { $0.isFinite && $0 > 0 ? $0 : nil }; self.pitch = pitch; self.source = source
    }
}
/// Android SyncGroup.kt: group tempo, nearest playing reference, octave ratios and ±8% reach.
/// Joining with Quantize asks the engine for one phase alignment, never continuous phase lock.
@MainActor public final class TempoSyncGroup {
    public private(set) var tempo: Double?
    public private(set) var statuses = Array(repeating: TempoSyncStatus.off, count: 4)
    private var ratios: [Int: Double] = [:]
    private var decks = Array(repeating: TempoSyncDeck(), count: 4)
    private var written: [Int: Double] = [:]
    private let write: (Int, Double) -> Void
    private let align: (Int, Int, Double) -> Void
    public init(write: @escaping (Int, Double) -> Void, align: @escaping (Int, Int, Double) -> Void) { self.write = write; self.align = align }
    public static func matchPitch(base: Double, tempo: Double) -> Double? {
        guard base.isFinite, tempo.isFinite, base > 0, tempo > 0 else { return nil }
        let candidates = [tempo, tempo * 2, tempo / 2].map { ($0 / base - 1) * 100 }.filter { abs($0) <= 8 + 1e-6 }
        guard let first = candidates.first else { return nil }
        let p = abs((tempo / base - 1) * 100) <= 8 + 1e-6 ? first : candidates.min(by: { abs($0) < abs($1) })!
        return min(8, max(-8, p))
    }
    private func pitch(_ i: Int) -> Double { written[i] ?? decks[i].pitch }
    private func ratio(_ bpm: Double, _ tempo: Double) -> Double { [1.0, 2.0, 0.5].min { abs(tempo * $0 / bpm - 1) < abs(tempo * $1 / bpm - 1) }! }
    private func send(_ i: Int, _ p: Double) { written[i] = p; write(i, p) }
    public func update(_ next: [TempoSyncDeck]) {
        guard next.count == 4 else { return }
        let before = decks; decks = next
        for (i, p) in written where abs(next[i].pitch - p) < 1e-4 || next[i].source != before[i].source { written.removeValue(forKey: i) }
        var changed = false
        for i in ratios.keys where next[i].bpm != before[i].bpm || next[i].source != before[i].source || next[i].ready != before[i].ready {
            changed = true
            if let bpm = next[i].bpm, let tempo { ratios[i] = ratio(bpm, tempo) }
        }
        if changed { apply() } else { publish() }
    }
    /// false means not ready/missing BPM/out of reach, true includes leaving the group.
    @discardableResult public func toggle(_ i: Int, quantize: Bool) -> Bool {
        guard decks.indices.contains(i) else { return false }
        if ratios.removeValue(forKey: i) != nil { if ratios.isEmpty { tempo = nil }; publish(); return true }
        guard decks[i].ready, let bpm = decks[i].bpm else { return false }
        let own = bpm * (1 + pitch(i) / 100)
        let peers = decks.indices.filter { $0 != i && decks[$0].ready && decks[$0].playing && decks[$0].bpm != nil && (tempo == nil || statuses[$0] == .synced) }
        func effective(_ p: Int) -> Double { decks[p].bpm! * (1 + pitch(p) / 100) }
        func distance(_ p: Int) -> Double { let e = effective(p); return min(abs(e - own), abs(e * 2 - own), abs(e / 2 - own)) }
        let peer = peers.min { distance($0) < distance($1) }
        let t = tempo ?? peer.map(effective) ?? own
        guard Self.matchPitch(base: bpm, tempo: t) != nil else { return false }
        tempo = t; ratios[i] = ratio(bpm, t); apply()
        if quantize, let peer { align(i, peer, ratios[i]! / (ratios[peer] ?? ratio(effective(peer), t))) }
        return true
    }
    public func setPitch(_ i: Int, percent: Double) {
        guard decks.indices.contains(i), percent.isFinite else { return }
        let p = min(8, max(-8, percent))
        guard let r = ratios[i], let bpm = decks[i].bpm else { send(i, p); return }
        guard decks[i].ready else { return }
        tempo = bpm * (1 + p / 100) / r; apply()
    }
    private func apply() {
        guard let tempo else { return }
        for i in ratios.keys.sorted() { if decks[i].ready, let bpm = decks[i].bpm { send(i, min(8, max(-8, (tempo * ratios[i]! / bpm - 1) * 100))) } }
        publish()
    }
    private func publish() {
        statuses = decks.indices.map { i in
            guard let r = ratios[i] else { return .off }
            guard decks[i].ready, let bpm = decks[i].bpm, let tempo else { return .waiting }
            return abs((tempo * r / bpm - 1) * 100) > 8 + 1e-6 ? .outOfLock : .synced
        }
    }
}
