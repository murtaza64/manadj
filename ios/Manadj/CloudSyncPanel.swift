import SwiftUI
import UniformTypeIdentifiers
import ManadjCore

struct CloudSyncPanel: View {
    @ObservedObject var controller: CloudSyncController
    let tracks: [LibraryTrack]
    let importConfiguration: (URL) -> Void
    @State private var choosing = false
    @State private var identity = ""
    @State private var selectedID = 0
    @State private var title = ""
    @State private var cue = ""
    @State private var editError: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("PRIVATE CLOUD TEST").font(Ink.font(12, bold: true))
            Text(controller.status).font(Ink.font(11)).foregroundStyle(Ink.muted)
            HStack(spacing: 8) {
                Button("DEVICE ID") {
                    do { let (id, key) = try controller.publicIdentity(); identity = id.uuidString.lowercased() + "\n" + key.base64EncodedString() }
                    catch { identity = "Device identity unavailable" }
                }.buttonStyle(FlatButtonStyle())
                Button("IMPORT GROUP") { choosing = true }.buttonStyle(FlatButtonStyle()).disabled(controller.running)
            }
            if !identity.isEmpty { Text(identity).font(Ink.font(10)).textSelection(.enabled) }
            HStack(spacing: 8) {
                Button("SIGN IN") { Task { await controller.signIn() } }.buttonStyle(FlatButtonStyle()).disabled(!CloudLibraryOAuth.authenticationTestEnabled).opacity(CloudLibraryOAuth.authenticationTestEnabled ? 1 : 0.45)
                Button(controller.running ? "STOP" : "START") {
                    if controller.running { controller.stop() } else { controller.start() }
                }.buttonStyle(FlatButtonStyle()).disabled(!controller.configured || !CloudLibraryOAuth.enabled).opacity(controller.configured && CloudLibraryOAuth.enabled ? 1 : 0.45)
            }
            if controller.configured {
                Picker("Selected track", selection: $selectedID) {
                    Text("Choose track").tag(0)
                    ForEach(tracks.filter { controller.selectedTrackIDs.contains($0.id) }) { track in Text(track.title).tag(track.id) }
                }
                TextField("New title", text: $title).font(Ink.font(12))
                HStack {
                    Button("SAVE TITLE") {
                        do { try controller.edit(localID: selectedID, value: .title(title)); editError = nil }
                        catch { editError = "Edit not saved: " + error.localizedDescription }
                    }.disabled(selectedID == 0 || title.isEmpty)
                    TextField("Cue seconds", text: $cue).keyboardType(.decimalPad).font(Ink.font(12))
                    Button("SAVE CUE") {
                        guard let seconds = Double(cue) else { editError = "Enter cue seconds"; return }
                        do { try controller.edit(localID: selectedID, value: .mainCue(seconds)); editError = nil }
                        catch { editError = "Edit not saved: " + error.localizedDescription }
                    }.disabled(selectedID == 0)
                }.buttonStyle(FlatButtonStyle())
                if let editError { Text(editError).font(Ink.font(11)).foregroundStyle(Ink.danger) }
            }
            Text(controller.history).font(Ink.font(11)).foregroundStyle(Ink.muted)
            Text("Selected downloaded music only. Foreground test; no cloud audio or remote session replay. Conflicts: \(controller.conflicts). Original library files stay unchanged.").font(Ink.font(10)).foregroundStyle(Ink.warning)
        }.padding(8).overlay(Rectangle().stroke(Ink.edge))
        .fileImporter(isPresented: $choosing, allowedContentTypes: [.json]) { result in
            if case .success(let url) = result { importConfiguration(url) }
        }
    }
}
