import SwiftUI
import ManadjCore

/// Every held report can be inspected, discarded, or explicitly sent to the
/// currently named desktop. Re-pairing alone never authorizes that send.
struct FeedbackOutboxView: View {
    let directory: URL
    let connection: DesktopConnection?
    @Environment(\.dismiss) private var dismiss
    @State private var entries: [Entry] = []
    @State private var busy = false
    @State private var status = ""

    struct Entry: Identifiable {
        let id: String
        let origin: String?
        let payload: Data
        var object: [String: Any] { (try? JSONSerialization.jsonObject(with: payload)) as? [String: Any] ?? [:] }
        var text: String {
            var value = object
            value.removeValue(forKey: "screenshot")
            let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
            return data.flatMap { String(data: $0, encoding: .utf8) } ?? "Unreadable report"
        }
        var image: UIImage? {
            guard let url = object["screenshot"] as? String,
                  url.hasPrefix(FeedbackLimits.pngPrefix),
                  let data = Data(base64Encoded: String(url.dropFirst(FeedbackLimits.pngPrefix.count))) else { return nil }
            return UIImage(data: data)
        }
    }

    private func reload() {
        entries = FeedbackQueue(directory: directory).pending().map { Entry(id: $0.id, origin: $0.origin, payload: $0.payload) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Review the saved text, context, and image below before sending. GitHub receives text only; image and context stay on the destination desktop.").font(Ink.font(11))
                    Text("DESTINATION: \(connection?.baseURL.absoluteString ?? "No desktop paired. Pair in Settings first.")")
                        .font(Ink.font(12, bold: true)).foregroundStyle(Ink.accent)
                    if entries.isEmpty { Text("No saved reports.").font(Ink.font()) }
                    ForEach(entries) { entry in
                        VStack(alignment: .leading, spacing: 8) {
                            Text("SAVED FOR: \(entry.origin ?? "No destination approved")").font(Ink.font(10))
                            if let image = entry.image {
                                Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 350)
                            }
                            Text(entry.text).font(Ink.font(10)).textSelection(.enabled)
                            if let connection {
                                Button("REVIEWED · SEND TO THIS DESKTOP") { send(entry, to: connection) }
                                    .buttonStyle(FlatButtonStyle(color: Ink.play)).disabled(busy)
                            }
                            Button("DISCARD THIS SAVED REPORT") {
                                FeedbackQueue(directory: directory).remove(id: entry.id)
                                reload()
                            }.buttonStyle(FlatButtonStyle(color: Ink.danger)).disabled(busy)
                        }.padding(8).overlay(Rectangle().stroke(Ink.edge, lineWidth: 1))
                    }
                    Text(status).font(Ink.font(11)).accessibilityIdentifier("feedback-outbox-status")
                }.padding(12)
            }.background(Ink.base)
                .navigationTitle("SAVED REPORTS")
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("DONE") { dismiss() }.disabled(busy) } }
        }.preferredColorScheme(.dark).onAppear { reload() }
    }

    private func send(_ entry: Entry, to connection: DesktopConnection) {
        busy = true
        Task {
            do {
                let result = try await SyncClient(connection).submitFeedback(entry.payload)
                FeedbackQueue(directory: directory).remove(id: entry.id)
                status = result.status == "filed" ? "Filed. \(result.issueURL ?? "")" : "Saved on desktop. GitHub filing status: \(result.status)."
            } catch {
                status = "Not sent. The saved report is still here. \(error.localizedDescription)"
            }
            reload()
            busy = false
        }
    }
}
