import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    @State private var forgetConfirmation = false
    @State private var bulkConfirmation = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                SectionLabel(title: "DESKTOP · PHONE SYNC")
                Text("On the desktop: Settings → Library → Phone sync. Enable the LAN listener, then enter its address here. Both devices must be on the same trusted network.").font(Ink.font(14)).foregroundStyle(Ink.muted)
                TextField("http://192.168.1.20:48127", text: $model.origin)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .padding(12).background(Ink.crust).overlay(Rectangle().stroke(Ink.edge)).disabled(model.busy)
                    .accessibilityLabel("Desktop address")
                Text("LAN sync uses the desktop's HTTP listener. Audio, library data and pairing credentials are not encrypted in transit on that connection. Use a trusted private network.").font(Ink.font(11)).foregroundStyle(Ink.warning)
                if let paired = model.pairedOrigin {
                    Text("PAIRED TO \(paired)").font(Ink.font(12)).foregroundStyle(Ink.play).textSelection(.enabled)
                }
                if let code = model.pairingCode {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("MATCH THIS CODE ON THE DESKTOP").font(Ink.font(12))
                        Text(code).font(Ink.font(36, bold: true)).tracking(8).foregroundStyle(Ink.accent)
                    }.padding(16).frame(maxWidth: .infinity, alignment: .leading).background(Ink.crust).overlay(Rectangle().stroke(Ink.accent))
                }
                HStack(spacing: 8) {
                    if model.busy { Button("CANCEL") { model.cancelWork() }.buttonStyle(FlatButtonStyle(color: Ink.warning)); ProgressView() }
                    else {
                        Button("PAIR IPHONE") { model.pair() }.buttonStyle(FlatButtonStyle())
                        Button("SYNC") { model.sync() }.buttonStyle(FlatButtonStyle()).disabled(model.pairedOrigin == nil)
                    }
                }
                Text(model.status).font(Ink.font(12)).foregroundStyle(Ink.muted)
                if model.snapshot?.schemaStale == true { Text("This desktop snapshot is older than the current sync schema. Update manaDJ desktop and sync again.").font(Ink.font(12)).foregroundStyle(Ink.warning) }
                Button("SYNC + ALL AUDIO") { bulkConfirmation = true }.buttonStyle(FlatButtonStyle()).disabled(model.busy || model.pairedOrigin == nil)
                Text("Normal sync caches the library and previews. Audio downloads when loaded. All audio can use substantial storage. This slice does not automatically remove old revisions.").font(Ink.font(11)).foregroundStyle(Ink.muted)
                if model.pairedOrigin != nil { Button("FORGET DESKTOP") { forgetConfirmation = true }.buttonStyle(FlatButtonStyle(color: Ink.danger)).disabled(model.busy) }
                Divider().overlay(Ink.edge)
                SectionLabel(title: "AUDIO OUTPUT")
                Toggle("Split mono: left master / right cue", isOn: $model.splitOutput).onChange(of: model.splitOutput) { _, on in model.audio?.splitOutput(on) }
                Text("Stereo is master only. Split mono requires a DJ splitter cable. Separate four-channel USB routing is not implemented in this slice.").font(Ink.font(11)).foregroundStyle(Ink.muted)
                HStack {
                    Text("CUE").font(Ink.font(11))
                    Slider(value: $model.cueMix, in: 0...1).onChange(of: model.cueMix) { _, value in model.set(MDJCueMix, 0, value) }.accessibilityLabel("Headphone cue and master blend")
                    Text("MASTER").font(Ink.font(11))
                }
                Text("Route changes and interruptions stop playback and invalidate an active recording. Resume manually. Real device latency, Bluetooth behavior and headphone routing still need Apple-device testing.").font(Ink.font(11)).foregroundStyle(Ink.warning)
                Divider().overlay(Ink.edge)
                SectionLabel(title: "SAVED MASTER RECORDINGS")
                if model.recordings.isEmpty { Text("No finalized recordings yet. REC captures the stereo master, not the microphone.").font(Ink.font(12)).foregroundStyle(Ink.muted) }
                ForEach(model.recordings, id: \.self) { url in
                    HStack {
                        Text(url.lastPathComponent).font(Ink.font(12)).lineLimit(2)
                        Spacer()
                        ShareLink(item: url) { Image(systemName: "square.and.arrow.up").frame(width: 44, height: 44) }.accessibilityLabel("Share \(url.lastPathComponent)")
                    }
                }
                Divider().overlay(Ink.edge)
                SectionLabel(title: "IMPLEMENTATION STATUS")
                Text("Native SwiftUI interface · AVFoundation audio output and file decoding · shared C++ DSP engine · Swift library and Follow ranking. This is implementation work, not a verified release.").font(Ink.font(12)).foregroundStyle(Ink.muted)
                Text("Still missing: desktop write-back, saved imports browser, Session replay/timeline, sync groups/phase alignment, scratch gestures, stems, heard-latency calibration, full detail-waveform editing and four-channel output. Read the Android coverage map in ios/FEATURE_COVERAGE.md.").font(Ink.font(12)).foregroundStyle(Ink.warning)
            }.padding(16)
        }.background(Ink.base)
        .confirmationDialog("Forget this desktop on this iPhone?", isPresented: $forgetConfirmation) {
            Button("Forget desktop", role: .destructive) { model.forgetDesktop() }
        } message: { Text("Downloaded tracks remain offline. Remove this iPhone in desktop settings to revoke its token there too.") }
        .confirmationDialog("Download the whole library?", isPresented: $bulkConfirmation) {
            Button("Sync and download all audio") { model.sync(allAudio: true) }
        } message: { Text("This can take time and use substantial device storage. Existing cached tracks will be kept.") }
    }
}
import CEngine
