import SwiftUI
import AVFoundation
import AVKit
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
    @StateObject private var feedback = LiveFeedbackSession()
    @State private var outputRoute = AVAudioSession.sharedInstance().currentRoute
    @State private var browsing = false
    @State private var browserDrag: CGFloat = 0
    @State private var feedbackRequested = false
    @State private var feedbackTargets: [FeedbackTarget] = []
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
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification)) { _ in outputRoute = AVAudioSession.sharedInstance().currentRoute }
        .onChange(of: browsing) { _, value in model.noteFeedbackAction(value ? "browser-open" : "browser-close") }
        .onChange(of: settings) { _, value in model.noteFeedbackAction(value ? "settings-open" : "settings-close") }
        .onPreferenceChange(FeedbackTargetPreference.self) { feedbackTargets = $0 }
        .feedbackReporter(model: model, session: feedback, browsing: browsing, settings: settings, requested: $feedbackRequested, targets: feedbackTargets,
                          autoPresent: ProcessInfo.processInfo.arguments.contains("--feedback-ui-fixture"))
    }
    private var portraitBody: some View {
        GeometryReader { geometry in
            let compact = geometry.size.height < 860
            let gap: CGFloat = compact ? 3 : 8
            let infoHeight: CGFloat = compact ? 36 : 44
            let deckHeight: CGFloat = compact ? 316 : 360
            let mixerFloor: CGFloat = feedback.active ? 302 : 284
            // Budget real row heights rather than letting the deck's minimum
            // overflow the viewport. Only waveform height yields on standard phones.
            let waveHeight: CGFloat = compact ? max(36, min(83, geometry.size.height - infoHeight - deckHeight - 36 - gap * 5 - mixerFloor)) : 135
            VStack(spacing: gap) {
                HStack(spacing: 10) { deckInfo(0); deckInfo(1) }.frame(height: browsing && keyboardOpen ? 36 : infoHeight)
                if !(browsing && keyboardOpen) { VStack(spacing: 3) { detailWave(0); detailWave(1) }.frame(height: waveHeight) }
                ZStack(alignment: .bottom) {
                    // Keep native waveform/display-link identity alive under the drawer.
                    // Removing the whole tree discarded tiles and restarted its clocks.
                    VStack(spacing: gap) {
                        mixer.frame(maxHeight: .infinity)
                        HStack(spacing: 6) { minimap(0); browseKey.frame(width: 84); minimap(1) }.frame(height: compact ? 36 : 44)
                        HStack(alignment: .top, spacing: 14) { deckControls(0, compact: compact); deckControls(1, compact: compact) }.frame(height: deckHeight)
                    }.opacity(settings || browsing ? 0 : 1)
                        .allowsHitTesting(!settings && !browsing)
                        .accessibilityHidden(settings || browsing)
                    if browsing {
                        VStack(spacing: 0) {
                            if !keyboardOpen { Capsule().fill(Ink.muted.opacity(0.7)).frame(width: 40, height: 4).frame(maxWidth: .infinity).frame(height: 24).contentShape(Rectangle())
                                .gesture(browserDrawerDrag(height: geometry.size.height))
                                .accessibilityIdentifier("browser-drag-handle")
                                .accessibilityLabel("Close browser drag handle") }
                            if feedback.active { LiveFeedbackToolbar(session: feedback, model: model).frame(maxWidth: 300) }
                            library
                            HStack(spacing: 12) { transport(0, browser: true); transport(1, browser: true) }.frame(height: 44).padding(.horizontal, 6).background(Ink.panel)
                        }.background(Ink.base).compositingGroup().offset(y: browserDrag).transition(.move(edge: .bottom))
                            .accessibilityElement(children: .contain).accessibilityIdentifier("browser-drawer")
                    }
                    if settings {
                        VStack(spacing: 0) {
                            HStack { Text("SETTINGS").font(Ink.font(14, bold: true)); Spacer(); Button("CLOSE") { settings = false }.buttonStyle(PerformanceKeyStyle()).frame(width: 75, height: 38) }
                            if feedback.active { LiveFeedbackToolbar(session: feedback, model: model).frame(maxWidth: 300) }
                            SettingsView()
                        }.background(Ink.base).transition(.move(edge: .bottom))
                    }
                }.clipped()
            }.frame(height: geometry.size.height, alignment: .top).padding(.horizontal, 8)
            .animation(.spring(response: 0.3, dampingFraction: 0.9), value: browsing)
            .onChange(of: browsing) { _, _ in browserDrag = 0 }
            .animation(.easeOut(duration: 0.24), value: settings)
        }
    }
    private func browserDrawerDrag(height: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 6, coordinateSpace: .global)
            .onChanged { value in
                // Direct manipulation has no easing. The entire browser,
                // including its real scrolling list, travels under the finger.
                var transaction = Transaction(); transaction.disablesAnimations = true
                withTransaction(transaction) { browserDrag = max(0, value.translation.height) }
            }
            .onEnded { value in
                let close = browserDrag > min(180, height * 0.25)
                    || (browserDrag > 60 && value.predictedEndTranslation.height > height * 0.5)
                withAnimation(.spring(response: 0.3, dampingFraction: 0.9)) {
                    browsing = !close; browserDrag = 0
                }
            }
    }
    private var feedbackButton: some View {
        Button { feedbackRequested = true } label: {
            Image(systemName: "bubble.left.and.text.bubble.right")
                .font(.system(size: 13, weight: .medium)).frame(maxWidth: .infinity, minHeight: 28)
        }.buttonStyle(.plain).foregroundStyle(Ink.accent)
            .accessibilityLabel("Feedback").accessibilityIdentifier("feedback-open")
            .feedbackTarget("Feedback button")
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
                if browsing { VStack { if feedback.active { LiveFeedbackToolbar(session: feedback, model: model).frame(maxWidth: 300) }; library; browseKey.frame(height: 36) }.frame(width: geometry.size.width * 0.6).background(Ink.base) }
                if settings { VStack { Button("CLOSE SETTINGS") { settings = false }; if feedback.active { LiveFeedbackToolbar(session: feedback, model: model).frame(maxWidth: 300) }; SettingsView() }.frame(width: geometry.size.width * 0.6).background(Ink.base) }
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
        .feedbackTarget("Deck \(Ink.deckName(index)) track info")
        .accessibilityAddTraits(.isButton)
    }
    private func detailWave(_ index: Int, vertical: Bool = false) -> some View {
        let deck = model.decks[index]
        return PerformanceWave(index: index, vertical: vertical)
            .overlay { if deck.duration == 0 { Text("\(Ink.deckName(index)) · no track").font(Ink.font(11)).foregroundStyle(Ink.muted) }
                else if let notice = deck.waveformNotice { Text(notice).font(Ink.font(9)).foregroundStyle(Ink.muted).padding(4) } }
            .accessibilityLabel("\(Ink.deckName(index)) detail wave").feedbackTarget("Deck \(Ink.deckName(index)) waveform")
    }
    private func minimap(_ index: Int) -> some View {
        PerformanceWave(index: index, overview: true).feedbackTarget("Deck \(Ink.deckName(index)) overview")
    }

    private var browseKey: some View {
        Button("BROWSE") {
            #if DEBUG
            if !browsing { model.browserOpenStarted = ProcessInfo.processInfo.systemUptime }
            #endif
            withAnimation { settings = false; browsing.toggle() }
        }.accessibilityIdentifier("browser-open").buttonStyle(PerformanceKeyStyle(color: Ink.warning, active: browsing)).feedbackTarget("Browse library")
    }
    private var library: some View {
        LibraryBrowser(onClose: { withAnimation { browsing = false } }, onLoad: { track in
            let accepted = model.load(track, deck: model.loadTarget)
            if accepted { withAnimation { browsing = false } }
            return accepted
        })
    }
    @ViewBuilder private var centerModePicker: some View {
        if ProcessInfo.processInfo.arguments.contains("--plain-center-tabs") { plainCenterTabs }
        else { nativeCenterModePicker }
    }
    private var plainCenterTabs: some View {
HStack(spacing: 0) {
                    ForEach(["FX", "FEEDBACK", "AUDIO", "SYNC"], id: \.self) { tab in
                        Button {
                            if tab == "FEEDBACK" { feedback.open() }
                            else { feedback.contextual = tab == "AUDIO" ? "OUTPUT" : tab }
                        } label: {
                            Image(systemName: tab == "FX" ? "sparkles" : tab == "FEEDBACK" ? "bubble.left.and.text.bubble.right" : tab == "AUDIO" ? outputSymbol : "desktopcomputer").font(.system(size: 14)).frame(maxWidth: .infinity, minHeight: 44)
                                .background((feedback.contextual == tab || (tab == "AUDIO" && feedback.contextual == "OUTPUT")) ? Ink.accent.opacity(0.15) : .clear)
                                .overlay(alignment: .bottom) { Rectangle().fill((feedback.contextual == tab || (tab == "AUDIO" && feedback.contextual == "OUTPUT")) ? Ink.accent : Ink.edge).frame(height: 2) }
                        }.buttonStyle(.plain).accessibilityLabel(tab == "FEEDBACK" ? "Feedback" : tab.capitalized).accessibilityIdentifier(tab == "FEEDBACK" ? "feedback-open" : "center-tab-" + tab.lowercased())
                    }
                }.foregroundStyle(Ink.accent)
    }
    private var nativeCenterModePicker: some View {
        Picker("Center controls", selection: Binding(get: {
            feedback.contextual == "OUTPUT" ? "AUDIO" : (["FX", "FEEDBACK", "SYNC"].contains(feedback.contextual) ? feedback.contextual : "FX")
        }, set: { tab in
            if tab == "FEEDBACK" { feedback.open() }
            else { feedback.contextual = tab == "AUDIO" ? "OUTPUT" : tab }
        })) {
            ForEach(["FX", "FEEDBACK", "AUDIO", "SYNC"], id: \.self) { tab in
                Image(systemName: tab == "FX" ? "sparkles" : tab == "FEEDBACK" ? "bubble.left.and.text.bubble.right" : tab == "AUDIO" ? outputSymbol : "desktopcomputer")
                    .accessibilityLabel(tab == "FEEDBACK" ? "Feedback" : tab.capitalized)
                    .accessibilityIdentifier(tab == "FEEDBACK" ? "feedback-open" : "center-tab-" + tab.lowercased())
                    .tag(tab)
            }
        }.pickerStyle(.segmented).tint(Ink.accent).frame(minHeight: 44)
            .accessibilityIdentifier("center-mode-picker")
    }
    private var mixer: some View {
        HStack(spacing: 0) {
            knobColumn(0).frame(width: 48)
            channel(0).frame(width: 42)
            VStack(spacing: 4) {
                HStack(spacing: 5) {
                    HStack(spacing: 0) {
                        Button("QUANT") { model.quantize.toggle(); model.set(MDJQuantize, 0, model.quantize ? 1 : 0) }.buttonStyle(PerformanceKeyStyle(active: model.quantize)).feedbackTarget("Quantize")
                        Button { feedback.contextual = feedback.contextual == "HEARD" ? "FX" : "HEARD" } label: { Image(systemName: "slider.horizontal.3").font(.system(size: 10)) }.buttonStyle(PerformanceKeyStyle(color: Ink.muted)).frame(width: 44).disabled(feedback.active).accessibilityLabel("Heard quantization settings")
                    }.overlay(Capsule().stroke(Ink.edge, lineWidth: 1))
                    Button("XF") { xf.toggle(); if !xf { model.crossfade = 0; model.set(MDJCrossfade, 0, 0) } }.buttonStyle(PerformanceKeyStyle(active: xf)).frame(width: 44)
                    Button { model.waveTouchLock.toggle() } label: { Image(systemName: model.waveTouchLock ? "lock.fill" : "lock.open") }.buttonStyle(PerformanceKeyStyle(active: model.waveTouchLock)).frame(width: 44)
                        .accessibilityLabel("Lock playing waveform touch").accessibilityIdentifier("wave-touch-lock").accessibilityValue(model.waveTouchLock ? "Locked while playing" : "Unlocked")
                }.frame(height: 44)
                HStack(spacing: 4) {
                    Button("SESSIONS") { notice = "Session replay is not implemented on iOS yet" }.buttonStyle(PerformanceKeyStyle(color: Ink.muted))
                    Button { withAnimation { browsing = false; settings.toggle() } } label: { Image(systemName: "gearshape") }.buttonStyle(PerformanceKeyStyle(color: Ink.muted)).frame(width: 44).accessibilityLabel("Settings").feedbackTarget("Settings")
                }.frame(height: 44)
                recordingBar.frame(height: 44)
                Spacer(minLength: 0)
                centerModePicker
                if feedback.contextual == "FEEDBACK" { LiveFeedbackToolbar(session: feedback, model: model) }
                else if feedback.contextual == "SYNC" { SettingsView(syncOnly: true).frame(height: 160).accessibilityIdentifier("center-sync-panel") }
                else if feedback.contextual == "OUTPUT" { outputContext }
                else if feedback.contextual == "HEARD" { heardContext }
                else { fxCard }
                if xf { PerformanceFader(value: Binding(get: { (model.crossfade + 1) / 2 }, set: { model.crossfade = $0 * 2 - 1; model.set(MDJCrossfade, 0, model.crossfade) }), color: Ink.accent, vertical: false, label: "Crossfader").frame(height: 40).feedbackTarget("Crossfader") }
            }.padding(.horizontal, 3)
            channel(1).frame(width: 42)
            knobColumn(1).frame(width: 48)
        }
    }
    private func knobColumn(_ index: Int) -> some View {
        VStack(spacing: 0) {
            PerformanceKnob(label: "TRIM", color: Ink.muted, value: value(index, MDJTrim, Double(model.decks[index].engine.trim))).feedbackTarget("Deck \(Ink.deckName(index)) trim")
            ForEach(0..<3) { i in
                let eq = model.decks[index].engine.eq
                PerformanceKnob(label: ["HI", "MID", "LOW"][i], color: Ink.bands[2 - i], value: Binding(get: { Double([eq.2, eq.1, eq.0][i]) }, set: { model.set(MDJEq, index, $0, slot: 2 - i) }), eqKillToggle: true).feedbackTarget("Deck \(Ink.deckName(index)) \(["HI", "MID", "LOW"][i]) EQ")
            }
            PerformanceKnob(label: "FILTER", color: Ink.muted, value: Binding(get: { Double(model.decks[index].engine.filter) }, set: { model.filter(index, position: $0) }), range: -1...1, neutral: 0).feedbackTarget("Deck \(Ink.deckName(index)) filter")
        }
    }
    private func channel(_ index: Int) -> some View {
        VStack(spacing: 2) {
            PerformanceFader(value: value(index, MDJFader, Double(model.decks[index].engine.fader)), color: Ink.decks[index], label: "\(Ink.deckName(index)) channel fader").feedbackTarget("Deck \(Ink.deckName(index)) volume fader")
            Button { model.set(MDJPfl, index, model.decks[index].engine.pfl ? 0 : 1) } label: { Image(systemName: "headphones") }.buttonStyle(PerformanceKeyStyle(color: Ink.decks[index], active: model.decks[index].engine.pfl)).frame(height: 30).accessibilityLabel("\(Ink.deckName(index)) headphone cue").feedbackTarget("Deck \(Ink.deckName(index)) headphone cue")
        }
    }
    /// Recording belongs in the shared center panel, between channel faders.
    private var recordingBar: some View {
        HStack(spacing: 4) {
            Spacer(minLength: 0)
            Button { model.toggleRecording() } label: {
                HStack(spacing: 4) {
                    Image(systemName: model.recording ? "stop.fill" : "record.circle")
                    Text(model.recording ? "STOP" : "REC")
                }
            }.buttonStyle(PerformanceKeyStyle(color: model.recording ? Ink.danger : Ink.text, active: model.recording)).frame(width: 70)
                .accessibilityLabel(model.recording ? "Stop master recording" : "Record master")
            Button { saved = true } label: {
                HStack(spacing: 3) { Image(systemName: "waveform.path"); Text("\(model.recordings.count)") }
            }.buttonStyle(PerformanceKeyStyle(color: Ink.muted)).frame(width: 52)
                .accessibilityLabel("Saved recordings")
            Spacer(minLength: 0)
        }
    }
    private var outputDescription: String { outputRoute.outputs.map(\.portName).joined(separator: ", ") }
    private var outputSymbol: String {
        guard let output = outputRoute.outputs.first else { return "speaker.slash" }
        switch output.portType {
        case .builtInSpeaker: return "iphone.gen3.radiowaves.left.and.right"
        case .headphones: return "headphones"
        case .bluetoothA2DP, .bluetoothHFP, .bluetoothLE: return "antenna.radiowaves.left.and.right"
        case .usbAudio, .lineOut, .HDMI: return "cable.connector"
        default: return "speaker.wave.2"
        }
    }
    private var outputContext: some View {
        VStack(spacing: 4) {
            HStack { Text("OUTPUT"); Spacer(); Button("×") { feedback.contextual = "FX" } }.font(Ink.font(11, bold: true))
            Text(outputDescription.isEmpty ? "No output route" : outputDescription).font(Ink.font(10)).lineLimit(2)
            NativeRoutePicker().frame(height: 28).accessibilityLabel("Choose system audio output")
            Toggle("SPLIT MONO", isOn: $model.splitOutput).font(Ink.font(9)).onChange(of: model.splitOutput) { _, on in model.noteFeedbackAction("split-mono", value: on ? 1 : 0); model.audio?.splitOutput(on) }
            Text("L master / R cue. DJ splitter needed.").font(Ink.font(8)).foregroundStyle(Ink.muted)
        }.padding(5).background(Ink.panel).onReceive(NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification)) { _ in outputRoute = AVAudioSession.sharedInstance().currentRoute }
    }
    private var heardContext: some View {
        VStack(spacing: 5) {
            HStack { Text("HEARD"); Spacer(); Button("×") { feedback.contextual = "FX" } }.font(Ink.font(11, bold: true))
            Text("Heard-latency calibration isn't implemented on iOS yet. Quantize still uses the engine timeline.").font(Ink.font(10)).foregroundStyle(Ink.warning)
        }.padding(5).background(Ink.panel)
    }
    private var fxCard: some View {
        VStack(spacing: 2) {
            HStack(spacing: 2) {
                Button(["ECHO", "LOW CUT", "REVERB", "FLANGER", "TRANS", "ROLL"][effect]) { effect = (effect + 1) % 6; updateFX() }.buttonStyle(PerformanceKeyStyle(color: Ink.warning))
                Button(["→ A", "→ B", "→ C", "→ D", "MASTER"][fxTarget]) { fxTarget = fxTarget == 0 ? 1 : fxTarget == 1 ? 4 : 0; updateFX() }.buttonStyle(PerformanceKeyStyle(color: fxTarget < 4 ? Ink.decks[fxTarget] : Ink.accent))
            }.frame(height: 32)
            HStack(spacing: 2) {
                Button(["1/16", "1/8", "1/4", "1/2", "1", "2", "4", "8"][fxBeatIndex] + " BT") { fxBeatIndex = (fxBeatIndex + 1) % fxBeats.count; updateFX() }.buttonStyle(PerformanceKeyStyle(color: Ink.warning))
                PerformanceKnob(label: "DEPTH", color: Ink.muted, value: $fxDepth, range: -1...1, neutral: 0).feedbackTarget("Beat FX depth").frame(width: 34).onChange(of: fxDepth) { _, _ in updateFX() }
                Button(fx ? "ON" : "OFF") { fx.toggle(); updateFX() }.buttonStyle(PerformanceKeyStyle(color: Ink.warning, active: fx)).frame(width: 44)
            }.frame(height: 40)
        }.padding(3).background(Ink.warning.opacity(0.05)).overlay(RoundedRectangle(cornerRadius: 8).stroke(Ink.warning.opacity(0.4)))
    }
    private func updateFX() { model.noteFeedbackAction("beat-fx", value: fxDepth, slot: effect); model.noteFeedbackAction("beat-fx-enabled", value: fx ? 1 : 0, slot: fxTarget); model.noteFeedbackAction("beat-fx-beats", value: fxBeats[fxBeatIndex]); model.audio?.beatFX(effect: effect, target: fxTarget, on: fx, depth: fxDepth, beats: fxBeats[fxBeatIndex]) }
    private func value(_ index: Int, _ op: MDJOp, _ current: Double) -> Binding<Double> { Binding(get: { current }, set: { model.set(op, index, $0) }) }
    private func transport(_ index: Int, browser: Bool = false) -> some View {
        let state = model.decks[index].engine
        return HStack(spacing: browser ? 4 : 0) {
            if browser { Text(Ink.deckName(index)).font(Ink.font(10, bold: true)).foregroundStyle(Ink.decks[index]).frame(width: 12) }
            HoldControl(title: "CUE", color: Ink.warning, active: state.preview && state.previewSlot == 8, enabled: state.ready, rounded: true, bare: false, compact: browser, down: { model.set(MDJCueDown, index, 0) }, up: { model.set(MDJCueUp, index, 0) }, canLatch: { let live = model.audio?.state(index); return live?.preview == true && live?.previewSlot == 8 }, latch: { model.set(MDJPlay, index, 0) }).accessibilityIdentifier("deck-\(index)-cue-hold").feedbackTarget("Deck \(Ink.deckName(index)) cue")
            Button { model.play(index) } label: { Label(state.playing ? "PAUSE" : "PLAY", systemImage: state.playing ? "pause.fill" : "play.fill") }.buttonStyle(BrowserAwareTransportStyle(compact: browser, active: state.playing)).disabled(!state.ready).accessibilityLabel("\(Ink.deckName(index)) play pause").feedbackTarget("Deck \(Ink.deckName(index)) play pause")
        }
    }
    private func deckControls(_ index: Int, compact: Bool) -> some View {
        PerformanceDeckControls(index: index, pitch: Binding(get: { pitch == index }, set: { pitch = $0 ? index : nil }), compact: compact, onTransport: { AnyView(transport(index)) })
    }
}

private struct NativeRoutePicker: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView { let view = AVRoutePickerView(); view.tintColor = .white; return view }
    func updateUIView(_ view: AVRoutePickerView, context: Context) {}
}
