import SwiftUI
import ManadjCore

/// Shake → capture → review → submit, attached once at the workspace root.
/// Shaking never sends anything by itself; the review sheet is the only path
/// out, and it shows exactly what a report contains before filing.
struct FeedbackReporter: ViewModifier {
    @ObservedObject var model: AppModel
    let browsing: Bool
    let settings: Bool
    /// Simulator coverage (--feedback-ui-fixture): the simulator has no
    /// accelerometer, so the fixture presents the sheet directly.
    let autoPresent: Bool
    @Binding var requested: Bool
    let targets: [FeedbackTarget]

    @State private var detector = ShakeDetector()
    @State private var capture: FeedbackCapture?
    @State private var capturedTargets: [FeedbackTarget] = []
    @State private var reviewing = false

    func body(content: Content) -> some View {
        content
            .sheet(isPresented: $reviewing) {
                if let capture {
                    FeedbackReviewView(
                        capture: capture,
                        targets: capturedTargets,
                        onSubmit: { draft in
                            let submitter = FeedbackSubmitter(
                                queue: FeedbackQueue(directory: model.feedbackQueueRoot))
                            return await submitter.submit(draft, via: model.syncConnection)
                        },
                        queueDirectory: model.feedbackQueueRoot,
                        queueConnection: model.syncConnection)
                }
            }
            .onChange(of: requested) { _, value in
                if value { requested = false; present() }
            }
            .onAppear {
                detector.onShake = { present() }
                detector.start()
                if autoPresent {
                    // onAppear precedes the first rendered frame. Capture the
                    // actual fixture workspace, not an empty launch window.
                    Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(700))
                        present()
                    }
                }
            }
            .onDisappear { detector.stop() }
    }

    @MainActor
    private func present() {
        guard !reviewing else { return } // a second shake must not recapture mid-review
        capturedTargets = targets
        capture = FeedbackCapture.capture(model: model, browsing: browsing, settings: settings)
        reviewing = true
    }
}

extension View {
    func feedbackReporter(model: AppModel, browsing: Bool, settings: Bool, requested: Binding<Bool>, targets: [FeedbackTarget], autoPresent: Bool = false) -> some View {
        modifier(FeedbackReporter(model: model, browsing: browsing, settings: settings, autoPresent: autoPresent, requested: requested, targets: targets))
    }
}
