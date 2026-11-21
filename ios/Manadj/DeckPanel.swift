import SwiftUI
import CEngine

struct DeckPanel: View {
    @EnvironmentObject var model: AppModel
    let index: Int
    var onLoad: () -> Void
    @State private var showMixer = false
    @State private var erasePads = false
    @State private var jump = 4.0
    private var deck: DeckViewState { model.decks[index] }
    private var color: Color { Ink.decks[index] }
    private var state: MDJDeck { deck.engine }
    private func hotCue(_ slot: Int) -> Double {
        var cues = state.hotCues
        return withUnsafeBytes(of: &cues) { $0.bindMemory(to: Double.self)[slot] }
    }
    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Text(Ink.deckName(index)).font(Ink.font(24, bold: true)).foregroundStyle(color).frame(width: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(deck.title).font(Ink.font(16, bold: true)).lineLimit(1)
                    Text(deck.artist).font(Ink.font(11)).foregroundStyle(Ink.muted).lineLimit(1)
                }.frame(maxWidth: .infinity, alignment: .leading)
                Button(action: onLoad) { Image(systemName: "arrow.down.to.line").accessibilityLabel("Load deck \(Ink.deckName(index))") }
                    .buttonStyle(FlatButtonStyle(color: color))
            }
            HStack {
                Text(Ink.clock(state.position)).font(Ink.font(24, bold: true)).monospacedDigit()
                Spacer()
                VStack(alignment: .trailing) {
                    Text(state.bpm > 0 ? String(format: "%.2f BPM", state.bpm * (1 + Double(state.pitch) / 100)) : "NO BPM").foregroundStyle(color)
                    Text("−\(Ink.clock(max(0, deck.duration - state.position)))  \(deck.track?.keyOpenKey ?? "--")").foregroundStyle(Ink.muted)
                }.font(Ink.font(12))
            }
            if state.keyLock && !state.fullyDecoded {
                Text("KEY LOCK UNAVAILABLE · STREAMING VARISPEED").font(Ink.font(9)).foregroundStyle(Ink.warning)
            }
            WaveformView(waveform: deck.waveform, progress: deck.duration > 0 ? state.position / deck.duration : 0, color: color)
                .frame(height: 48)
                .overlay(Rectangle().stroke(Ink.edge))
                .overlay { if deck.loading { ProgressView().tint(color) } }

            if deck.duration > 0 {
                Slider(value: Binding(get: { min(deck.duration, max(0, state.position)) }, set: { model.set(MDJSeek, index, $0) }), in: 0...max(0.01, deck.duration))
                    .tint(color).accessibilityLabel("Deck \(Ink.deckName(index)) playhead")
            }
            HStack(spacing: 8) {
                Button("PADS") { showMixer = false }.buttonStyle(FlatButtonStyle(color: color, active: !showMixer))
                Button("MIX") { showMixer = true }.buttonStyle(FlatButtonStyle(color: color, active: showMixer))
                Spacer(minLength: 0)
                if !showMixer { Button(erasePads ? "DONE" : "CLEAR") { erasePads.toggle() }.buttonStyle(FlatButtonStyle(color: erasePads ? Ink.danger : Ink.muted, active: erasePads)) }
            }
            if showMixer { mixer } else { pads }
            HStack(spacing: 8) {
                HoldControl(title: "CUE", color: Ink.cue, active: state.preview && state.previewSlot == 8, enabled: state.ready && !deck.loading, down: {
                    model.set(MDJCueDown, index, 0)
                }, up: { model.set(MDJCueUp, index, 0) }, canLatch: { let live = model.audio?.state(index); return live?.preview == true && live?.previewSlot == 8 }, latch: { model.set(MDJPlay, index, 0) }).frame(height: 52)
                Button { model.play(index) } label: {
                    Label(state.playing ? "PAUSE" : "PLAY", systemImage: state.playing ? "pause.fill" : "play.fill").frame(maxWidth: .infinity)
                }.buttonStyle(FlatButtonStyle(color: Ink.play, active: state.playing)).disabled(!state.ready || deck.loading)
                Button { model.set(MDJKeyLock, index, state.keyLock ? 0 : 1) } label: {
                    Image(systemName: "lock.fill").accessibilityLabel("Key lock").accessibilityValue(state.keyLock ? "On" : "Off")
                }.buttonStyle(FlatButtonStyle(color: color, active: state.keyLock))
            }
            HStack(spacing: 8) {
                HoldControl(title: "BEND −", color: color, down: { model.set(MDJBend, index, -4) }, up: { model.set(MDJBend, index, 0) }).frame(height: 44)
                Slider(value: Binding(get: { Double(state.pitch) }, set: { model.set(MDJPitch, index, $0) }), in: -8...8).tint(color).accessibilityLabel("Tempo percent")
                Button(String(format: "%+.1f%%", state.pitch)) { model.set(MDJPitch, index, 0) }.font(Ink.font(12)).foregroundStyle(color).frame(minWidth: 52, minHeight: 44).accessibilityHint("Reset tempo")
                HoldControl(title: "BEND +", color: color, down: { model.set(MDJBend, index, 4) }, up: { model.set(MDJBend, index, 0) }).frame(height: 44)
            }
        }
        .padding(12)
        .background(Ink.panel)
        .overlay(Rectangle().stroke(color.opacity(0.7), lineWidth: 1))
    }
    private var pads: some View {
        VStack(spacing: 8) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                ForEach(0..<8) { slot in
                    let cue = hotCue(slot)
                    HoldControl(title: "\(slot + 1)\(cue >= 0 ? " ·" : "")", color: erasePads ? Ink.danger : Ink.cues[slot], active: cue >= 0 && state.preview && state.previewSlot == slot, enabled: state.ready && !deck.loading, down: {
                        if erasePads { model.set(MDJHotCueClear, index, 0, slot: slot) }
                        else { model.set(cue < 0 ? MDJHotCueSet : MDJHotCueDown, index, 0, slot: slot) }
                    }, up: { model.set(MDJHotCueUp, index, 0, slot: slot) }, canLatch: { let live = model.audio?.state(index); return !erasePads && live?.preview == true && live?.previewSlot == slot }, latch: { model.set(MDJPlay, index, 0) }).frame(height: 44)
                        .accessibilityLabel("Hot cue \(slot + 1), \(cue >= 0 ? Ink.clock(cue) : "empty")")
                }
            }
            HStack(spacing: 6) {
                Button("◀ \(Int(jump))") { model.set(MDJBeatJump, index, -jump) }.buttonStyle(FlatButtonStyle(color: color))
                Menu("JUMP") { ForEach([1, 2, 4, 8, 16, 32, 64, 128], id: \.self) { n in Button("\(n) beats") { jump = Double(n) } } }.font(Ink.font(11)).frame(minWidth: 44, minHeight: 44)
                Button("\(Int(jump)) ▶") { model.set(MDJBeatJump, index, jump) }.buttonStyle(FlatButtonStyle(color: color))
            }
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                Button("½") { model.set(MDJLoopResize, index, 0, slot: 0) }.buttonStyle(FlatButtonStyle(color: color))
                Button("⟳ \(Int(state.loopBeats))") { model.set(MDJLoopToggle, index, 0) }.buttonStyle(FlatButtonStyle(color: color, active: state.loopActive))
                Button("2×") { model.set(MDJLoopResize, index, 0, slot: 1) }.buttonStyle(FlatButtonStyle(color: color))
            }.disabled(state.bpm <= 0 || !state.ready)
        }
    }
    private var mixer: some View {
        VStack(spacing: 0) {
            let eq = [Double(state.eq.0), Double(state.eq.1), Double(state.eq.2)]
            ForEach(0..<3) { band in
                HStack {
                    Text(["LOW", "MID", "HI"][band]).font(Ink.font(11)).frame(width: 40, alignment: .leading)
                    Slider(value: Binding(get: { eq[band] }, set: { model.set(MDJEq, index, $0, slot: band) }), in: 0...1).tint(Ink.bands[band]).accessibilityLabel(["Low EQ", "Mid EQ", "High EQ"][band])
                    Button("0") { model.set(MDJEq, index, 0.5, slot: band) }.frame(minWidth: 44, minHeight: 36).accessibilityLabel("Reset EQ")
                }
            }
            HStack {
                Text("FILTER").font(Ink.font(11)).frame(width: 40, alignment: .leading)
                Slider(value: Binding(get: { Double(state.filter) }, set: { model.audio?.filter(index, position: $0) }), in: -1...1).tint(Ink.cue).accessibilityLabel("Filter")
                Button("0") { model.audio?.filter(index, position: 0) }.frame(minWidth: 44, minHeight: 36).accessibilityLabel("Reset filter")
            }
            HStack {
                Text("FADER").font(Ink.font(11)).frame(width: 40, alignment: .leading)
                Slider(value: Binding(get: { Double(state.fader) }, set: { model.set(MDJFader, index, $0) }), in: 0...1).tint(color).accessibilityLabel("Channel fader")
                Button("PFL") { model.set(MDJPfl, index, state.pfl ? 0 : 1) }.buttonStyle(FlatButtonStyle(color: color, active: state.pfl)).accessibilityLabel("Headphone cue")
            }
        }
    }
}
