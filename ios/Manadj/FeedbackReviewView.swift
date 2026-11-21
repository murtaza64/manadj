import SwiftUI
import ManadjCore

/// Shake → capture → this sheet: annotate, describe, see the exact scrubbed
/// fields that ship, then File explicitly. Nothing is sent on shake alone.
@MainActor
struct FeedbackReviewView: View {
    let capture: FeedbackCapture
    let onSubmit: @MainActor (FeedbackDraft) async -> FeedbackOutcome
    let queueDirectory: URL?
    let queueConnection: DesktopConnection?
    @State private var showOutbox = false

    @Environment(\.dismiss) private var dismiss
    @State private var kind = FeedbackKind.bug
    @State private var title = ""
    @State private var details = ""
    @State private var strokes: [FeedbackStroke] = []
    @State private var includeScreenshot: Bool
    @State private var sections: [FeedbackSection]
    @State private var submitting = false
    @State private var outcome: FeedbackOutcome?
    @FocusState private var editing: Bool

    init(
        capture: FeedbackCapture,
        onSubmit: @escaping @MainActor (FeedbackDraft) async -> FeedbackOutcome,
        queueDirectory: URL? = nil,
        queueConnection: DesktopConnection? = nil
    ) {
        self.capture = capture
        self.onSubmit = onSubmit
        self.queueDirectory = queueDirectory
        self.queueConnection = queueConnection
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
            let flattened = FeedbackCanvasView.flatten(image, strokes: strokes)
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
            kind: kind, title: title, description: details,
            snapshot: snapshot, screenshot: screenshot, captureWarnings: warnings)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    if queueDirectory != nil {
                        Button("REVIEW SAVED REPORTS") { editing = false; showOutbox = true }
                            .buttonStyle(FlatButtonStyle(color: Ink.accent))
                            .accessibilityIdentifier("feedback-open-outbox")
                    }
                    SectionLabel(title: "WHAT HAPPENED")
                    Picker("Kind", selection: $kind) {
                        Text("BUG").tag(FeedbackKind.bug)
                        Text("IDEA").tag(FeedbackKind.feature)
                    }
                    .pickerStyle(.segmented)
                    .padding(.bottom, 4)
                    TextField("Short title", text: $title)
                        .font(Ink.font()).padding(8)
                        .background(Ink.panel).overlay(Rectangle().stroke(Ink.edge, lineWidth: 1))
                        .accessibilityIdentifier("feedback-title")
                        .focused($editing)
                        .submitLabel(.done)
                        .onSubmit { editing = false }
                    TextField("What were you doing? What did you expect?", text: $details, axis: .vertical)
                        .font(Ink.font(12)).lineLimit(3...6).padding(8)
                        .background(Ink.panel).overlay(Rectangle().stroke(Ink.edge, lineWidth: 1))
                        .accessibilityIdentifier("feedback-details")
                        .focused($editing)

                    if let image = capture.screenshot, includeScreenshot {
                        SectionLabel(title: "DRAW ON THE SCREENSHOT")
                        FeedbackCanvasView(image: image, strokes: $strokes)
                            .frame(maxHeight: 320)
                            .overlay(Rectangle().stroke(Ink.edge, lineWidth: 1))
                        HStack(spacing: 8) {
                            Button("UNDO") { if !strokes.isEmpty { strokes.removeLast() } }
                                .buttonStyle(FlatButtonStyle(color: Ink.muted))
                                .disabled(strokes.isEmpty)
                            Button("CLEAR") { strokes = [] }
                                .buttonStyle(FlatButtonStyle(color: Ink.muted))
                                .disabled(strokes.isEmpty)
                            Spacer()
                            Button("REMOVE IMAGE") { includeScreenshot = false }
                                .buttonStyle(FlatButtonStyle(color: Ink.danger))
                        }
                    }

                    SectionLabel(title: "EXACTLY WHAT SHIPS WITH THIS REPORT")
                    ForEach($sections) { $section in
                        VStack(alignment: .leading, spacing: 2) {
                            Toggle(isOn: $section.included) {
                                Text(section.title).font(Ink.font(12, bold: true))
                            }
                            .tint(Ink.accent)
                            .accessibilityIdentifier("feedback-section-\(section.key)")
                            if section.included, let content = exactContent(section.key) {
                                Text(content)
                                    .font(Ink.font(9))
                                    .foregroundStyle(Ink.muted)
                                    .padding(6)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(Ink.panel)
                                    .overlay(Rectangle().stroke(Ink.edge, lineWidth: 1))
                                    .accessibilityIdentifier("feedback-content-\(section.key)")
                            }
                        }
                    }
                    if let data = try? JSONSerialization.data(
                        withJSONObject: alwaysIncluded, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes, .fragmentsAllowed]),
                        let text = String(data: data, encoding: .utf8) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("ALWAYS INCLUDED").font(Ink.font(12, bold: true))
                            Text(text)
                                .font(Ink.font(9))
                                .foregroundStyle(Ink.muted)
                                .padding(6)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Ink.panel)
                                .overlay(Rectangle().stroke(Ink.edge, lineWidth: 1))
                        }
                        .padding(.top, 4)
                    }
                    Text("Filing creates a GitHub issue with your title and text, linked by report id. The screenshot and the context above stay with the report on your desktop's feedback store; they are not uploaded to GitHub.")
                        .font(Ink.font(10)).foregroundStyle(Ink.muted).padding(.vertical, 8)

                    Text("If the paired desktop is unreachable, File saves this reviewed report on this iPhone. It will not send later on its own. Use REVIEW SAVED REPORTS to review it and approve the named destination. Reports captured without a paired desktop stay here. Use REVIEW SAVED REPORTS to inspect them and approve a destination after pairing.")
                        .font(Ink.font(10)).foregroundStyle(Ink.muted).padding(.bottom, 8)

                    if let outcome {
                        outcomeView(outcome)
                    } else {
                        Button(action: submit) {
                            Text(submitting ? "FILING…" : "REVIEWED · FILE FEEDBACK")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(FlatButtonStyle(color: Ink.play, active: submitting))
                        .disabled(trimmedTitle.isEmpty || submitting)
                        .accessibilityIdentifier("feedback-submit")
                    }
                }
                .padding(12)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Ink.base)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("HIDE KEYBOARD") { editing = false }
                        .accessibilityIdentifier("feedback-hide-keyboard")
                }
                ToolbarItem(placement: .principal) {
                    Text("REPORT").font(Ink.font(14, bold: true)).foregroundStyle(Ink.text)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(outcome == nil ? "CANCEL" : "DONE") { dismiss() }.disabled(submitting)
                        .font(Ink.font(12, bold: true)).foregroundStyle(Ink.accent)
                }
            }
        }
        .sheet(isPresented: $showOutbox) {
            if let queueDirectory { FeedbackOutboxView(directory: queueDirectory, connection: queueConnection) }
        }
        .interactiveDismissDisabled(submitting)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("feedback-review")
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
