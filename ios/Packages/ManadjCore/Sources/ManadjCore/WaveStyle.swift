import Foundation

/// Android WaveView.kt 'additive-soft' wave style, ported for stroke batching:
/// fringes add; where groups overlap the core takes the groups' energy-balance
/// hue, whitened by coreWhite (+coreBloom with stacking depth). Colors are
/// quantized to 5 bits per channel so a frame's segments batch into a handful
/// of stroke buckets, like Android's Lines bucketed drawLines.
public struct WaveStyle: Sendable, Equatable {
    public let colors: [[Double]] // low, mid, high as rgb 0...1
    public let coreWhite: Double
    public let coreBloom: Double
    public let master: Double

    public init(colors: [[Double]], coreWhite: Double, coreBloom: Double, master: Double) {
        self.colors = colors
        self.coreWhite = coreWhite
        self.coreBloom = coreBloom
        self.master = master
    }

    /// Android WaveStyle.FULL (desktop shipped defaults, frontend styles.ts).
    public static let full = WaveStyle(
        colors: [[0.7804, 0.0588, 0.0588], [0.2353, 0.6863, 0.0706], [0.0588, 0.5922, 1.0]],
        coreWhite: 0.32, coreBloom: 0.3, master: 1)
    /// Android WaveStyle.MINIMAP: minimap lane colors, lower white core, brighter bloom, slight gain.
    public static let minimap = WaveStyle(
        colors: [[0.8039, 0.0157, 0.0157], [0.0196, 0.6392, 0.1765], [0.1333, 0.6235, 0.9255]],
        coreWhite: 0.12, coreBloom: 0.42, master: 1.16)

    /// Android WaveStyle.color(mask, g), quantized. mask bit0 low, bit1 mid, bit2 high.
    public func bucket(mask: Int, groups: [Double]) -> Int {
        var rgb = [0.0, 0.0, 0.0]
        for i in 0..<3 where mask & (1 << i) != 0 {
            rgb[0] += colors[i][0]; rgb[1] += colors[i][1]; rgb[2] += colors[i][2]
        }
        let over = min(1, max(0, (rgb.max() ?? 0) - 1))
        rgb = rgb.map { min(1, $0) }
        if over > 0 {
            // Energy-balance hue from g^2 weights, quantized to 1/8 steps (Android).
            let weights = groups.map { ($0 * $0 * 8).rounded() / 8 }
            let total = weights.reduce(0, +) + 0.000001
            var hue = [0.0, 0, 0]
            for c in 0..<3 { for i in 0..<3 { hue[c] += weights[i] * colors[i][c] / total } }
            let maximum = (hue.max() ?? 1) + 0.000001
            let white = min(1, max(0, coreWhite + coreBloom * over))
            let t0 = min(1, over / 0.5); let t = t0 * t0 * (3 - 2 * t0)
            for c in 0..<3 {
                let h = hue[c] / maximum
                let mixed = h + (1 - h) * white
                rgb[c] += (mixed - rgb[c]) * t
            }
        }
        return WaveStyle.pack(rgb[0], rgb[1], rgb[2])
    }

    public static func pack(_ r: Double, _ g: Double, _ b: Double) -> Int {
        let q = [r, g, b].map { min(31, max(0, Int(($0 * 31).rounded()))) }
        return q[0] << 10 | q[1] << 5 | q[2]
    }

    public static func components(_ bucket: Int) -> (r: Double, g: Double, b: Double) {
        (Double(bucket >> 10 & 31) / 31, Double(bucket >> 5 & 31) / 31, Double(bucket & 31) / 31)
    }

    /// Android dim(): minimap bodies dim toward the wave background #0b0b0f, not black.
    /// Factor: OverviewDim.DESKTOP 0.65 * phone 0.8 = 0.52.
    public static func dimmed(_ bucket: Int, factor: Double) -> Int {
        guard factor < 1 else { return bucket }
        let bg = [11 / 255.0, 11 / 255.0, 15 / 255.0]
        let c = components(bucket)
        return pack(
            bg[0] + (c.r - bg[0]) * factor,
            bg[1] + (c.g - bg[1]) * factor,
            bg[2] + (c.b - bg[2]) * factor)
    }
}
