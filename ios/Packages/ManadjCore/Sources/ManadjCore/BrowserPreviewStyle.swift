import Foundation

/// Browser-specific desktop minimap slot. Unlike the performance detail view,
/// a preview interpolates the already-decimated spectral frames, never peaks.
public struct BrowserPreviewStyle: Sendable {
    public var id = "additive-rgb"
    public var gamma = 1.0, master = 2.0, coreWhite = 0.45, coreBloom = 0.3
    public var gains = [0.7, 1.05, 1.5]
    public var b1 = 3, b2 = 5
    public var colors = [[1.0, 0.1, 0.1], [0, 1, 0.25], [0.2, 0.45, 1]]
    public init(json: String? = nil) {
        guard let data = json?.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              (root["version"] as? Int ?? 1) == 1,
              let slot = root["minimap"] as? [String: Any] else { return }
        id = slot["styleId"] as? String ?? id
        if id == "layered-opaque" { colors = [[0.08, 0.22, 1], [1, 0.56, 0], [1, 1, 1]] }
        if id == "dominant-band" { colors = [[1, 0.15, 0.1], [0.1, 1, 0.25], [0.25, 0.55, 1]] }
        let p = slot["params"] as? [String: Any] ?? [:]
        func number(_ key: String, _ fallback: Double) -> Double { guard let n = p[key] as? Double, n.isFinite else { return fallback }; return n }
        gamma = max(0.01, number("displayGamma", gamma)); master = max(0, number("master", master))
        coreWhite = min(1, max(0, number("coreWhite", coreWhite))); coreBloom = min(1, max(0, number("coreBloom", coreBloom)))
        b1 = min(7, max(1, Int(min(7, max(1, number("b1", 3))).rounded()))); b2 = max(b1 + 1, min(8, max(2, Int(min(8, max(2, number("b2", 5))).rounded()))))
        if let g = p["gains"] as? [Double], g.count == 3, g.allSatisfy(\.isFinite) { gains = g }
        if let c = p["colors"] as? [[Double]], c.count == 3, c.allSatisfy({ $0.count == 3 && $0.allSatisfy(\.isFinite) }) { colors = c.map { $0.map { min(1, max(0, $0)) } } }
    }
    public var supportsStyle: Bool { ["additive-rgb", "additive-soft", "additive-screen", "layered-opaque", "dominant-band"].contains(id) }
    public func groups(_ wave: PreviewWaveform, frame: Int) -> [Double] {
        guard wave.nBands == 8, wave.bandFrames > 0 else { return [0, 0, 0] }
        let frame = min(wave.bandFrames - 1, max(0, frame))
        var energy = [0.0, 0, 0]
        for i in 0..<8 {
            let amplitude = pow(Double(wave.bands[frame * 8 + i]) / 255, gamma / wave.gamma)
            energy[i < b1 ? 0 : i < b2 ? 1 : 2] += amplitude * amplitude
        }
        return (0..<3).map { i in
            let x = sqrt(energy[i]) * gains[i]
            let soft = x <= 0.6 ? x : 0.6 + 0.4 * (1 - exp(-(x - 0.6) / 0.4))
            return min(1, max(0, soft * master))
        }
    }
    public func columns(_ wave: PreviewWaveform, count: Int) -> [[Double]] {
        guard count > 0, wave.bandFrames > 0 else { return [] }
        let frames = (0..<wave.bandFrames).map { groups(wave, frame: $0) }
        return (0..<count).map { x in
            let f = min(Double(frames.count - 1), max(0, (Double(x) + 0.5) * Double(frames.count) / Double(count) - 0.5))
            let lo = Int(f), hi = min(frames.count - 1, Int(f) + 1), t = f - Double(lo)
            return (0..<3).map { frames[lo][$0] * (1 - t) + frames[hi][$0] * t }
        }
    }
    /// RGB with the same overview dim toward #0b0b0f as the Android phone.
    public func color(groups g: [Double], amplitude y: Double) -> [Double]? {
        guard (g.max() ?? 0) > y else { return nil }
        var c = [0.0, 0, 0]
        if id == "layered-opaque" {
            c = y < g[2] ? colors[2] : y < g[1] ? colors[1] : colors[0]
        } else if id == "dominant-band" {
            let weights = g.map { pow($0, 3) }, total = g.map { pow($0, 3) }.reduce(0, +) + 0.000001
            for k in 0..<3 {
                var channel = 0.0
                for i in 0..<3 { channel += colors[i][k] * weights[i] / total }
                c[k] = channel * (0.45 + 0.55 * (g.max() ?? 0))
            }
        } else {
            for i in 0..<3 where g[i] > y { for k in 0..<3 {
                if id == "additive-screen" { c[k] = 1 - (1 - c[k]) * (1 - 0.82 * colors[i][k]) }
                else { c[k] += colors[i][k] }
            } }
            if id == "additive-soft" {
                let over = min(1, max(0, (c.max() ?? 0) - 1))
                let weights = g.map { ($0 * $0 * 8).rounded() / 8 }, total = g.map { $0 * $0 }.reduce(0, +) + 0.000001
                var hue = (0..<3).map { k in (0..<3).reduce(0.0) { $0 + colors[$1][k] * weights[$1] / total } }
                let maximum = (hue.max() ?? 0) + 0.000001
                hue = hue.map { $0 / maximum }
                let white = min(1, max(0, coreWhite + coreBloom * over)), t0 = min(1, over / 0.5), t = t0 * t0 * (3 - 2 * t0)
                c = (0..<3).map { k in let base = min(1, c[k]); return base + ((hue[k] + (1 - hue[k]) * white) - base) * t }
            }
        }
        let bg = [11 / 255.0, 11 / 255.0, 15 / 255.0]
        return (0..<3).map { bg[$0] + (min(1, max(0, c[$0])) - bg[$0]) * 0.52 }
    }
}
