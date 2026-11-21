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
            view.body = nil; view.seekHold = nil
        }
        if !view.waveReady, let wave = deck.waveform { view.fillGain = wave.displayFillGain; view.columns.removeAll(); view.preparedColumns.removeAll(); view.waveReady = true }
        view.wave = deck.waveform
        view.duration = deck.duration
        view.vertical = vertical
        view.overview = overview
        view.index = index
        view.lockWhilePlaying = model.waveTouchLock
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
    // Source-space raster tiles move at the display clock. Amplitude reduction,
    // color math and path building run only for newly exposed tiles.
    private var detailTiles: [Int: UIImage] = [:]
    private var detailTileKey = ""
    private let tileColumns = 64
    private let tileLimit = 96
    var cachedDetailTileCount: Int { detailTiles.count }
    func invalidateDetailTiles() { detailTiles.removeAll(); detailTileKey = "" }
    private var clock = WaveClock()
    /// Android Minimap seek hold (WaveView.kt:333-339): after the finger lifts, keep
    /// rendering the drop point until the engine reports the seek. Without this the
    /// clock falls back to the pre-gesture engine position for a few frames, so the
    /// wave visibly jumps back, then snaps forward again.
    fileprivate var seekHold: (target: Double, until: CFTimeInterval, transport: UInt64)?
    func beginSeekHold(_ target: Double) {
        seekHold = (target, CACurrentMediaTime() + 0.4, state?().transport ?? 0)
        // Paused decks get no display-link redraws; repaint once after the deadline.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { [weak self] in self?.setNeedsDisplay() }
    }
    private func heldPosition(raw: Double, transport: UInt64) -> Double? {
        guard let hold = seekHold else { return nil }
        if transport != hold.transport || abs(raw - hold.target) <= 0.15 || CACurrentMediaTime() > hold.until {
            seekHold = nil
            return nil
        }
        return hold.target
    }
    #if DEBUG
    private let measureBody = ProcessInfo.processInfo.arguments.contains("--wave-body-metrics")
    private var bodySamples: [Double] = []
    private var bodyWarmup = 0
    private var bodyMetrics = ""
    private let measurePacing = ProcessInfo.processInfo.arguments.contains("--wave-pacing-metrics")
    private var callbackIntervals: [Double] = []
    private var drawIntervals: [Double] = []
    private var callbackCursor = 0, drawCursor = 0
    private var lastCallbackArrival = 0.0, lastDrawArrival = 0.0
    private var expectedInterval = 1.0 / 60
    private func recordInterval(_ samples: inout [Double], cursor: inout Int, value: Double) {
        guard value > 0 else { return }
        if samples.count < 600 { samples.append(value * 1000) }
        else { samples[cursor] = value * 1000; cursor = (cursor + 1) % 600 }
    }
    private func pacingSummary(_ samples: [Double], kind: String) -> String {
        guard !samples.isEmpty else { return " " + kind + "Samples=0" }
        let sorted = samples.sorted(), count = sorted.count
        let late = samples.filter { $0 > expectedInterval * 1500 }.count
        return String(format: " %@Samples=%d meanMS=%.2f p95MS=%.2f p99MS=%.2f maxMS=%.2f latePct=%.1f", kind, count, samples.reduce(0,+) / Double(count), sorted[min(count-1, Int(Double(count)*0.95))], sorted[min(count-1, Int(Double(count)*0.99))], sorted[count-1], Double(late)*100/Double(count))
    }
    private var pacingMetrics: String {
        guard measurePacing else { return "" }
        return String(format: " expectedIntervalMS=%.2f", expectedInterval*1000) + pacingSummary(callbackIntervals, kind: "callback") + pacingSummary(drawIntervals, kind: "draw") + " presentationNotMeasured=true rollingWindowMax=600"
    }
    #endif
    private var metalBody: MetalWaveBody?
    private var metalOverlay: MetalWaveOverlay?
    private var triedMetal = false
    private var metalPrototype: Bool { ProcessInfo.processInfo.arguments.contains("--metal-waveform-prototype") && !overview }
    override func layoutSubviews() {
        super.layoutSubviews()
        metalBody?.frame = bounds; metalOverlay?.frame = bounds
    }
    private var link: CADisplayLink?
    private var proxy: DisplayProxy?
    var lockWhilePlaying = false
    private var blockedPan = false
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
        #if DEBUG
        if measurePacing && !overview, let state = state?(), state.playing || state.preview {
            let now = CACurrentMediaTime()
            expectedInterval = max(0.001, link.targetTimestamp - link.timestamp)
            if lastCallbackArrival > 0 { recordInterval(&callbackIntervals, cursor: &callbackCursor, value: now - lastCallbackArrival) }
            lastCallbackArrival = now
        } else { lastCallbackArrival = 0; lastDrawArrival = 0 }
        #endif
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
        let target = min(duration, max(0, location(gesture.location(in: self)) * duration))
        beginSeekHold(target); seek?(target)
        tickHaptic.selectionChanged(); setNeedsDisplay()
    }
    @objc private func pan(_ gesture: UIPanGestureRecognizer) {
        guard duration > 0 else { return }
        if gesture.state == .began {
            blockedPan = !overview && lockWhilePlaying && state?().playing == true
        }
        if blockedPan {
            if gesture.state == .ended || gesture.state == .cancelled || gesture.state == .failed { blockedPan = false }
            return
        }
        if gesture.state == .began {
            panPosition = state?().position ?? 0; scrubbing = true; tickHaptic.prepare()
            resume = state?().playing == true
            if !overview && resume { playback?(false) }
        }
        let amount = location(gesture.translation(in: self))
        // Android window: one lane of travel scrubs one visible window, pitch-independent.
        let time = overview ? location(gesture.location(in: self)) * duration : panPosition - amount * spanSeconds
        let target = min(duration, max(0, time))
        if overview { beginSeekHold(target); seek?(target); previewPosition = target } else { previewPosition = target }
        if gesture.state == .ended || gesture.state == .cancelled {
            if !overview {
                if gesture.state == .ended { beginSeekHold(target); seek?(target) }
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
            let transport = String(format: "%@ %.2f seconds", state.playing ? "playing" : "paused", state.position)
            #if DEBUG
            return transport + bodyMetrics + pacingMetrics
            #else
            return transport
            #endif
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
            bucket |= level << 15 // Keep outer-to-inner nesting, as Android Lines does.
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

    private func drawDetailTiles(_ wave: PreviewWaveform, context: CGContext,
                                 along: CGFloat, across: CGFloat, scale: CGFloat,
                                 start: Double, span: Double) {
        let step = 2 / scale // Android detail columns are two physical pixels.
        let seconds = span / max(1, Double(along)) * Double(step)
        let key = "\(source)-\(wave.bands.count)-\(wave.durationSecs)-\(duration)-\(seconds)-\(across)-\(scale)-\(vertical)-\(fillGain)"
        if detailTileKey != key { detailTileKey = key; detailTiles.removeAll() }
        let firstColumn = Int(floor(start / seconds))
        let lastColumn = Int(ceil((start + span) / seconds))
        let firstTile = Int(floor(Double(max(0, firstColumn)) / Double(tileColumns)))
        let lastTile = Int(floor(Double(min(Int(ceil(duration / seconds)), lastColumn)) / Double(tileColumns)))
        guard firstTile <= lastTile else { return }
        context.saveGState(); context.interpolationQuality = .none
        defer { context.restoreGState() }
        // Keep the most recent visible neighborhood. No unbounded song cache.
        if detailTiles.count + lastTile - firstTile + 1 > tileLimit {
            detailTiles = detailTiles.filter { abs($0.key - firstTile) < tileLimit / 2 }
        }
        for tile in firstTile...lastTile {
            let image: UIImage
            if let cached = detailTiles[tile] { image = cached }
            else {
                let size = vertical ? CGSize(width: across, height: CGFloat(tileColumns) * step)
                                    : CGSize(width: CGFloat(tileColumns) * step, height: across)
                let format = UIGraphicsImageRendererFormat(); format.scale = scale; format.opaque = false
                image = UIGraphicsImageRenderer(size: size, format: format).image { renderer in
                    var levels = [[Int: CGMutablePath]](repeating: [:], count: 3)
                    for offset in 0..<tileColumns {
                        let column = tile * tileColumns + offset
                        let time = Double(column) * seconds
                        guard time <= duration else { continue }
                        let groups = wave.columnGroups(from: time, to: time + seconds).map { min(1, $0 * fillGain) }
                        let order = (0..<3).sorted { groups[$0] > groups[$1] }
                        let p = (CGFloat(offset) + 0.5) * step
                        for level in 0..<3 {
                            let amplitude = groups[order[level]]
                            if amplitude <= 0.002 { break }
                            var mask = 0
                            for m in 0..<3 where groups[m] >= amplitude { mask |= 1 << m }
                            let bucket = WaveStyle.full.bucket(mask: mask, groups: groups)
                            let path = levels[level][bucket] ?? CGMutablePath()
                            let half = across / 2, extent = CGFloat(amplitude) * half
                            if vertical { path.move(to: CGPoint(x: half - extent, y: p)); path.addLine(to: CGPoint(x: half + extent, y: p)) }
                            else { path.move(to: CGPoint(x: p, y: half - extent)); path.addLine(to: CGPoint(x: p, y: half + extent)) }
                            levels[level][bucket] = path
                        }
                    }
                    // Android Lines batches within nesting level, never across
                    // levels: inner colors must paint after their outer bands.
                    for paths in levels { stroke(renderer.cgContext, paths, width: step) }
                }
                detailTiles[tile] = image
            }
            // Tile origins are whole device pixels. Adjacent tiles meet exactly
            // and never interpolate at seams, including negative window starts.
            let origin = ((Double(tile * tileColumns) * seconds - start) / span * Double(along) * Double(scale)).rounded() / Double(scale) - Double(step / 2)
            image.draw(at: vertical ? CGPoint(x: 0, y: origin) : CGPoint(x: origin, y: 0))
        }
    }

    override func draw(_ rect: CGRect) {
        if metalPrototype && wave != nil {
            if !triedMetal {
                triedMetal = true
                if let gpu = MetalWaveBody(experimentFrame: bounds) {
                    metalBody = gpu; addSubview(gpu)
                    let overlay = MetalWaveOverlay(frame: bounds); overlay.owner = self
                    overlay.isOpaque = false; overlay.backgroundColor = .clear; overlay.isUserInteractionEnabled = false
                    metalOverlay = overlay; addSubview(overlay)
                    accessibilityHint = "Metal waveform experiment"
                } else { accessibilityHint = "Core Graphics fallback: Metal unavailable" }
            }
            if let overlay = metalOverlay { overlay.setNeedsDisplay(); return }
        }
        metalBody?.isHidden = true; metalOverlay?.isHidden = true
        drawContent(rect, cpuWave: true)
    }
    fileprivate func drawContent(_ rect: CGRect, cpuWave: Bool) {
        #if DEBUG
        if measurePacing && !overview, let state = state?(), state.playing || state.preview {
            let now = CACurrentMediaTime()
            if lastDrawArrival > 0 { recordInterval(&drawIntervals, cursor: &drawCursor, value: now - lastDrawArrival) }
            lastDrawArrival = now
        }
        let began = measureBody ? ProcessInfo.processInfo.systemUptime : 0
        defer {
            if measureBody && !overview && wave != nil {
                bodyWarmup += 1
                if bodyWarmup > 30 && bodySamples.count < 120 {
                    bodySamples.append((ProcessInfo.processInfo.systemUptime - began) * 1000)
                    if bodySamples.count == 120 {
                        let sorted = bodySamples.sorted(), mean = bodySamples.reduce(0, +) / 120
                        bodyMetrics = String(format: " waveBodySamples=120 renderer=%@ cpuMeanMS=%.3f cpuP95MS=%.3f cpuMaxMS=%.3f", cpuWave ? "coregraphics" : "metal", mean, sorted[113], sorted[119])
                        print("SYNTHETIC_LIVE_WAVE_BODY" + bodyMetrics + " includesCueOverlay=true excludesGPUCompletionAndComposition=true simulatorNotPhone=true")
                    }
                }
            }
        }
        #endif
        guard let ctx = UIGraphicsGetCurrentContext() else { return }
        if cpuWave { ctx.setFillColor(UIColor.black.cgColor); ctx.fill(bounds) }
        else { ctx.clear(bounds) }
        guard duration > 0, let state = state?() else { return }
        let rate = (1 + Double(state.pitch) / 100) * (1 + Double(state.bend) / 100)
        let moving = (state.playing || state.preview) && !scrubbing
        let position = previewPosition ?? heldPosition(raw: state.position, transport: state.transport)
            ?? clock.at(CACurrentMediaTime(), raw: state.position, moving: moving, rate: rate, transport: state.transport)
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
        if !cpuWave, let wave {
            metalBody?.isHidden = false; metalOverlay?.isHidden = false
            metalBody?.render(wave: wave, source: source, start: start, span: span, gain: fillGain, vertical: vertical)
        }
        if cpuWave, let wave, wave.nBands == 8 {
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
                drawDetailTiles(wave, context: ctx, along: along, across: across,
                                scale: scale, start: start, span: span)
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

@MainActor private final class MetalWaveOverlay: UIView {
    weak var owner: PerformanceWaveView?
    override func draw(_ rect: CGRect) { owner?.drawContent(rect, cpuWave: false) }
}
