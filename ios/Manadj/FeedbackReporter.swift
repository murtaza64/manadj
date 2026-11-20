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

    @State private var detector = ShakeDetector()
    @State private var capture: FeedbackCapture?
    @State private var reviewing = false

    func body(content: Content) -> some View {
        content
            .sheet(isPresented: $reviewing) {
                if let capture {
                    FeedbackReviewView(
                        capture: capture,
                        onSubmit: { draft in
                            let submitter = FeedbackSubmitter(
                                queue: FeedbackQueue(directory: model.feedbackQueueRoot))
                            return await submitter.submit(draft, via: model.syncConnection)
                        },
                        onRetryQueue: model.syncConnection.map { connection in
                            let queueRoot = model.feedbackQueueRoot
                            return {
                                let submitter = FeedbackSubmitter(
                                    queue: FeedbackQueue(directory: queueRoot))
                                let (sent, remaining) = await submitter.drainQueue(via: connection)
                                return remaining == 0
                                    ? "Queue clear: \(sent) report(s) filed."
                                    : "\(sent) filed, \(remaining) still waiting (unreachable, unbound, refused, or saved for another desktop; use REVIEW SAVED REPORTS)."
                            }
                        },
                        queueDirectory: model.feedbackQueueRoot,
                        queueConnection: model.syncConnection)
                }
            }
            .onAppear {
                detector.onShake = { present() }
                detector.start()
                if autoPresent { present() }
            }
            .onDisappear { detector.stop() }
    }

    @MainActor
    private func present() {
        guard !reviewing else { return } // a second shake must not recapture mid-review
        capture = FeedbackCapture.capture(model: model, browsing: browsing, settings: settings)
        reviewing = true
    }
}

extension View {
    func feedbackReporter(model: AppModel, browsing: Bool, settings: Bool, autoPresent: Bool = false) -> some View {
        modifier(FeedbackReporter(model: model, browsing: browsing, settings: settings, autoPresent: autoPresent))
    }
}
