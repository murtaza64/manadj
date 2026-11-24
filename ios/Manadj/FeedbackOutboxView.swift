import SwiftUI
import AVFoundation
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
    @State private var player: AVAudioPlayer?

    struct Entry: Identifiable {
        let id: String
        let origin: String?
        let payload: Data
        let object: [String: Any]
        init(id: String, origin: String?, payload: Data) {
            self.id = id; self.origin = origin; self.payload = payload
            object = (try? JSONSerialization.jsonObject(with: payload)) as? [String: Any] ?? [:]
        }
        var voiceData: Data? {
            guard let voice = object["voice"] as? [String: Any], let format = voice["format"] as? String,
                  let prefix = FeedbackLimits.voicePrefixes[format], let url = voice["data_url"] as? String,
                  url.hasPrefix(prefix) else { return nil }
            return Data(base64Encoded: String(url.dropFirst(prefix.count)))
        }
        var text: String {
            var value = object
            value.removeValue(forKey: "screenshot")
            if var voice = value["voice"] as? [String: Any] {
                voice.removeValue(forKey: "data_url")
                voice["audio"] = "Local recording included. Use PLAY VOICE to review."
                value["voice"] = voice
            }
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
                    Text("Review the saved text, voice, context, and image before sending. GitHub receives text only; voice, image and context stay on the destination desktop.").font(Ink.font(11))
                    Text("DESTINATION: \(connection?.baseURL.absoluteString ?? "No desktop paired. Pair in Settings first.")")
                        .font(Ink.font(12, bold: true)).foregroundStyle(Ink.accent)
                    if entries.isEmpty { Text("No saved reports.").font(Ink.font()) }
                    ForEach(entries) { entry in
                        VStack(alignment: .leading, spacing: 8) {
                            Text("SAVED FOR: \(entry.origin ?? "No destination approved")").font(Ink.font(10))
                            if let image = entry.image {
                                Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 350)
                            }
                            if entry.object["voice"] is [String: Any] {
                                Button("PLAY SAVED VOICE") {
                                    do {
                                        guard let data = entry.voiceData else { throw CocoaError(.fileReadCorruptFile) }
                                        player?.stop(); player = try AVAudioPlayer(data: data)
                                        guard player?.play() == true else { throw CocoaError(.fileReadUnknown) }
                                    } catch { status = "Voice could not play: " + error.localizedDescription }
                                }.font(Ink.font(11)).accessibilityIdentifier("feedback-outbox-play-voice")
                                Button("STOP VOICE") { player?.stop() }.font(Ink.font(10))
                            }
                            Text(entry.text).font(Ink.font(10)).textSelection(.enabled)
                            if let connection {
                                Button("REVIEWED · SEND TO THIS DESKTOP") { send(entry, to: connection) }
                                    .buttonStyle(FlatButtonStyle(color: Ink.play)).disabled(busy)
                            }
                            Button("DISCARD THIS SAVED REPORT") {
                                player?.stop()
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
        }.preferredColorScheme(.dark).onAppear { reload() }.onDisappear { player?.stop() }
    }

    private func send(_ entry: Entry, to connection: DesktopConnection) {
        player?.stop()
        busy = true
        Task {
            let result = await FeedbackSubmitter(queue: FeedbackQueue(directory: directory)).retryReviewed(id: entry.id, payload: entry.payload, via: connection)
            switch result {
            case .filed(let url): status = "Filed. " + (url ?? "")
            case .savedOnDesktop(let value, _): status = "Saved on desktop. GitHub filing status: " + value
            case .queuedLocally(let reason), .rejected(let reason), .saveFailed(let reason): status = reason
            }
            reload()
            busy = false
        }
    }
}
