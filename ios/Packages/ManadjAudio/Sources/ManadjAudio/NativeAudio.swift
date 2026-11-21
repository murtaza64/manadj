#if canImport(AVFoundation) && os(iOS)
import AVFoundation
import CEngine
import Foundation

/// Owned by callback and workers. Destruction happens only after both have released it.
final class EngineHandle: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false
    var isCancelled: Bool { lock.withLock { cancelled } }
    func cancel() { lock.withLock { cancelled = true } }
    let raw: MDJEngine
    init() throws {
        guard let raw = mdj_create(48_000) else { throw AudioFailure("Could not allocate the audio engine") }
        self.raw = raw
    }
    deinit { mdj_destroy(raw) }
}

private final class RenderContext: @unchecked Sendable {
    let engine: EngineHandle
    let scratch = UnsafeMutablePointer<Float>.allocate(capacity: 2048)
    init(_ engine: EngineHandle) { self.engine = engine; scratch.initialize(repeating: 0, count: 2048) }
    deinit { scratch.deinitialize(count: 2048); scratch.deallocate() }
    func render(_ count: AVAudioFrameCount, _ data: UnsafeMutablePointer<AudioBufferList>) -> OSStatus {
        let buffers = UnsafeMutableAudioBufferListPointer(data)
        var offset = 0
        while offset < Int(count) {
            let n = min(1024, Int(count) - offset)
            mdj_render(engine.raw, scratch, Int32(n), 2)
            for channel in 0..<buffers.count {
                guard let bytes = buffers[channel].mData else { continue }
                let out = bytes.assumingMemoryBound(to: Float.self)
                for i in 0..<n { out[offset + i] = channel < 2 ? scratch[i * 2 + channel] : 0 }
            }
            offset += n
        }
        return noErr
    }
}

// Construct outside NativeAudio's MainActor context. AVAudioSourceNode invokes this
// on the real-time audio thread; inheriting MainActor isolation traps in Swift 6.
private func makeSourceNode(context: RenderContext, format: AVAudioFormat) -> AVAudioSourceNode {
    AVAudioSourceNode(format: format) { _, _, count, output in context.render(count, output) }
}

public struct AudioFailure: Error, LocalizedError, Sendable {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

/// Control is main-actor isolated. The callback calls only the C++ renderer and bounded copies.
/// Each deck has one serial decode worker, matching the shared engine's ownership contract.
private final class NotificationTokens: @unchecked Sendable {
    var values: [NSObjectProtocol] = []
    deinit { for token in values { NotificationCenter.default.removeObserver(token) } }
}

@MainActor public final class NativeAudio {
    private let handle: EngineHandle
    private let graph = AVAudioEngine()
    private let node: AVAudioSourceNode
    private var sequence: UInt64 = 0
    private let workers = (0..<4).map { DispatchQueue(label: "dev.manadj.decode.\($0)", qos: .userInitiated) }
    private let observers = NotificationTokens()
    private var requiresRebuild = false
    public private(set) var running = false
    public var onInterruption: ((String) -> Void)?

    public init() throws {
        let engine = try EngineHandle()
        handle = engine
        let context = RenderContext(engine)
        let format = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 2)!
        node = makeSourceNode(context: context, format: format)
        graph.attach(node)
        graph.connect(node, to: graph.mainMixerNode, format: format)
        let center = NotificationCenter.default
        for name in [AVAudioSession.interruptionNotification, AVAudioSession.routeChangeNotification, AVAudioSession.mediaServicesWereResetNotification] {
            observers.values.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] note in
                // Never resume automatically after headphone disconnect or an interruption.
                if note.name == AVAudioSession.routeChangeNotification {
                    let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
                    if raw == AVAudioSession.RouteChangeReason.categoryChange.rawValue { return }
                }
                if note.name == AVAudioSession.interruptionNotification {
                    let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
                    if raw != AVAudioSession.InterruptionType.began.rawValue { return }
                }
                let reset = note.name == AVAudioSession.mediaServicesWereResetNotification
                let title = reset ? "Audio services reset. Close and reopen manaDJ before resuming." : note.name == AVAudioSession.routeChangeNotification ? "Audio route changed. Press play to resume." : "Audio interrupted. Press play to resume."
                Task { @MainActor [weak self] in
                    if reset { self?.requiresRebuild = true }
                    self?.interrupt(title)
                }
            })
        }
    }
    deinit { handle.cancel() }

    public func start() throws {
        guard !requiresRebuild else { throw AudioFailure("Audio services reset. Close and reopen manaDJ before resuming.") }
        guard !running else { return }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .default, options: [])
        try session.setPreferredSampleRate(48_000)
        try session.setPreferredIOBufferDuration(0.005)
        try session.setActive(true)
        // Source has a fixed 48 kHz format. AVAudioEngine converts to the current device rate.
        graph.prepare()
        try graph.start()
        running = true
        send(MDJHeardLatency, value: session.outputLatency + session.ioBufferDuration)
    }
    private func interrupt(_ reason: String) {
        for deck in 0..<4 { send(MDJPause, deck: deck); send(MDJBend, deck: deck, value: 0); send(MDJCueUp, deck: deck); for slot in 0..<8 { send(MDJHotCueUp, deck: deck, slot: slot) } }
        // Output stops immediately. Queued pauses apply at restart, before samples.
        graph.stop(); running = false
        mdj_record_stop(handle.raw, true)
        onInterruption?(reason)
    }
    @discardableResult public func send(_ op: MDJOp, deck: Int = 0, value: Double = 0, slot: Int = 0) -> Bool {
        mdj_submit(handle.raw, op, Int32(deck), value, Int32(slot)) != 0
    }
    public func state(_ deck: Int) -> MDJDeck { mdj_deck(handle.raw, Int32(deck)) }
    public func grid(_ deck: Int, bpm: Double, anchor: Double) { _ = mdj_grid(handle.raw, Int32(deck), bpm, anchor) }
    public func filter(_ deck: Int, position: Double) { _ = mdj_filter(handle.raw, Int32(deck), position) }
    public func splitOutput(_ on: Bool) { mdj_routing(handle.raw, on) }
    public func beatFX(effect: Int, target: Int, on: Bool, depth: Double, beats: Double) { _ = mdj_fx(handle.raw, Int32(effect), Int32(target), on, depth, beats) }
    public var recordingState: Int { Int(mdj_record_state(handle.raw)) }
    public var recordingError: Int { Int(mdj_record_error(handle.raw)) }
    public func record(to url: URL) throws {
        try start()
        guard url.isFileURL, mdj_record_start(handle.raw, url.path) else { throw AudioFailure("Could not start master recording") }
    }
    public func stopRecording() { mdj_record_stop(handle.raw, false) }

    public func load(_ url: URL, deck: Int) async throws -> Double {
        guard (0..<4).contains(deck) else { throw AudioFailure("Invalid deck") }
        try start()
        sequence += 1
        let load = sequence, engine = handle
        guard mdj_prepare(engine.raw, Int32(deck), load) != 0 else { throw AudioFailure("Audio command queue is full") }
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Double, Error>) in
            workers[deck].async {
                var pending: CheckedContinuation<Double, Error>? = continuation
                do { try FileDecoder.run(url: url, deck: deck, load: load, engine: engine, pending: &pending) }
                catch {
                    mdj_fail(engine.raw, Int32(deck), load)
                    pending?.resume(throwing: error)
                }
            }
        }
    }
}
#endif
