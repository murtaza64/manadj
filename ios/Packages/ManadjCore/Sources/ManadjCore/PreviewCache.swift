import Foundation

/// Android Library.kt PreviewBitmaps parity: parsed browser-row previews are
/// cached (LRU, byte-budgeted) so scrolling the library never re-reads and
/// re-parses MWF1 blobs from disk for rows that already appeared.
public final class PreviewParseCache: @unchecked Sendable {
    public static let defaultByteBudget = 24 * 1024 * 1024
    private let budget: Int
    private var values: [String: PreviewWaveform] = [:]
    private var lru: [String] = [] // oldest first
    private var bytes = 0
    private let lock = NSLock()

    public init(byteBudget: Int = PreviewParseCache.defaultByteBudget) {
        budget = max(0, byteBudget)
    }

    public var cachedBytes: Int {
        lock.lock(); defer { lock.unlock() }
        return bytes
    }

    /// A parsed waveform for [track], from cache or disk. Keyed by id + preview
    /// revision, so a re-synced preview never serves stale bytes.
    public func preview(_ track: LibraryTrack, store: LibraryStore) -> PreviewWaveform? {
        guard let rev = track.previewRev else { return nil }
        let key = "\(track.id)-\(rev)"
        lock.lock()
        if let hit = values[key] {
            lru.removeAll { $0 == key }
            lru.append(key)
            lock.unlock()
            return hit
        }
        lock.unlock()
        guard let parsed = store.preview(track) else { return nil }
        let cost = parsed.peaks.count + parsed.bands.count
        lock.lock()
        // Concurrent misses may have parsed the same entry. Never double-charge.
        if let existing = values[key] { bytes -= existing.peaks.count + existing.bands.count }
        guard cost <= budget else { lock.unlock(); return parsed }
        values[key] = parsed
        lru.removeAll { $0 == key }
        lru.append(key)
        bytes += cost
        while bytes > budget, lru.count > 1, let oldest = lru.first {
            lru.removeFirst()
            if let evicted = values.removeValue(forKey: oldest) {
                bytes -= evicted.peaks.count + evicted.bands.count
            }
        }
        lock.unlock()
        return parsed
    }
}
