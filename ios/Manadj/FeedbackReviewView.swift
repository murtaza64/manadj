import SwiftUI
import AVFoundation
import ManadjCore

/// Shake → capture → this sheet: annotate, describe, see the exact scrubbed
/// fields that ship, then File explicitly. Nothing is sent on shake alone.
@MainActor
struct FeedbackReviewView: View {
    let capture: FeedbackCapture
    let targets: [FeedbackTarget]
    let onSubmit: @MainActor (FeedbackDraft) async -> FeedbackOutcome
    let queueDirectory: URL?
    let queueConnection: DesktopConnection?
    @State private var showOutbox = false

    let onClose: () -> Void
    @State private var confirming = false
    @State private var includeVoice = true
    @State private var player: AVAudioPlayer?
    let voice: FeedbackVoice?
    let voiceURL: URL?
    @State private var kind = FeedbackKind.bug
    @State private var title = ""
    @State private var details = ""
    @State private var strokes: [FeedbackStroke] = []
    @State private var picking = false
    @State private var selectedPoint: CGPoint?
    @State private var selectedTarget: String?
    @State private var includeScreenshot: Bool
    @State private var sections: [FeedbackSection]
    @State private var submitting = false
    @State private var outcome: FeedbackOutcome?
    @FocusState private var editing: Bool

    init(
        capture: FeedbackCapture,
        targets: [FeedbackTarget] = [],
        onSubmit: @escaping @MainActor (FeedbackDraft) async -> FeedbackOutcome,
        queueDirectory: URL? = nil,
        queueConnection: DesktopConnection? = nil,
        voice: FeedbackVoice? = nil,
        voiceURL: URL? = nil,
        initialComment: String = "",
        initialStrokes: [FeedbackStroke] = [],
        initialPoint: CGPoint? = nil,
        initialTarget: String? = nil,
        onClose: @escaping () -> Void = {}
    ) {
        self.voice = voice; self.voiceURL = voiceURL
        self.capture = capture
        self.targets = targets
        self.onSubmit = onSubmit
        self.queueDirectory = queueDirectory
        self.queueConnection = queueConnection
        self.onClose = onClose
        _strokes = State(initialValue: initialStrokes)
        _selectedPoint = State(initialValue: initialPoint)
        _selectedTarget = State(initialValue: initialTarget)
        _details = State(initialValue: initialComment)
        _title = State(initialValue: String(initialComment.prefix(100)))
        _includeScreenshot = State(initialValue: capture.screenshot != nil)
        _sections = State(initialValue: capture.sections)
    }

    private var trimmedTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// The exact scrubbed value that ships for one snapshot key. The preview
    /// is the payload, not a summary of it.
    private func exactContent(_ key: String) -> String? {
        guard let value = capture.snapshot[key] else { return nil }
        let scrubbed = FeedbackScrub.json(value)
        guard let data = try? JSONSerialization.data(
            withJSONObject: scrubbed, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes, .fragmentsAllowed]),
            let text = String(data: data, encoding: .utf8)
        else { return nil }
        return text
    }

    private var alwaysIncluded: [String: Any] {
        var meta: [String: Any] = [:]
        for key in ["view", "captured_at", "viewport"] {
            if let value = capture.snapshot[key] { meta[key] = FeedbackScrub.json(value) }
        }
        return meta
    }

    private func makeDraft() -> FeedbackDraft {
        var snapshot = capture.snapshot
        for section in sections where !section.included { snapshot.removeValue(forKey: section.key) }
        var warnings = capture.warnings
        var screenshot: String?
        if includeScreenshot, let image = capture.screenshot {
            let flattened = FeedbackCanvasView.flatten(image, strokes: strokes, selection: selectedPoint)
            let dataURL = flattened.pngData().map {
                FeedbackLimits.pngPrefix + $0.base64EncodedString()
            }
            if let dataURL, dataURL.count <= FeedbackLimits.screenshotDataURL {
                screenshot = dataURL
            } else {
                warnings.append("Screenshot left out: still too large after scaling")
            }
        }
        return FeedbackDraft(
            kind: kind, title: title, description: details + targetDescription,
            snapshot: snapshot, screenshot: screenshot, captureWarnings: warnings, voice: includeVoice ? voice : nil)
    }

    private var targetDescription: String {
        guard let point = selectedPoint else { return "" }
        return "\n\nSelected: \(selectedTarget ?? "Screenshot area") at \(Int(point.x * 100))%, \(Int(point.y * 100))% of captured screen."
    }
    private func pick(_ point: CGPoint) {
        selectedPoint = point
        let viewport = capture.snapshot["viewport"] as? [String: Any]
        let width = (viewport?["width"] as? NSNumber)?.doubleValue ?? 1
        let height = (viewport?["height"] as? NSNumber)?.doubleValue ?? 1
        selectedTarget = FeedbackTarget.label(at: point, viewport: CGSize(width: width, height: height), in: targets)
        picking = false
    }

    @State private var expanded = true
    @State private var atTop = false
    @State private var reviewingDetails = false
    private var comment: Binding<String> { Binding(get: { details }, set: { text in details = text; title = String(text.split(separator: "\n").first.map(String.init)?.prefix(100) ?? "") }) }
    private var destination: String { queueConnection?.baseURL.absoluteString ?? "This iPhone only, no desktop paired" }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: atTop ? .top : .bottom) {
                if let image = capture.screenshot, includeScreenshot {
                    FeedbackCanvasView(image: image, strokes: $strokes, picking: picking, selection: selectedPoint, onPick: pick)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Ink.base)
                        .ignoresSafeArea()
                } else { Ink.base.opacity(0.25).ignoresSafeArea() }
                VStack(spacing: 8) {
                    HStack(spacing: 12) {
                        Text("FEEDBACK").font(Ink.font(12, bold: true))
                        Spacer()
                        Button { editing = false; atTop.toggle() } label: { Image(systemName: atTop ? "arrow.down" : "arrow.up") }.accessibilityLabel("Move feedback card")
                        Button { editing = false; expanded.toggle() } label: { Image(systemName: expanded ? "minus" : "plus") }.accessibilityLabel(expanded ? "Collapse feedback" : "Expand feedback")
                        Button(outcome == nil ? "CANCEL" : "DONE") { onClose() }.disabled(submitting).font(Ink.font(11, bold: true))
                    }.frame(minHeight: 32)
                    if expanded {
                        if let outcome { outcomeView(outcome) }
                        else {
                            HStack(spacing: 8) {
                                Button(picking ? "TAP A CONTROL" : "POINT") { editing = false; picking.toggle() }.accessibilityIdentifier("feedback-pick-element")
                                Button("DRAW") { editing = false; picking = false }
                                Button("UNDO") { if !strokes.isEmpty { strokes.removeLast() } }.disabled(strokes.isEmpty)
                                Spacer()
                                Button { reviewingDetails.toggle(); editing = false } label: { Image(systemName: "info.circle") }.accessibilityLabel("Review what will be sent").accessibilityIdentifier("feedback-show-details")
                            }.font(Ink.font(11, bold: true)).buttonStyle(.plain).foregroundStyle(Ink.accent)
                            if selectedPoint != nil {
                                HStack {
                                    Text(selectedTarget ?? "Screen area").font(Ink.font(10)).accessibilityIdentifier("feedback-selected-target")
                                    Spacer(); Button("CLEAR TARGET") { selectedPoint = nil; selectedTarget = nil }.font(Ink.font(9))
                                }
                            }
                            if let voice, includeVoice {
                                HStack {
                                    Button("▶ VOICE · \(voice.durationMs / 1000)s") {
                                        guard let voiceURL else { return }
                                        do { player = try AVAudioPlayer(contentsOf: voiceURL); player?.play() } catch { }
                                    }.font(Ink.font(10)).accessibilityIdentifier("feedback-play-voice")
                                    Spacer()
                                    Button("REMOVE") { player?.stop(); includeVoice = false }.font(Ink.font(9)).accessibilityIdentifier("feedback-remove-voice")
                                }
                            }
                            TextField("What would make this better?", text: comment, axis: .vertical)
                                .font(Ink.font(13)).lineLimit(2...3).padding(8).background(Ink.crust, in: RoundedRectangle(cornerRadius: 8))
                                .accessibilityIdentifier("feedback-title").focused($editing)
                            HStack {
                                Text("Type or use keyboard dictation").font(Ink.font(9)).foregroundStyle(Ink.muted)
                                Spacer()
                                if editing { Button("HIDE KEYBOARD") { editing = false }.font(Ink.font(9)).accessibilityIdentifier("feedback-hide-keyboard") }
                            }
                            if reviewingDetails {
                                ScrollView {
                                    VStack(alignment: .leading, spacing: 8) {
                                        Text("TO: " + destination).font(Ink.font(10, bold: true))
                                        Picker("Kind", selection: $kind) { Text("Feedback").tag(FeedbackKind.bug); Text("Idea").tag(FeedbackKind.feature) }.pickerStyle(.segmented)
                                        Toggle("Include marked screen", isOn: $includeScreenshot).font(Ink.font(11))
                                        ForEach($sections) { $section in
                                            DisclosureGroup {
                                                if let content = exactContent(section.key) { Text(content).font(Ink.font(9)).foregroundStyle(Ink.muted).accessibilityIdentifier("feedback-content-" + section.key) }
                                            } label: { Toggle(section.title, isOn: $section.included).font(Ink.font(11)).accessibilityIdentifier("feedback-section-" + section.key) }
                                        }
                                        if let data = try? JSONSerialization.data(withJSONObject: alwaysIncluded, options: [.prettyPrinted, .sortedKeys, .fragmentsAllowed]), let text = String(data: data, encoding: .utf8) {
                                            DisclosureGroup("Always included: view, capture time and viewport") { Text(text).font(Ink.font(9)) }.font(Ink.font(10))
                                        }
                                        Text("Only your text and report link go to GitHub. The marked screen and selected context stay in the desktop feedback store. If unreachable, this reviewed report stays on this iPhone with no automatic retry.").font(Ink.font(10)).foregroundStyle(Ink.muted)
                                        ForEach(capture.warnings, id: \.self) { Text($0).font(Ink.font(10)).foregroundStyle(Ink.warning) }
                                    }.padding(.vertical, 4)
                                }.frame(maxHeight: min(210, geometry.size.height * 0.3))
                            }
                        }
                        HStack {
                            if queueDirectory != nil { Button("SAVED") { editing = false; showOutbox = true }.font(Ink.font(10)).accessibilityIdentifier("feedback-open-outbox") }
                            Spacer()
                            if outcome == nil {
                                Button(submitting ? "SENDING…" : "REVIEW & SEND") { editing = false; confirming = true }
                                    .font(Ink.font(12, bold: true)).foregroundStyle(Ink.play).disabled(trimmedTitle.isEmpty || submitting).accessibilityIdentifier("feedback-submit")
                            }
                        }
                        Text(destination).font(Ink.font(8)).foregroundStyle(Ink.muted).lineLimit(1)
                    }
                }
                .padding(12).frame(maxWidth: min(420, geometry.size.width - 20))
                .background(Ink.panel, in: RoundedRectangle(cornerRadius: 18))
                .overlay(RoundedRectangle(cornerRadius: 18).stroke(Ink.accent.opacity(0.6), lineWidth: 1))
                .shadow(color: .black.opacity(0.5), radius: 16, y: 6)
                .padding(.vertical, 10)
                .accessibilityIdentifier("feedback-comment-card")
            }
        }
        .confirmationDialog("Send this feedback?", isPresented: $confirming, titleVisibility: .visible) {
            Button(queueConnection == nil ? "SAVE REVIEWED FEEDBACK ON IPHONE" : "SEND REVIEWED FEEDBACK TO " + destination) { submit() }.accessibilityIdentifier("feedback-confirm-send")
            Button("KEEP EDITING", role: .cancel) {}
        } message: {
            Text("To: " + destination + ". " + (includeScreenshot ? "Includes the marked screen and " : "No screenshot. Includes ") + sections.filter(\.included).map(\.title).joined(separator: ", ") + ". " + (includeVoice && voice != nil ? "Includes your reviewed voice recording. " : "") + "Only text and a report link go to GitHub. Screen, voice and context stay in the desktop feedback store. No automatic retry from this iPhone.")
        }
        .sheet(isPresented: $showOutbox) { if let queueDirectory { FeedbackOutboxView(directory: queueDirectory, connection: queueConnection) } }
        .accessibilityElement(children: .contain).accessibilityIdentifier("feedback-review")
        .preferredColorScheme(.dark)
    }

    @ViewBuilder
    private func outcomeView(_ outcome: FeedbackOutcome) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            switch outcome {
            case .filed(let issueURL):
                Text("FILED").font(Ink.font(14, bold: true)).foregroundStyle(Ink.play)
                Text("The GitHub issue carries your text and a report link; the screenshot and context stay on your desktop.")
                    .font(Ink.font(11)).foregroundStyle(Ink.muted)
                if let issueURL, let url = URL(string: issueURL) {
                    Link(issueURL, destination: url).font(Ink.font(11)).foregroundStyle(Ink.accent)
                }
            case .savedOnDesktop(let status, let detail):
                Text("SAVED ON YOUR DESKTOP").font(Ink.font(14, bold: true)).foregroundStyle(Ink.warning)
                Text("GitHub filing did not finish (\(status)); retry from the desktop feedback queue.\(detail.map { " \($0)" } ?? "")")
                    .font(Ink.font(11)).foregroundStyle(Ink.muted)
            case .queuedLocally(let reason):
                Text("SAVED ON THIS IPHONE").font(Ink.font(14, bold: true)).foregroundStyle(Ink.warning)
                Text(reason).font(Ink.font(11)).foregroundStyle(Ink.muted)
            case .rejected(let reason):
                Button("BACK TO EDITING") { self.outcome = nil }
                    .buttonStyle(FlatButtonStyle(color: Ink.accent))
                Text("NOT FILED").font(Ink.font(14, bold: true)).foregroundStyle(Ink.danger)
                Text(reason).font(Ink.font(11)).foregroundStyle(Ink.muted)
            case .saveFailed(let reason):
                Button("BACK TO EDITING") { self.outcome = nil }
                    .buttonStyle(FlatButtonStyle(color: Ink.accent))
                Text("NOT FILED OR SAVED").font(Ink.font(14, bold: true)).foregroundStyle(Ink.danger)
                Text(reason).font(Ink.font(11)).foregroundStyle(Ink.muted)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Ink.panel).overlay(Rectangle().stroke(Ink.edge, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("feedback-outcome")
    }

    private func submit() {
        editing = false
        submitting = true
        let report = makeDraft()
        Task { @MainActor in
            let result = await onSubmit(report)
            outcome = result
            submitting = false
        }
    }
}
