import Foundation

/// Display-frame predictor ported from Android SmoothClock. Transport discontinuities snap.
public struct WaveClock {
    private var shown = Double.nan
    private var target = Double.nan
    private var targetAt = 0.0
    private var last = 0.0
    public init() {}
    public mutating func at(_ now: Double, raw: Double, moving: Bool, rate: Double) -> Double {
        if raw != target { target = raw; targetAt = now }
        let predicted = moving ? target + (now - targetAt) * rate : target
        if !moving || !shown.isFinite || last == 0 || now <= last { shown = predicted; last = now; return shown }
        let dt = now - last; last = now
        let free = shown + dt * rate
        let error = predicted - free
        shown = abs(error) > 0.25 ? predicted : max(rate > 0 ? shown : -.infinity, free + error * 0.12)
        return shown
    }
}

public extension PreviewWaveform {
    /// Android columnGroups: half-window alignment, box mean or interpolation, squared companding,
    /// energy groups (3/2/3 bands), gains and soft limiting. No made-up waveform on missing data.
    func columnGroups(from t0: Double, to t1: Double) -> [Double] {
        guard nBands == 8, bandFrames > 0, bandHop > 0 else { return [0, 0, 0] }
        let fps = Double(sampleRate) / Double(bandHop)
        let x0 = t0 * fps - Double(stftWindow) * 0.5 / Double(bandHop)
        let x1 = t1 * fps - Double(stftWindow) * 0.5 / Double(bandHop)
        if x0 >= Double(bandFrames) { return [0, 0, 0] }
        var bands8 = [Double](repeating: 0, count: 8)
        if x1 - x0 < 1 {
            let i0 = min(max(0, Int(floor((x0 + x1) / 2))), max(0, bandFrames - 2))
            let i1 = min(i0 + 1, bandFrames - 1)
            let fraction = min(1, max(0, (x0 + x1) / 2 - Double(i0)))
            for k in 0..<8 { bands8[k] = (Double(bands[i0 * 8 + k]) * (1 - fraction) + Double(bands[i1 * 8 + k]) * fraction) / 255 }
        } else {
            let i0 = min(max(0, Int(floor(x0))), bandFrames - 1)
            let i1 = min(max(i0, Int(floor(x1))), bandFrames - 1)
            let step = max(1, (i1 - i0) / 12)
            var n = 0
            for i in stride(from: i0, through: i1, by: step) {
                for k in 0..<8 { bands8[k] += Double(bands[i * 8 + k]) / 255 }
                n += 1
            }
            for k in 0..<8 { bands8[k] /= Double(n) }
        }
        var groups = [0.0, 0, 0]
        for k in 0..<8 { groups[k < 3 ? 0 : k < 5 ? 1 : 2] += pow(bands8[k], 4) }
        return zip(groups, [0.7, 1.05, 1.5]).map { energy, gain in
            let x = sqrt(energy) * gain
            return x <= 0.6 ? x : 0.6 + 0.4 * (1 - exp(-(x - 0.6) / 0.4))
        }
    }
}
