import SwiftUI
import UniformTypeIdentifiers
import CEngine

@main struct ManadjApp: App {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            Group {
                #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("--local-live-ui-fixture") { LocalLiveView() }
                else { WorkspaceView() }
                #else
                WorkspaceView()
                #endif
            }.environmentObject(model)
                .onAppear { model.syncWake.setActive(scenePhase == .active) }
                .onChange(of: scenePhase) { _, phase in model.syncWake.setActive(phase == .active) }
                .font(Ink.font()).foregroundStyle(Ink.text)
                .tint(Ink.accent).preferredColorScheme(.dark)
        }
    }
}

/// Android STANDARD structure, native SwiftUI/UIKit controls. Runtime parity remains under review.
struct WorkspaceView: View {
    @EnvironmentObject var model: AppModel
    @State private var browsing = false
    @State private var keyboardOpen = false
    @State private var settings = false
    @State private var files = false
    @State private var fileTarget = 0
    @State private var pitch: Int?
    @State private var xf = true
    @State private var fx = false
    @State private var effect = 0
    @State private var fxTarget = 0
    @State private var fxBeatIndex = 3
    @State private var saved = false
    private let fxBeats = [0.0625, 0.125, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0]
    @State private var fxDepth = -0.5
    @State private var selected = 0
    @State private var notice: String?
    var body: some View {
        GeometryReader { geometry in
            let landscape = geometry.size.width > geometry.size.height
            Group { if landscape { landscapeBody } else { portraitBody } }
                .background(Ink.base)
                .overlay(alignment: .top) {
                    if let notice { Text(notice).font(Ink.font(11)).padding(8).background(Ink.crust).padding(.top, 50).onTapGesture { self.notice = nil } }
                }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboardOpen = true }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboardOpen = false }
        .fileImporter(isPresented: $files, allowedContentTypes: [.audio]) { result in
            switch result {
            case .success(let url): model.importFile(url, deck: fileTarget)
            case .failure(let error): model.error = error.localizedDescription
            }
        }
        .sheet(isPresented: $saved) { SettingsView().environmentObject(model) }
        .alert("manaDJ", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("OK", role: .cancel) { model.error = nil }
        } message: { Text(model.error ?? "") }
        .feedbackReporter(model: model, browsing: browsing, settings: settings,
                          autoPresent: ProcessInfo.processInfo.arguments.contains("--feedback-ui-fixture"))
    }
    private var portraitBody: some View {
        GeometryReader { geometry in
            let compact = geometry.size.height < 860
            let gap: CGFloat = compact ? 5 : 8
            VStack(spacing: gap) {
                HStack(spacing: 14) { deckInfo(0); deckInfo(1) }.frame(height: browsing && keyboardOpen ? 36 : 44)
                if !(browsing && keyboardOpen) { VStack(spacing: 3) { detailWave(0); detailWave(1) }.frame(height: compact ? 83 : 135) }
                ZStack(alignment: .bottom) {
                    if !browsing && !settings { VStack(spacing: gap) {
                        mixer.frame(maxHeight: .infinity)
                        HStack(spacing: 6) { minimap(0); browseKey.frame(width: 84); minimap(1) }.frame(height: compact ? 36 : 44)
                        HStack(alignment: .top, spacing: 14) { deckControls(0, compact: compact); deckControls(1, compact: compact) }
                    }
                    }
                    if browsing {
                        VStack(spacing: 0) {
                            if !keyboardOpen { Capsule().fill(Ink.muted.opacity(0.7)).frame(width: 40, height: 4).frame(height: 16) }
                            library
                            HStack(spacing: 12) { transport(0, browser: true); transport(1, browser: true) }.frame(height: 44).padding(.horizontal, 6).background(Ink.panel)
                        }.background(Ink.base).transition(.move(edge: .bottom))
                            .gesture(DragGesture(minimumDistance: 40).onEnded { if $0.translation.height > 60 { withAnimation(.easeOut(duration: 0.24)) { browsing = false } } })
                    }
                    if settings {
                        VStack(spacing: 0) {
                            HStack { Text("SETTINGS").font(Ink.font(14, bold: true)); Spacer(); Button("CLOSE") { settings = false }.buttonStyle(PerformanceKeyStyle()).frame(width: 75, height: 38) }
                            SettingsView()
                        }.background(Ink.base).transition(.move(edge: .bottom))
                    }
                }.clipped()
            }.padding(.horizontal, 8)
            .animation(.easeOut(duration: 0.24), value: browsing)
            .animation(.easeOut(duration: 0.24), value: settings)
        }
    }
    private var landscapeBody: some View {
        GeometryReader { geometry in
            HStack(spacing: 10) {
                VStack(spacing: 4) { deckInfo(0).frame(height: 36); minimap(0).frame(height: 30); deckControls(0, compact: true) }.frame(width: geometry.size.width * 0.28)
                VStack(spacing: 4) {
                    HStack(spacing: 3) { detailWave(0, vertical: true); detailWave(1, vertical: true) }.frame(maxHeight: .infinity)
                    mixer
                    browseKey.frame(height: 36)
                }
                VStack(spacing: 4) { deckInfo(1).frame(height: 36); minimap(1).frame(height: 30); deckControls(1, compact: true) }.frame(width: geometry.size.width * 0.28)
            }.padding(.horizontal, 8)
            .overlay(alignment: .leading) {
                if browsing { VStack { library; browseKey.frame(height: 36) }.frame(width: geometry.size.width * 0.6).background(Ink.base) }
                if settings { VStack { Button("CLOSE SETTINGS") { settings = false }; SettingsView() }.frame(width: geometry.size.width * 0.6).background(Ink.base) }
            }
        }
    }
    private func deckInfo(_ index: Int) -> some View {
        let deck = model.decks[index]
        return HStack(spacing: 6) {
            Rectangle().fill(Ink.decks[index].opacity(selected == index ? 1 : 0.3)).frame(width: 4)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(Ink.deckName(index))  \(deck.duration > 0 ? deck.title : "LOAD A TRACK")").font(Ink.font(14, bold: true)).foregroundStyle(Ink.decks[index]).lineLimit(1)
                HStack(spacing: 2) {
                    Text(deck.duration > 0 ? deck.artist : "local file").lineLimit(1)
                    Spacer(minLength: 0)
                    Text("\(Ink.clock(deck.engine.position)) -\(Ink.clock(max(0, deck.duration - deck.engine.position)))").foregroundStyle(deck.engine.playing ? Ink.play : Ink.text).lineLimit(1)
                }.font(Ink.font(10)).foregroundStyle(Ink.muted)
            }
        }.contentShape(Rectangle()).onTapGesture { selected = index; model.loadTarget = index }
        .contextMenu { Button("Import audio from Files") { fileTarget = index; files = true } }
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("deck-\(index)-info")
        .accessibilityLabel("Select \(Ink.deckName(index))")
        .accessibilityValue(deck.duration > 0 ? "\(deck.title), \(deck.artist)" : "No track loaded")
        .accessibilityAddTraits(.isButton)
    }
    private func detailWave(_ index: Int, vertical: Bool = false) -> some View {
        let deck = model.decks[index]
        return PerformanceWave(index: index, vertical: vertical)
            .overlay { if deck.duration == 0 { Text("\(Ink.deckName(index)) · no track").font(Ink.font(11)).foregroundStyle(Ink.muted) }
                else if let notice = deck.waveformNotice { Text(notice).font(Ink.font(9)).foregroundStyle(Ink.muted).padding(4) } }
            .accessibilityLabel("\(Ink.deckName(index)) detail wave")
    }
    private func minimap(_ index: Int) -> some View {
        PerformanceWave(index: index, overview: true)
    }

    private var browseKey: some View {
        Button("BROWSE") {
            #if DEBUG
            if !browsing { model.browserOpenStarted = ProcessInfo.processInfo.systemUptime }
            #endif
            withAnimation { settings = false; browsing.toggle() }
        }.buttonStyle(PerformanceKeyStyle(color: Ink.warning, active: browsing))
    }
    private var library: some View {
        LibraryBrowser(onClose: { withAnimation { browsing = false } }, onLoad: { track in
            let accepted = model.load(track, deck: model.loadTarget)
            if accepted { withAnimation { browsing = false } }
            return accepted
        })
    }
    private var mixer: some View {
        HStack(spacing: 0) {
            knobColumn(0).frame(width: 48)
            channel(0).frame(width: 42)
            VStack(spacing: 4) {
                HStack(spacing: 2) {
                    Button("QUANT") { model.quantize.toggle(); model.set(MDJQuantize, 0, model.quantize ? 1 : 0) }.buttonStyle(PerformanceKeyStyle(active: model.quantize))
                    Button("XF") { xf.toggle(); if !xf { model.crossfade = 0; model.set(MDJCrossfade, 0, 0) } }.buttonStyle(PerformanceKeyStyle(active: xf))
                }.frame(height: 36)
                HStack(spacing: 2) {
                    Button("SESSIONS · WIP") { notice = "Session replay is not implemented on iOS yet" }.buttonStyle(PerformanceKeyStyle(color: Ink.muted))
                    Button { withAnimation { browsing = false; settings.toggle() } } label: { Image(systemName: "gearshape") }.buttonStyle(PerformanceKeyStyle(color: Ink.muted)).accessibilityLabel("Settings")
                }.frame(height: 36)
                recordingBar.frame(height: 44)
                Spacer(minLength: 0)
                fxCard
                if xf { PerformanceFader(value: Binding(get: { (model.crossfade + 1) / 2 }, set: { model.crossfade = $0 * 2 - 1; model.set(MDJCrossfade, 0, model.crossfade) }), color: Ink.accent, vertical: false, label: "Crossfader").frame(height: 40) }
            }.padding(.horizontal, 3)
            channel(1).frame(width: 42)
            knobColumn(1).frame(width: 48)
        }
    }
    private func knobColumn(_ index: Int) -> some View {
        VStack(spacing: 0) {
            PerformanceKnob(label: "TRIM", color: Ink.muted, value: value(index, MDJTrim, Double(model.decks[index].engine.trim)))
            ForEach(0..<3) { i in
                let eq = model.decks[index].engine.eq
                PerformanceKnob(label: ["HI", "MID", "LOW"][i], color: Ink.bands[2 - i], value: Binding(get: { Double([eq.2, eq.1, eq.0][i]) }, set: { model.set(MDJEq, index, $0, slot: 2 - i) }), eqKillToggle: true)
            }
            PerformanceKnob(label: "FILTER", color: Ink.muted, value: Binding(get: { Double(model.decks[index].engine.filter) }, set: { model.audio?.filter(index, position: $0) }), range: -1...1, neutral: 0)
        }
    }
    private func channel(_ index: Int) -> some View {
        VStack(spacing: 2) {
            PerformanceFader(value: value(index, MDJFader, Double(model.decks[index].engine.fader)), color: Ink.decks[index], label: "\(Ink.deckName(index)) channel fader")
            Button { model.set(MDJPfl, index, model.decks[index].engine.pfl ? 0 : 1) } label: { Image(systemName: "headphones") }.buttonStyle(PerformanceKeyStyle(color: Ink.decks[index], active: model.decks[index].engine.pfl)).frame(height: 30).accessibilityLabel("\(Ink.deckName(index)) headphone cue")
        }
    }
    /// Recording belongs in the shared center panel, between channel faders.
    private var recordingBar: some View {
        HStack(spacing: 2) {
            Button { model.toggleRecording() } label: {
                HStack(spacing: 4) {
                    Image(systemName: model.recording ? "stop.fill" : "record.circle")
                    Text(model.recording ? "STOP" : "REC · WAV")
                }
            }.buttonStyle(PerformanceKeyStyle(color: model.recording ? Ink.danger : Ink.text, active: model.recording))
                .accessibilityLabel(model.recording ? "Stop master recording" : "Record master")
            Button { saved = true } label: {
                HStack(spacing: 3) { Image(systemName: "waveform.path"); Text("\(model.recordings.count)") }
            }.buttonStyle(PerformanceKeyStyle(color: Ink.muted)).frame(width: 52)
                .accessibilityLabel("Saved recordings")
        }
    }
    private var fxCard: some View {
        VStack(spacing: 2) {
            HStack(spacing: 2) {
                Button(["ECHO", "LOW CUT", "REVERB", "FLANGER", "TRANS", "ROLL"][effect]) { effect = (effect + 1) % 6; updateFX() }.buttonStyle(PerformanceKeyStyle(color: Ink.warning))
                Button(["→ A", "→ B", "→ C", "→ D", "MASTER"][fxTarget]) { fxTarget = fxTarget == 0 ? 1 : fxTarget == 1 ? 4 : 0; updateFX() }.buttonStyle(PerformanceKeyStyle(color: fxTarget < 4 ? Ink.decks[fxTarget] : Ink.accent))
            }.frame(height: 32)
            HStack(spacing: 2) {
                Button(["1/16", "1/8", "1/4", "1/2", "1", "2", "4", "8"][fxBeatIndex] + " BT") { fxBeatIndex = (fxBeatIndex + 1) % fxBeats.count; updateFX() }.buttonStyle(PerformanceKeyStyle(color: Ink.warning))
                PerformanceKnob(label: "DEPTH", color: Ink.muted, value: $fxDepth, range: -1...1, neutral: 0).frame(width: 34).onChange(of: fxDepth) { _, _ in updateFX() }
                Button(fx ? "ON" : "OFF") { fx.toggle(); updateFX() }.buttonStyle(PerformanceKeyStyle(color: Ink.warning, active: fx)).frame(width: 44)
            }.frame(height: 40)
        }.padding(3).background(Ink.warning.opacity(0.05)).overlay(RoundedRectangle(cornerRadius: 8).stroke(Ink.warning.opacity(0.4)))
    }
    private func updateFX() { model.audio?.beatFX(effect: effect, target: fxTarget, on: fx, depth: fxDepth, beats: fxBeats[fxBeatIndex]) }
    private func value(_ index: Int, _ op: MDJOp, _ current: Double) -> Binding<Double> { Binding(get: { current }, set: { model.set(op, index, $0) }) }
    private func transport(_ index: Int, browser: Bool = false) -> some View {
        let state = model.decks[index].engine
        return HStack(spacing: browser ? 4 : 0) {
            if browser { Text(Ink.deckName(index)).font(Ink.font(10, bold: true)).foregroundStyle(Ink.decks[index]).frame(width: 12) }
            HoldControl(title: "CUE", color: Ink.warning, active: state.preview && state.previewSlot == 8, enabled: state.ready, rounded: true, bare: false, compact: browser, down: { model.set(MDJCueDown, index, 0) }, up: { model.set(MDJCueUp, index, 0) })
            Button { model.play(index) } label: { Label(state.playing ? "PAUSE" : "PLAY", systemImage: state.playing ? "pause.fill" : "play.fill") }.buttonStyle(BrowserAwareTransportStyle(compact: browser, active: state.playing)).disabled(!state.ready).accessibilityLabel("\(Ink.deckName(index)) play pause")
        }
    }
    private func deckControls(_ index: Int, compact: Bool) -> some View {
        PerformanceDeckControls(index: index, pitch: Binding(get: { pitch == index }, set: { pitch = $0 ? index : nil }), compact: compact, onTransport: { AnyView(transport(index)) })
    }
}
