// Frozen d359c2dc renderer, test-only before/after comparison. Never ships in the app.
import SwiftUI
import UIKit
import ManadjCore
import CEngine
@testable import Manadj

@MainActor final class BaselinePerformanceWaveView: UIView {
    var wave: PreviewWaveform?
    var duration = 0.0
    var source: UInt64 = 0
    var index = 0
    var vertical = false
    var overview = false
    var state: (() -> MDJDeck)?
    var seek: ((Double) -> Void)?
    var zoom: ((Double) -> Void)?
    var playback: ((Bool) -> Void)?
    var columns: [Int: [Double]] = [:]
    var fillGain = 1.0
    var waveReady = false
    private var cachedStep = 0.0
    private var clock = WaveClock()
    private var link: CADisplayLink?
    private var proxy: BaselineDisplayProxy?
    var spanSeconds = 12.0
    private var pinchWindow = 12.0
    private var panPosition = 0.0
    private var scrubbing = false
    private var previewPosition: Double?
    private var resume = false
    private var observedFrames = 0
    private var missedFrames = 0
    private var lastFrame = 0.0
    private lazy var tickHaptic = UISelectionFeedbackGenerator()
    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black; isOpaque = true; clipsToBounds = true
        let pan = UIPanGestureRecognizer(target: self, action: #selector(pan(_:))); pan.maximumNumberOfTouches = 1; addGestureRecognizer(pan)
        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tap(_:))))
        addGestureRecognizer(UIPinchGestureRecognizer(target: self, action: #selector(pinch(_:))))
        isAccessibilityElement = true
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }
    override func didMoveToWindow() {
        super.didMoveToWindow()
        link?.invalidate(); link = nil
        if self.window != nil {
            let proxy = BaselineDisplayProxy(); proxy.owner = self; self.proxy = proxy
            let link = CADisplayLink(target: proxy, selector: #selector(BaselineDisplayProxy.frame(_:)))
            link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 120, preferred: 60)
            link.add(to: .main, forMode: .common); self.link = link
        }
    }
    fileprivate func frame(_ link: CADisplayLink) {
        if lastFrame > 0 && link.timestamp - lastFrame > link.duration * 1.8 { missedFrames += 1 }
        lastFrame = link.timestamp; observedFrames += 1
        if let state = state?(), state.playing || state.preview { setNeedsDisplay() }
        if observedFrames % 600 == 0 { NSLog("manaDJ wave display callbacks=%d longIntervals=%d", observedFrames, missedFrames) }
    }
    @objc private func pinch(_ gesture: UIPinchGestureRecognizer) {
        guard !overview else { return }
        if gesture.state == .began { pinchWindow = spanSeconds }
        spanSeconds = min(48, max(0.75, pinchWindow / Double(gesture.scale)))
        zoom?(spanSeconds)
        columns.removeAll(); setNeedsDisplay()
    }
    private func location(_ point: CGPoint) -> Double {
        let along = vertical ? bounds.height : bounds.width
        return Double((vertical ? point.y : point.x) / max(1, along))
    }
    @objc private func tap(_ gesture: UITapGestureRecognizer) {
        guard overview, duration > 0 else { return }
        seek?(min(duration, max(0, location(gesture.location(in: self)) * duration)))
        tickHaptic.selectionChanged(); setNeedsDisplay()
    }
    @objc private func pan(_ gesture: UIPanGestureRecognizer) {
        guard duration > 0 else { return }
        if gesture.state == .began {
            panPosition = state?().position ?? 0; scrubbing = true; tickHaptic.prepare()
            resume = state?().playing == true
            if !overview && resume { playback?(false) }
        }
        let amount = location(gesture.translation(in: self))
        let tempo = min(4, max(0.25, 1 + Double(state?().pitch ?? 0) / 100))
        let time = overview ? location(gesture.location(in: self)) * duration : panPosition - amount * spanSeconds * tempo
        let target = min(duration, max(0, time))
        if overview { seek?(target) } else { previewPosition = target }
        if gesture.state == .ended || gesture.state == .cancelled {
            if !overview {
                if gesture.state == .ended { seek?(target) }
                if resume { playback?(true) }
            }
            scrubbing = false; previewPosition = nil; tickHaptic.selectionChanged()
        }
        setNeedsDisplay()
    }
    // Accessibility reads live engine state, even if Core Animation has not
    // requested a draw yet. Pausing must not leave a cached "playing" value.
    override var accessibilityValue: String? {
        get {
            guard duration > 0, let state = state?() else { return "not loaded" }
            return String(format: "%@ %.2f seconds", state.playing ? "playing" : "paused", state.position)
        }
        set { }
    }
    override func draw(_ rect: CGRect) {
        guard let ctx = UIGraphicsGetCurrentContext() else { return }
        ctx.setFillColor(UIColor.black.cgColor); ctx.fill(bounds)
        guard duration > 0, let state = state?() else { return }
        let rate = (1 + Double(state.pitch) / 100) * (1 + Double(state.bend) / 100)
        let moving = (state.playing || state.preview) && !scrubbing
        let position = previewPosition ?? clock.at(CACurrentMediaTime(), raw: state.position, moving: moving, rate: rate)
        let along = vertical ? bounds.height : bounds.width
        let across = vertical ? bounds.width : bounds.height
        let head = overview ? 0 : vertical ? 0.18 : 0.3
        let tempo = min(4, max(0.25, 1 + Double(state.pitch) / 100))
        let span = overview ? max(1, duration) : spanSeconds * tempo
        let start = overview ? 0 : position - span * head
        let secondsPerColumn = span / max(1, Double(along)) * 2
        if abs(secondsPerColumn - cachedStep) > 0.000001 { cachedStep = secondsPerColumn; columns.removeAll() }
        func pixel(_ time: Double) -> CGFloat { CGFloat((time - start) / span) * along }
        func line(_ value: CGFloat, color: UIColor, width: CGFloat = 1) {
            guard value >= 0 && value <= along else { return }
            ctx.setStrokeColor(color.cgColor); ctx.setLineWidth(width)
            ctx.move(to: vertical ? CGPoint(x: 0, y: value) : CGPoint(x: value, y: 0))
            ctx.addLine(to: vertical ? CGPoint(x: across, y: value) : CGPoint(x: value, y: across)); ctx.strokePath()
        }
        if let wave, wave.nBands == 8 {
            let first = Int(floor(start / secondsPerColumn))
            let count = Int(along / 2) + 2
            for i in 0..<count {
                let k = first + i; let t0 = Double(k) * secondsPerColumn
                if t0 + secondsPerColumn < 0 || t0 > duration { continue }
                let groups: [Double]
                if let cached = columns[k] { groups = cached }
                else { groups = wave.columnGroups(from: t0, to: t0 + secondsPerColumn).map { min(1, $0 * fillGain) }; columns[k] = groups }
                let p = pixel(t0).rounded(); let half = across / 2
                let order = (0..<3).sorted { groups[$0] > groups[$1] }
                for band in order {
                    let amplitude = groups[band]
                    if amplitude <= 0.002 { continue }
                    let mask = (0..<3).filter { groups[$0] >= amplitude }
                    let color = waveColor(mask, groups: groups, dim: overview ? 0.52 : 1)
                    ctx.setStrokeColor(color.cgColor); ctx.setLineWidth(2)
                    let size = CGFloat(amplitude) * half
                    ctx.move(to: vertical ? CGPoint(x: half - size, y: p) : CGPoint(x: p, y: half - size))
                    ctx.addLine(to: vertical ? CGPoint(x: half + size, y: p) : CGPoint(x: p, y: half + size)); ctx.strokePath()
                }
            }
            if columns.count > 24000 { columns.removeAll(keepingCapacity: true) }
        }
        if !overview && state.bpm > 0 {
            let beat = 60 / state.bpm
            let first = Int(floor((start - state.anchor) / beat))
            let count = min(400, Int(ceil(span / beat)) + 1)
            if count > 0 { for k in first...(first + count) {
                let tier = k % 64 == 0 ? 4 : k % 32 == 0 ? 3 : k % 16 == 0 ? 2 : k % 4 == 0 ? 1 : 0
                line(pixel(state.anchor + Double(k) * beat), color: UIColor.white.withAlphaComponent([0.14, 0.32, 0.45, 0.6, 0.75][tier]), width: [1, 1.5, 2, 2.5, 3][tier])
            } }
        }
        if state.loopActive {
            let a = pixel(state.loopStart), b = pixel(state.loopEnd)
            ctx.setFillColor(UIColor(Ink.decks[index]).withAlphaComponent(0.15).cgColor)
            ctx.fill(vertical ? CGRect(x: 0, y: a, width: across, height: b - a) : CGRect(x: a, y: 0, width: b - a, height: across))
        }
        var cues = state.hotCues
        withUnsafeBytes(of: &cues) { bytes in
            let values = bytes.bindMemory(to: Double.self)
            for slot in 0..<8 where values[slot] >= 0 {
                let p = pixel(values[slot]); let color = UIColor(Ink.cues[slot])
                line(p, color: color, width: overview ? 1.5 : 2)
                guard p >= 0 && p <= along else { continue }
                let box = Self.cueFlagRect(at: p, bounds: bounds, vertical: vertical, overview: overview)
                ctx.setFillColor(color.cgColor); ctx.fill(box)
                // Portrait minimaps follow Android's compact cue pins: numbers
                // at this scale collide and obscure the waveform. Detail lanes
                // keep the pad number, centered with native font metrics.
                if !overview {
                    let text = "\(slot + 1)" as NSString
                    let attributes: [NSAttributedString.Key: Any] = [
                        .font: UIFont.monospacedSystemFont(ofSize: 11, weight: .bold),
                        .foregroundColor: UIColor.black,
                    ]
                    let size = text.size(withAttributes: attributes)
                    text.draw(at: CGPoint(x: box.midX - size.width / 2, y: box.midY - size.height / 2), withAttributes: attributes)
                }
            }
        }
        line(overview ? pixel(position) : CGFloat(head) * along, color: UIColor(Ink.playhead), width: 2)
    }
    /// Keep the cue's stem at its exact time while clamping the flag body
    /// inside the lane, including the last sample and vertical orientation.
    static func cueFlagRect(at position: CGFloat, bounds: CGRect, vertical: Bool, overview: Bool) -> CGRect {
        let size = min(overview ? 5 : 14, min(bounds.width, bounds.height))
        let along = vertical ? bounds.height : bounds.width
        let origin = min(max(0, position), max(0, along - size))
        return vertical ? CGRect(x: 0, y: origin, width: size, height: size)
            : CGRect(x: origin, y: 0, width: size, height: size)
    }

    private func waveColor(_ mask: [Int], groups: [Double], dim: Double) -> UIColor {
        let colors = [[0.7804, 0.0588, 0.0588], [0.2353, 0.6863, 0.0706], [0.0588, 0.5922, 1.0]]
        var rgb = [0.0, 0, 0]
        for i in mask { for c in 0..<3 { rgb[c] += colors[i][c] } }
        let over = min(1, max(0, (rgb.max() ?? 0) - 1))
        rgb = rgb.map { min(1, $0) }
        if over > 0 {
            let weights = groups.map { ($0 * $0 * 8).rounded() / 8 }
            let total = weights.reduce(0, +) + 0.000001
            var hue = [0.0, 0, 0]
            for c in 0..<3 { for i in 0..<3 { hue[c] += weights[i] * colors[i][c] / total } }
            let maximum = (hue.max() ?? 1) + 0.000001
            let white = min(1, 0.32 + 0.3 * over)
            let t0 = min(1, over / 0.5); let t = t0 * t0 * (3 - 2 * t0)
            for c in 0..<3 { let h = hue[c] / maximum; let mixed = h + (1 - h) * white; rgb[c] += (mixed - rgb[c]) * t }
        }
        return UIColor(red: rgb[0] * dim, green: rgb[1] * dim, blue: rgb[2] * dim, alpha: 1)
    }
}

@MainActor private final class BaselineDisplayProxy: NSObject {
    weak var owner: BaselinePerformanceWaveView?
    @objc func frame(_ link: CADisplayLink) { owner?.frame(link) }
}
