import SwiftUI
import UIKit
import ManadjCore

/// Separate destination and disclosure review. Never inherits the LAN report's
/// generic context selection, raw voice, or automatic filing behavior.
@MainActor
struct CloudFeedbackReview: View {
    let draft: FeedbackDraft
    let directory: URL
    @StateObject private var auth = CloudFeedbackSession()
    @State private var includeScreen = false
    @State private var includeTranscript = false
    @State private var frozen: CloudFeedbackOutbox.Entry?
    @State private var saved: [CloudFeedbackOutbox.Entry] = []
    @State private var busy = false
    @State private var received = false
    @State private var newReportID: UUID?
    @State private var status = "Not uploaded. Raw voice, music and app context stay local."
    @Environment(\.dismiss) private var dismiss
    private var store: CloudFeedbackOutbox { CloudFeedbackOutbox(directory: directory) }
    var body: some View {
        NavigationStack {
            Form {
                Section("Private cloud feedback") {
                    Text("Only you can access this report. Access ends 30 days after its first receipt. Storage cleanup may happen later.")
                    Text("Destination: manadj-private-feedback.murtaza-javaid.workers.dev").font(.caption)
                    Text(FeedbackScrub.text(draft.title)).font(.headline)
                    Text(FeedbackScrub.text(draft.description))
                    if let screen = draft.screenshot {
                        Toggle("Include reviewed marked screenshot", isOn: $includeScreen).disabled(frozen != nil || busy)
                        if let data = Data(base64Encoded: String(screen.dropFirst(FeedbackLimits.pngPrefix.count))), let image = UIImage(data: data) {
                            Image(uiImage: image).resizable().scaledToFit().accessibilityLabel("Reviewed marked screenshot")
                        }
                    }
                    if let transcript = draft.voice?.transcript, !transcript.isEmpty {
                        Toggle("Include this transcript", isOn: $includeTranscript).disabled(frozen != nil || busy)
                        Text(FeedbackScrub.text(transcript)).font(.caption)
                    }
                    Text("No logs or Settings context are uploaded in this version. The screenshot and transcript above are optional. Signing in does not upload anything.").font(.caption)
                }
                Section {
                    Button("Sign in for private feedback") { run { try await auth.signIn(); let enabled = try await auth.verifyOwnerSession(); status = enabled ? "Owner sign-in confirmed. Review before Send." : "Owner sign-in confirmed. Uploads remain disabled; nothing sent." } }
                    Button("Save reviewed report on iPhone") { run { frozen = try freeze(); status = "Frozen on this iPhone. Nothing uploaded."; try reload() } }.disabled(received)
                    Button("Send reviewed report") { run {
                        let entry = try freeze(); frozen = entry; try reload()
                        let receipt = try await auth.send(entry, store: store)
                        status = "Received privately. Access ends " + receipt.retainedUntil
                        frozen = nil; received = true; try reload()
                    } }
                    .disabled(received)
                    if received {
                        Button("Start a new report from this review") { newReportID = UUID(); frozen = nil; received = false; status = "New report identity. Review selections before Send." }
                    }
                    Button("Sign out") { run { let revoked = try await auth.signOut(); status = revoked ? "Signed out and remote session revoked." : "Signed out locally. Remote revocation was not confirmed." } }
                    Text(status).font(.caption).textSelection(.enabled)
                    if busy { ProgressView("Working, report stays saved until a matching receipt") }
                }.disabled(busy)
                Section("Saved frozen reports") {
                    ForEach(saved) { entry in
                        VStack(alignment: .leading) {
                            Text(entry.id).font(.caption)
                            DisclosureGroup("Review original frozen report") {
                                if let original = try? JSONDecoder().decode(CloudFeedbackReport.self, from: entry.body) {
                                    Text(original.title).font(.headline)
                                    if let text = original.description { Text(text) }
                                    if let text = original.transcript { Text("Transcript: " + text) }
                                    if let picture = original.screenshot, let data = Data(base64Encoded: picture.base64), let image = UIImage(data: data) { Image(uiImage: image).resizable().scaledToFit() }
                                }
                                Text("Owner-only destination. Raw voice/music excluded. Frozen bytes are not edited on retry.").font(.caption)
                            }
                            Text(entry.savedAt, style: .date).font(.caption2)
                            HStack {
                                Button("Check receipt") { run { _ = try await auth.checkReceipt(entry, store: store); status = "Matching cloud receipt confirmed."; try reload() } }
                                Button("Retry original") { run { _ = try await auth.send(entry, store: store); status = "Matching cloud receipt confirmed."; try reload() } }
                            }
                            Button("Discard local copy", role: .destructive) { pendingDiscard = entry }
                        }
                    }
                }.disabled(busy)
            }
            .navigationTitle("Review private report")
            .toolbar { Button("Done") { dismiss() }.disabled(busy) }
            .task { do { try reload() } catch { status = error.localizedDescription } }
            .confirmationDialog("Discard the saved local copy? This does not delete an already received cloud report.", isPresented: Binding(get: { pendingDiscard != nil }, set: { if !$0 { pendingDiscard = nil } })) {
                Button("Discard local copy", role: .destructive) { if let entry = pendingDiscard { run { try store.discard(entry); if frozen?.id == entry.id { frozen = nil }; try reload() } }; pendingDiscard = nil }
            }
        }
    }
    @State private var pendingDiscard: CloudFeedbackOutbox.Entry?
    private func freeze() throws -> CloudFeedbackOutbox.Entry {
        if let frozen { return frozen }
        var selected = draft
        if let newReportID { selected.id = newReportID }
        if !includeScreen { selected.screenshot = nil }
        return try store.freeze(CloudFeedbackReport(reviewed: selected, includeTranscript: includeTranscript))
    }
    private func reload() throws { saved = try store.pending() }
    private func run(_ operation: @escaping @MainActor () async throws -> Void) {
        busy = true
        Task { @MainActor in
            defer { busy = false }
            do { try await operation() } catch { status = error.localizedDescription }
        }
    }
}
