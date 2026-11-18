import Foundation

/// Bounds-checked little-endian reads. Never binds potentially unaligned network bytes.
private struct Binary {
    let bytes: [UInt8]
    func integer(_ offset: Int, _ count: Int) throws -> UInt64 {
        guard offset >= 0, count >= 0, offset <= bytes.count, count <= bytes.count - offset else { throw SyncError("Truncated waveform") }
        return (0..<count).reduce(0) { $0 | (UInt64(bytes[offset + $1]) << (8 * $1)) }
    }
    func magic(_ value: String) -> Bool { bytes.starts(with: value.utf8) }
}

public struct PreviewWaveform: Sendable {
    public let durationSecs: Double
    public let gamma: Double
    public let nBands: Int
    public let sampleRate: Int
    public let peakHop: Int
    public let bandHop: Int
    public let stftWindow: Int
    public let peaks: [UInt8]
    public let bands: [UInt8]
    public var bandFrames: Int { nBands == 0 ? 0 : bands.count / nBands }
    public func amplitude(_ bin: Int) -> Double { pow(Double(peaks[bin]) / 255, 1 / gamma) }
    public func threeBand(_ frame: Int) -> [Double] {
        var out = [0.0, 0, 0]
        for b in 0..<nBands {
            let a = pow(Double(bands[frame * nBands + b]) / 255, 1 / gamma)
            out[b < 3 ? 0 : b < 5 ? 1 : 2] += a * a
        }
        return out.map { min(1, sqrt($0)) }
    }
    public static func parse(_ data: Data) throws -> PreviewWaveform {
        let r = Binary(bytes: Array(data))
        guard r.bytes.count >= 48, r.magic("MWF1") else { throw SyncError("Invalid MWF1 waveform") }
        let version = try r.integer(4, 2)
        guard version == 1 || version == 2 else { throw SyncError("Unsupported waveform version") }
        let rate = Int(try r.integer(8, 4))
        let duration = Double(bitPattern: try r.integer(12, 8))
        let n = Int(r.bytes[32])
        let gamma = Double(Float(bitPattern: UInt32(try r.integer(36, 4))))
        guard n <= 32, duration.isFinite, duration >= 0, gamma.isFinite, gamma > 0 else { throw SyncError("Invalid waveform dimensions") }
        var offset = 40 + (n + 1) * 4
        let peakCount = Int(try r.integer(offset, 4)); offset += 4
        let bandCount = Int(try r.integer(offset, 4)); offset += 4
        guard offset <= r.bytes.count, peakCount <= r.bytes.count - offset else { throw SyncError("Truncated peaks") }
        let bandsOffset = offset + peakCount
        guard bandCount <= (r.bytes.count - bandsOffset) / max(1, n) else { throw SyncError("Truncated bands") }
        return PreviewWaveform(durationSecs: duration, gamma: gamma, nBands: n, sampleRate: rate,
                               peakHop: Int(try r.integer(20, 4)), bandHop: Int(try r.integer(24, 4)), stftWindow: Int(try r.integer(28, 4)),
                               peaks: Array(r.bytes[offset..<bandsOffset]), bands: Array(r.bytes[bandsOffset..<(bandsOffset + bandCount * n)]))
    }
}

public enum PreviewPack {
    public static func parse(_ data: Data) throws -> [Int: Data] {
        let r = Binary(bytes: Array(data))
        guard r.bytes.count >= 8, r.magic("MPK1") else { throw SyncError("Invalid MPK1 preview pack") }
        let count = Int(try r.integer(4, 4))
        guard count <= (r.bytes.count - 8) / 8 else { throw SyncError("Invalid preview count") }
        var offset = 8
        var out: [Int: Data] = [:]
        for _ in 0..<count {
            let id = Int(try r.integer(offset, 4)), length = Int(try r.integer(offset + 4, 4)); offset += 8
            guard length <= r.bytes.count - offset else { throw SyncError("Truncated preview pack") }
            out[id] = Data(r.bytes[offset..<(offset + length)])
            offset += length
        }
        return out
    }
}

/// App-private revision-keyed cache. Untrusted filenames/revisions cannot escape root.
public struct LibraryStore: Sendable {
    public let root: URL
    public init(root: URL) throws {
        guard root.isFileURL else { throw SyncError("Cache root must be a file URL") }
        self.root = root.standardizedFileURL
        for dir in ["audio", "previews"] { try FileManager.default.createDirectory(at: root.appendingPathComponent(dir), withIntermediateDirectories: true) }
    }
    private func safe(_ value: String) -> String {
        // Hex-encoding UTF-8 is collision-free, unlike slash replacement.
        value.utf8.map { String(format: "%02x", $0) }.joined()
    }
    public func audioFile(_ track: LibraryTrack) -> URL? {
        guard let rev = track.audioRev else { return nil }
        let name = track.fileName.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "\\", with: "_")
        let safeName = name.isEmpty || name.hasPrefix(".") ? "audio" : name
        return root.appendingPathComponent("audio/\(track.id)-\(safe(rev))").appendingPathComponent(safeName)
    }
    public func previewFile(_ track: LibraryTrack) -> URL? {
        track.previewRev.map { root.appendingPathComponent("previews/\(track.id)-\(safe($0)).mwf") }
    }
    public func hasAudio(_ track: LibraryTrack) -> Bool {
        guard let url = audioFile(track),
              let attributes = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]),
              attributes.isRegularFile == true, let size = attributes.fileSize, size > 0 else { return false }
        return track.fileSizeBytes.map { $0 <= 0 || Int64(size) == $0 } ?? true
    }
    public func readSnapshot() throws -> Snapshot? {
        let url = root.appendingPathComponent("snapshot.json")
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try SnapshotJson.parse(String(contentsOf: url, encoding: .utf8))
    }
    public func saveSnapshot(_ text: String) throws {
        _ = try SnapshotJson.parse(text)
        try Data(text.utf8).write(to: root.appendingPathComponent("snapshot.json"), options: .atomic)
    }
    public func preview(_ track: LibraryTrack) -> PreviewWaveform? {
        guard let url = previewFile(track), let data = try? Data(contentsOf: url) else { return nil }
        return try? PreviewWaveform.parse(data)
    }
    public func savePreview(_ data: Data, track: LibraryTrack) throws {
        guard let url = previewFile(track) else { return }
        _ = try PreviewWaveform.parse(data)
        try data.write(to: url, options: .atomic)
    }
}
