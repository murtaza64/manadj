import SwiftUI
import UIKit
import ManadjCore
import CEngine

/// Drawing owns its display clock, not the 30 Hz observable UI snapshot.
/// Heard-output latency/history parity remains separate, this draws engine-time prediction.
///
/// Android WaveView.kt parity: columns are 2 device pixels wide (1 px in the
/// minimap), band segments batch into one stroked path per quantized style
/// color, and the wave body is not antialiased — the Android painter runs
/// with isAntiAlias = false. Point-wide columns average 2-3x more audio per
/// column on retina screens and read as heavy smoothing.
struct PerformanceWave: UIViewRepresentable {
    @EnvironmentObject var model: AppModel
    let index: Int
    var vertical = false
    var overview = false
    func makeUIView(context: Context) -> PerformanceWaveView { PerformanceWaveView() }
    func updateUIView(_ view: PerformanceWaveView, context: Context) {
        let deck = model.decks[index]
        if view.source != deck.engine.load {
            view.source = deck.engine.load; view.columns.removeAll(); view.preparedColumns.removeAll(); view.waveReady = false
            view.fillGain = deck.waveform?.displayFillGain ?? 1
            view.body = nil
        }
        if !view.waveReady, let wave = deck.waveform { view.fillGain = wave.displayFillGain; view.columns.removeAll(); view.preparedColumns.removeAll(); view.waveReady = true }
        view.wave = deck.waveform
        view.duration = deck.duration
        view.vertical = vertical
        view.overview = overview
        view.index = index
        view.spanSeconds = model.waveSeconds
        view.zoom = { [weak model] seconds in model?.waveSeconds = seconds }
        view.playback = { [weak model] playing in model?.set(playing ? MDJPlay : MDJPause, index, 0) }
        view.state = { [weak model] in model?.audio?.state(index) ?? MDJDeck() }
        view.seek = { [weak model] seconds in model?.set(MDJSeek, index, seconds) }
        view.accessibilityIdentifier = "deck-\(index)-\(overview ? "overview" : "detail")-wave"
        view.accessibilityLabel = "\(Ink.deckName(index)) \(overview ? "minimap seek" : "detail wave")"

        view.setNeedsDisplay()
    }
}

@MainActor final class PerformanceWaveView: UIView {
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
    var preparedColumns: [Int: [(Double, Int)]] = [:]
    var fillGain = 1.0
    var waveReady = false
    /// Android renderOverview: the minimap body depends only on data + size, so
    /// it is prerendered once and only markers draw per frame.
    var body: UIImage?
    private var bodyKey = ""
    private var cachedStep = 0.0
    private var clock = WaveClock()
    private var link: CADisplayLink?
    private var proxy: DisplayProxy?
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
    /// Display scale for column geometry: Android columns are physical pixels.
    private var deviceScale: CGFloat { max(1, window?.screen.scale ?? contentScaleFactor) }
    override func didMoveToWindow() {
        super.didMoveToWindow()
        if let screen = window?.screen { contentScaleFactor = screen.scale }
        link?.invalidate(); link = nil
        if self.window != nil {
            let proxy = DisplayProxy(); proxy.owner = self; self.proxy = proxy
            let link = CADisplayLink(target: proxy, selector: #selector(DisplayProxy.frame(_:)))
            // Android draws at display refresh; prefer ProMotion rates when available.
            link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 120, preferred: 120)
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
        columns.removeAll(); preparedColumns.removeAll(); setNeedsDisplay()
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
        // Android window: one lane of travel scrubs one visible window, pitch-independent.
        let time = overview ? location(gesture.location(in: self)) * duration : panPosition - amount * spanSeconds
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

    /// Android Lines.column: levels drawn largest first; a level at silence
    /// stops the column (lower levels are quieter still).
    private func addSegments(_ paths: inout [Int: CGMutablePath], groups: [Double], at p: CGFloat,
                             across: CGFloat, style: WaveStyle, dim: Double, anchored: Bool) {
        let order = (0..<3).sorted { groups[$0] > groups[$1] }
        for level in 0..<3 {
            let amplitude = groups[order[level]]
            if amplitude <= 0.002 { break }
            var mask = 0
            for m in 0..<3 where groups[m] >= amplitude { mask |= 1 << m }
            var bucket = style.bucket(mask: mask, groups: groups)
            if dim < 1 { bucket = WaveStyle.dimmed(bucket, factor: dim) }
            let path = paths[bucket] ?? CGMutablePath()
            if anchored {
                // Android minimap body is bottom-anchored (left edge when vertical).
                let e = CGFloat(amplitude) * across
                if vertical { path.move(to: CGPoint(x: 0, y: p)); path.addLine(to: CGPoint(x: e, y: p)) }
                else { path.move(to: CGPoint(x: p, y: across)); path.addLine(to: CGPoint(x: p, y: across - e)) }
            } else {
                let half = across / 2
                let size = CGFloat(amplitude) * half
                if vertical { path.move(to: CGPoint(x: half - size, y: p)); path.addLine(to: CGPoint(x: half + size, y: p)) }
                else { path.move(to: CGPoint(x: p, y: half - size)); path.addLine(to: CGPoint(x: p, y: half + size)) }
            }
            paths[bucket] = path
        }
    }

    /// One stroked path per bucketed color, no antialiasing (Android paint).
    private func stroke(_ ctx: CGContext, _ paths: [Int: CGMutablePath], width: CGFloat) {
        ctx.setShouldAntialias(false)
        ctx.setLineWidth(width)
        for (bucket, path) in paths.sorted(by: { $0.key < $1.key }) {
            let c = WaveStyle.components(bucket)
            ctx.setStrokeColor(UIColor(red: c.r, green: c.g, blue: c.b, alpha: 1).cgColor)
            ctx.addPath(path); ctx.strokePath()
        }
        ctx.setShouldAntialias(true)
    }

    /// Android renderOverview: 1 px bottom-anchored columns, minimap style,
    /// master gain only (no display fill), dimmed toward the wave background.
    private func overviewBody(_ wave: PreviewWaveform, size: CGSize, scale: CGFloat) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale; format.opaque = false
        return UIGraphicsImageRenderer(size: size, format: format).image { r in
            let along = vertical ? size.height : size.width
            let across = vertical ? size.width : size.height
            let dur = max(1, duration)
            let count = max(1, Int((along * scale).rounded()))
            var paths: [Int: CGMutablePath] = [:]
            for x in 0..<count {
                let t0 = Double(x) / Double(count) * dur
                let groups = wave.columnGroups(from: t0, to: t0 + dur / Double(count))
                    .map { min(1, $0 * WaveStyle.minimap.master) }
                addSegments(&paths, groups: groups, at: (CGFloat(x) + 0.5) / scale,
                            across: across, style: .minimap, dim: 0.52, anchored: true)
            }
            stroke(r.cgContext, paths, width: 1 / scale)
        }
    }

    override func draw(_ rect: CGRect) {
        guard let ctx = UIGraphicsGetCurrentContext() else { return }
        ctx.setFillColor(UIColor.black.cgColor); ctx.fill(bounds)
        guard duration > 0, let state = state?() else { return }
        let rate = (1 + Double(state.pitch) / 100) * (1 + Double(state.bend) / 100)
        let moving = (state.playing || state.preview) && !scrubbing
        let position = previewPosition ?? clock.at(CACurrentMediaTime(), raw: state.position, moving: moving, rate: rate)
        let scale = deviceScale
        let along = vertical ? bounds.height : bounds.width
        let across = vertical ? bounds.width : bounds.height
        let head = overview ? 0 : vertical ? 0.18 : 0.3
        // Android windowSeconds is fixed: pitching up scrolls faster instead of
        // widening the window (which averaged more audio per column).
        let span = overview ? max(1, duration) : spanSeconds
        let start = overview ? 0 : position - span * head
        func pixel(_ time: Double) -> CGFloat { CGFloat((time - start) / span) * along }
        func line(_ value: CGFloat, color: UIColor, width: CGFloat = 1) {
            guard value >= 0 && value <= along else { return }
            ctx.setStrokeColor(color.cgColor); ctx.setLineWidth(width)
            ctx.move(to: vertical ? CGPoint(x: 0, y: value) : CGPoint(x: value, y: 0))
            ctx.addLine(to: vertical ? CGPoint(x: across, y: value) : CGPoint(x: value, y: across)); ctx.strokePath()
        }
        if let wave, wave.nBands == 8 {
            if overview {
                let key = "\(source)-\(Int(along * scale))x\(Int(across * scale))-\(wave.bands.count)-\(wave.durationSecs)"
                if key != bodyKey || body == nil { bodyKey = key; body = overviewBody(wave, size: bounds.size, scale: scale) }
                body?.draw(in: bounds)
                // Android drawOverview: the played part dims, the lane ahead stays bright.
                let played = min(along, max(0, pixel(min(max(0, position), duration))))
                ctx.setFillColor(UIColor.black.withAlphaComponent(0.5).cgColor)
                ctx.fill(vertical ? CGRect(x: 0, y: 0, width: across, height: played)
                                  : CGRect(x: 0, y: 0, width: played, height: across))
            } else {
                let step = 2 / scale // Android detail columns are 2 physical pixels
                let secondsPerColumn = span / max(1, Double(along)) * Double(step)
                if abs(secondsPerColumn - cachedStep) > 0.000001 { cachedStep = secondsPerColumn; columns.removeAll(); preparedColumns.removeAll() }
                let first = Int(floor(start / secondsPerColumn))
                let count = Int(Double(along) / Double(step)) + 2
                // Whole-device-pixel translation so scrolling never resamples columns.
                let base = ((Double(first) * secondsPerColumn - start) / span * Double(along) * scale).rounded() / scale
                var paths: [Int: CGMutablePath] = [:]
                for i in 0..<count {
                    let k = first + i; let t0 = Double(k) * secondsPerColumn
                    if t0 + secondsPerColumn < 0 || t0 > duration { continue }
                    // Cache amplitude ordering and color math with each source column.
                    // Only translation/path appending belongs on the display clock.
                    let segments: [(Double, Int)]
                    if let cached = preparedColumns[k] { segments = cached }
                    else {
                        let groups = wave.columnGroups(from: t0, to: t0 + secondsPerColumn).map { min(1, $0 * fillGain) }
                        segments = (0..<3).sorted { groups[$0] > groups[$1] }.compactMap { n in
                            guard groups[n] > 0.002 else { return nil }
                            var mask = 0
                            for m in 0..<3 where groups[m] >= groups[n] { mask |= 1 << m }
                            return (groups[n], WaveStyle.full.bucket(mask: mask, groups: groups))
                        }
                        preparedColumns[k] = segments
                    }
                    let p = CGFloat(base + Double(i) * Double(step)), half = across / 2
                    for (amplitude, bucket) in segments {
                        let path = paths[bucket] ?? CGMutablePath(), size = CGFloat(amplitude) * half
                        if vertical { path.move(to: CGPoint(x: half - size, y: p)); path.addLine(to: CGPoint(x: half + size, y: p)) }
                        else { path.move(to: CGPoint(x: p, y: half - size)); path.addLine(to: CGPoint(x: p, y: half + size)) }
                        paths[bucket] = path
                    }
                }
                stroke(ctx, paths, width: step)
                if preparedColumns.count > 24000 { columns.removeAll(keepingCapacity: true); preparedColumns.removeAll(keepingCapacity: true) }
            }
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
}

@MainActor private final class DisplayProxy: NSObject {
    weak var owner: PerformanceWaveView?
    @objc func frame(_ link: CADisplayLink) { owner?.frame(link) }
}
