import SwiftUI
import AVFoundation
import Speech
import ManadjCore
import ManadjAudio

/// One live feedback session. Opening the toolbar never captures or freezes the app.
@MainActor final class LiveFeedbackSession: NSObject, ObservableObject {
    @Published var active = false
    @Published var sending = false
    @Published var deliveryStatus: String?
    @Published var reportGeneration = UUID()
    func receivedReport() {
        stopVoice(transcribe: false); recognition?.cancel(); recognition = nil
        if let voiceURL { try? FileManager.default.removeItem(at: voiceURL) }
        voiceURL = nil; voiceStartedAt = nil; voiceEndedAt = nil
        transcript = ""; strokes = []; selectedPoint = nil; selectedTarget = nil
        mode = "USE APP"; startedAt = Date(); reportGeneration = UUID()
    }

    @Published var contextual = "FX"
    @Published var mode = "USE APP"
    @Published var recording = false
    @Published var requestingMicrophone = false
    private var generation = UUID()
    private var voiceDurationMs = 0
    @Published var transcript = ""
    @Published var message: String?
    @Published var reviewing = false
    @Published var voiceURL: URL?
    @Published var seconds = 0
    @Published var voiceStartedAt: Date?
    @Published var voiceEndedAt: Date?
    @Published var strokes: [FeedbackStroke] = []
    @Published var selectedPoint: CGPoint?
    @Published var selectedTarget: String?
    var startedAt = Date()
    private var recorder: AVAudioRecorder?
    private weak var audio: NativeAudio?
    private var timer: Task<Void, Never>?
    private var recognition: SFSpeechRecognitionTask?
    private var previousCategory: AVAudioSession.Category?
    private var previousOptions: AVAudioSession.CategoryOptions = []
    func open() { guard !active else { contextual = "FEEDBACK"; return }; contextual = "FEEDBACK"; active = true; mode = "USE APP"; startedAt = Date(); message = nil }
    func close() { guard !sending else { return }; deliveryStatus = nil; generation = UUID(); requestingMicrophone = false; stopVoice(transcribe: false); recognition?.cancel(); recognition = nil; active = false; contextual = "FX"; reviewing = false; mode = "USE APP"; transcript = ""; strokes = []; selectedPoint = nil; selectedTarget = nil; if let voiceURL { try? FileManager.default.removeItem(at: voiceURL) }; voiceURL = nil }
    func startVoice(directory: URL, audio: NativeAudio?) async {
        guard active, !recording, !requestingMicrophone else { return }
        requestingMicrophone = true
        generation = UUID(); let token = generation
        let allowed = await AVAudioApplication.requestRecordPermission()
        guard generation == token, active else { return }
        requestingMicrophone = false
        guard allowed else { message = "Microphone access is off. Enable it in iOS Settings, or add text at review."; return }
        recognition?.cancel(); recognition = nil
        do {
            self.audio = audio; audio?.feedbackNarration = true
            let session = AVAudioSession.sharedInstance()
            previousCategory = session.category; previousOptions = session.categoryOptions
            let speaker = session.currentRoute.outputs.contains { $0.portType == .builtInSpeaker }
            var options: AVAudioSession.CategoryOptions = [.mixWithOthers, .allowBluetoothA2DP]
            if speaker { options.insert(.defaultToSpeaker) }
            try session.setCategory(.playAndRecord, mode: .default, options: options)
            try session.setActive(true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let oldVoice = voiceURL
            let url = directory.appendingPathComponent("narration-" + UUID().uuidString + ".m4a")
            let recorder = try AVAudioRecorder(url: url, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 24000, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 64000])
            guard recorder.record(forDuration: 120) else { throw CocoaError(.fileWriteUnknown) }
            if let oldVoice { try? FileManager.default.removeItem(at: oldVoice) }
            self.recorder = recorder; voiceURL = url; voiceStartedAt = Date(); voiceEndedAt = nil; seconds = 0; recording = true; transcript = ""; message = nil; mode = "USE APP"
            timer = Task { @MainActor [weak self] in
                for i in 1...120 { try? await Task.sleep(for: .seconds(1)); guard !Task.isCancelled else { return }; self?.seconds = i }
                self?.stopVoice()
            }
        } catch { message = "Voice did not start: " + error.localizedDescription; restorePlaybackSession() }
    }
    private func restorePlaybackSession() {
        audio?.feedbackNarration = false; audio = nil
        if let category = previousCategory { do { try AVAudioSession.sharedInstance().setCategory(category, mode: .default, options: previousOptions) } catch { message = "Stopped recording; audio session could not be restored: " + error.localizedDescription } }
        previousCategory = nil
    }
    func reviewedVoice() -> FeedbackVoice? {
        guard !recording, let voiceURL, let start = voiceStartedAt, let end = voiceEndedAt,
              let data = try? Data(contentsOf: voiceURL), data.count <= FeedbackLimits.voiceBytes else { return nil }
        return FeedbackVoice(format: "m4a", dataURL: "data:audio/mp4;base64," + data.base64EncodedString(), durationMs: voiceDurationMs, startedAt: start, endedAt: end, transcript: transcript.isEmpty ? nil : transcript)
    }
    func stopVoice(transcribe: Bool = true) {
        timer?.cancel(); timer = nil
        guard recorder != nil else { return }
        voiceDurationMs = min(FeedbackLimits.voiceDurationMs, max(1, Int((recorder?.currentTime ?? 0) * 1000)))
        recorder?.stop(); recorder = nil; voiceEndedAt = Date(); recording = false; restorePlaybackSession()
        if transcribe, let voiceURL { Task { await transcribeLocal(voiceURL) } }
    }
    private func transcribeLocal(_ url: URL) async {
        let token = generation
        let status = await withCheckedContinuation { continuation in SFSpeechRecognizer.requestAuthorization { @Sendable status in continuation.resume(returning: status) } }
        guard generation == token, voiceURL == url, active, !recording else { return }
        guard status == .authorized, let recognizer = SFSpeechRecognizer(), recognizer.supportsOnDeviceRecognition else {
            message = "Voice is saved locally. On-device transcription is unavailable; add text at review. No voice was sent to a speech service."; return
        }
        let request = SFSpeechURLRecognitionRequest(url: url); request.requiresOnDeviceRecognition = true
        recognition = recognizer.recognitionTask(with: request) { @Sendable [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let failure = error?.localizedDescription
            Task { @MainActor in
                guard let self, self.generation == token, self.voiceURL == url, self.active, !self.recording else { return }
                if let text { self.transcript = text }
                if let failure { self.message = "Voice stays local. Transcription failed: " + failure }
            }
        }
    }
}

struct LiveFeedbackToolbar: View {
    @ObservedObject var session: LiveFeedbackSession
    @ObservedObject var model: AppModel
    var body: some View {
        VStack(spacing: 3) {
            HStack(spacing: 4) {
                Text(session.recording ? "● \(session.seconds)s / 120" : "FEEDBACK").foregroundStyle(session.recording ? Ink.danger : Ink.accent).font(Ink.font(9, bold: true))
                Spacer(minLength: 0)
                Button("×") { session.close() }.disabled(session.sending).font(Ink.font(18)).accessibilityLabel("Close feedback toolbar")
            }
            HStack(spacing: 3) {
                Button(session.recording ? "STOP" : session.requestingMicrophone ? "MIC…" : "REC") {
                    if session.recording { model.noteFeedbackAction("feedback-voice-stop"); session.stopVoice() }
                    else { Task { await session.startVoice(directory: model.feedbackQueueRoot.appendingPathComponent("voice-drafts"), audio: model.audio); if session.recording { model.noteFeedbackAction("feedback-voice-start") } } }
                }.buttonStyle(PerformanceKeyStyle(color: Ink.danger, active: session.recording)).disabled(session.requestingMicrophone || session.sending).accessibilityIdentifier("feedback-rec")
                Button("REVIEW") { session.stopVoice(); session.mode = "USE APP"; session.reviewing = true }.buttonStyle(PerformanceKeyStyle(color: Ink.play)).accessibilityIdentifier("feedback-review-open")
            }.frame(height: 44).disabled(session.sending)
            if session.sending {
                HStack { ProgressView().controlSize(.small); Text("SENDING TO DESKTOP…").font(Ink.font(9)) }.accessibilityElement(children: .contain).accessibilityIdentifier("feedback-center-sending")
            } else if let status = session.deliveryStatus {
                Text(status).font(Ink.font(9)).foregroundStyle(Ink.warning).accessibilityIdentifier("feedback-center-delivery")
            }
            HStack(spacing: 2) {
                ForEach(["USE APP", "POINT", "DRAW"], id: \.self) { mode in Button(mode) { session.mode = mode }.buttonStyle(PerformanceKeyStyle(color: Ink.accent, active: session.mode == mode)) }
            }.frame(height: 28)
            if let message = session.message { Text(message).font(Ink.font(8)).foregroundStyle(Ink.warning).lineLimit(3) }
        }.padding(3).background(Ink.accent.opacity(0.06)).overlay(RoundedRectangle(cornerRadius: 8).stroke(Ink.accent.opacity(0.5)))
            .accessibilityElement(children: .contain).accessibilityIdentifier("feedback-live-toolbar")
    }
}

struct FeedbackReporter: ViewModifier {
    @ObservedObject var model: AppModel
    @ObservedObject var session: LiveFeedbackSession
    let browsing: Bool
    let settings: Bool
    let autoPresent: Bool
    @Binding var requested: Bool
    let targets: [FeedbackTarget]
    @State private var detector = ShakeDetector()
    @State private var capture: FeedbackCapture?
    @State private var capturedTargets: [FeedbackTarget] = []
    @State private var capturedVoice: FeedbackVoice?
    @State private var capturedVoiceURL: URL?
    @State private var capturedTranscript = ""
    func body(content: Content) -> some View {
        content
            .overlay {
                if session.active && !session.reviewing && session.mode != "USE APP" {
                    FeedbackLiveInk(session: session, targets: targets).ignoresSafeArea()
                }
                if let capture {
                    FeedbackReviewView(capture: capture, targets: capturedTargets, onSubmit: { draft in
                        session.reviewing = false; session.sending = true; session.deliveryStatus = nil
                        let result: FeedbackOutcome
                        #if DEBUG
                        if ProcessInfo.processInfo.arguments.contains("--feedback-receipt-ui-fixture") {
                            // Deterministic receipt-state UI only. No network or filing.
                            try? await Task.sleep(for: .seconds(5))
                            result = .savedOnDesktop(status: "synthetic-ui-receipt", detail: "UI test only, no report sent")
                        } else {
                            result = await FeedbackSubmitter(queue: FeedbackQueue(directory: model.feedbackQueueRoot)).submit(draft, via: model.syncConnection)
                        }
                        #else
                        result = await FeedbackSubmitter(queue: FeedbackQueue(directory: model.feedbackQueueRoot)).submit(draft, via: model.syncConnection)
                        #endif
                        session.sending = false
                        switch result {
                        case .filed:
                            session.deliveryStatus = "RECEIVED · Ready for new feedback"; session.receivedReport()
                        case .savedOnDesktop:
                            session.deliveryStatus = "RECEIVED ON DESKTOP · GitHub pending"; session.receivedReport()
                        case .queuedLocally:
                            session.deliveryStatus = "ON IPHONE ONLY · Review saved report"
                        case .rejected, .saveFailed:
                            session.deliveryStatus = "NOT RECEIVED · Review report to retry"
                        }
                        return result
                    }, queueDirectory: model.feedbackQueueRoot, queueConnection: model.syncConnection, voice: capturedVoice, voiceURL: capturedVoiceURL, initialComment: capturedTranscript, initialStrokes: session.strokes, initialPoint: session.selectedPoint, initialTarget: session.selectedTarget, onClose: { session.reviewing = false; self.capture = nil })
                        .opacity(session.reviewing ? 1 : 0).allowsHitTesting(session.reviewing).accessibilityHidden(!session.reviewing)
                }
            }
            .onChange(of: requested) { _, value in if value { requested = false; session.open() } }
            .onChange(of: session.reviewing) { _, value in
                if value && capture == nil {
                    capturedTargets = targets
                    capturedVoice = session.reviewedVoice(); capturedVoiceURL = session.voiceURL
                    capturedTranscript = session.transcript
                    capture = FeedbackCapture.capture(model: model, browsing: browsing, settings: settings)
                }
            }
            .onChange(of: session.reportGeneration) { _, _ in capture = nil; capturedVoice = nil; capturedVoiceURL = nil; capturedTranscript = "" }
            .onChange(of: session.active) { _, value in if !value { capture = nil } }
            .onAppear {
                detector.onShake = { session.open() }; detector.start()
                if autoPresent { session.open(); Task { @MainActor in try? await Task.sleep(for: .milliseconds(700)); session.reviewing = true } }
            }
            .onDisappear { detector.stop(); session.stopVoice() }
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)) { _ in session.stopVoice() }
    }
}
extension View {
    func feedbackReporter(model: AppModel, session: LiveFeedbackSession, browsing: Bool, settings: Bool, requested: Binding<Bool>, targets: [FeedbackTarget], autoPresent: Bool = false) -> some View {
        modifier(FeedbackReporter(model: model, session: session, browsing: browsing, settings: settings, autoPresent: autoPresent, requested: requested, targets: targets))
    }
}

private struct FeedbackLiveInk: View {
    @ObservedObject var session: LiveFeedbackSession
    let targets: [FeedbackTarget]
    @State private var current: [CGPoint] = []
    var body: some View {
        GeometryReader { geometry in
            Canvas { context, size in
                for line in session.strokes + [FeedbackStroke(points: current)] where line.points.count > 1 {
                    var p = Path(); p.addLines(line.points.map { CGPoint(x: $0.x * size.width, y: $0.y * size.height) })
                    context.stroke(p, with: .color(Ink.warning), style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
                }
            }.contentShape(Rectangle()).gesture(DragGesture(minimumDistance: 0).onChanged { v in
                if session.mode == "DRAW" { current.append(CGPoint(x: v.location.x / geometry.size.width, y: v.location.y / geometry.size.height)) }
            }.onEnded { v in
                if session.mode == "POINT" {
                    let point = CGPoint(x: v.location.x / geometry.size.width, y: v.location.y / geometry.size.height)
                    session.selectedPoint = point; session.selectedTarget = FeedbackTarget.label(at: point, viewport: geometry.size, in: targets)
                    session.mode = "USE APP"
                } else { if current.count > 1 { session.strokes.append(FeedbackStroke(points: current)) }; session.mode = "USE APP" }
                current = []
            })
        }.accessibilityLabel("Feedback " + session.mode.lowercased() + " mode. After marking, normal controls resume.")
    }
}
