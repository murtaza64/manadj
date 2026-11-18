import SwiftUI
import CEngine

struct PerformanceDeckControls: View {
    @EnvironmentObject var model: AppModel
    let index: Int
    @Binding var pitch: Bool
    let compact: Bool
    let onTransport: () -> AnyView
    @State private var jump = 32.0
    @State private var shift = false
    private var state: MDJDeck { model.decks[index].engine }
    private var color: Color { Ink.decks[index] }
    private func cue(_ slot: Int) -> Double { var data = state.hotCues; return withUnsafeBytes(of: &data) { $0.bindMemory(to: Double.self)[slot] } }
    private var shiftKey: some View {
        Button("SHIFT") { shift.toggle() }.buttonStyle(PerformanceKeyStyle(color: Ink.warning, active: shift)).frame(width: 46)
    }
    var body: some View {
        GeometryReader { geometry in
            let padHeight: CGFloat = compact ? 80 : 104
            let row = max(CGFloat(22), (geometry.size.height - padHeight - 60) / 5)
            VStack(spacing: 4) {
                HStack(spacing: 0) {
                    if index == 0 { shiftKey }
                    ForEach(0..<4) { i in
                        Text(["VOC", "DRM", "BAS", "OTH"][i]).font(Ink.font(8, bold: true)).foregroundStyle(Ink.muted.opacity(0.4)).frame(maxWidth: .infinity)
                    }
                    if index == 1 { shiftKey }
                }.frame(height: 24).accessibilityLabel("Stem controls unavailable on iOS")
                VStack(spacing: 0) {
                    ForEach(0..<2) { r in
                        HStack(spacing: 0) {
                            ForEach(0..<4) { c in
                                let slot = r * 4 + c
                                HoldControl(title: "\(slot + 1)\n\(cue(slot) < 0 ? "SET" : Ink.clock(cue(slot)))", color: Ink.cues[slot], active: state.preview && state.previewSlot == slot, enabled: state.ready, down: {
                                    model.set(shift ? MDJHotCueClear : cue(slot) < 0 ? MDJHotCueSet : MDJHotCueDown, index, 0, slot: slot)
                                }, up: { model.set(MDJHotCueUp, index, 0, slot: slot) }).padding(3).accessibilityLabel("\(Ink.deckName(index)) hotcue \(slot + 1)")
                            }
                        }
                    }
                }.frame(height: compact ? 80 : 104)
                HStack(spacing: 0) {
                    Button("½") { model.set(MDJLoopResize, index, 0, slot: 0) }
                    Button("⟳ LOOP \(Int(state.loopBeats))") { model.set(MDJLoopToggle, index, 0) }
                    Button("2×") { model.set(MDJLoopResize, index, 0, slot: 1) }
                }.buttonStyle(PerformanceKeyStyle(color: color, active: state.loopActive)).frame(height: row).disabled(!state.ready || state.bpm <= 0)
                HStack(spacing: 0) {
                    Button("◀") { model.set(MDJBeatJump, index, -jump) }
                    Button("JUMP \(Int(jump))") { jump = jump >= 64 ? 1 : jump * 2 }
                    Button("▶") { model.set(MDJBeatJump, index, jump) }
                }.buttonStyle(PerformanceKeyStyle(color: color)).frame(height: row).disabled(!state.ready)
                onTransport().frame(height: row + 8)
                HStack(spacing: 0) {
                    HoldControl(title: "−", color: color, enabled: state.ready, down: { model.set(MDJBend, index, -4) }, up: { model.set(MDJBend, index, 0) }).padding(3)
                    Text("BEND").font(Ink.font(9)).foregroundStyle(color).frame(maxWidth: .infinity)
                    HoldControl(title: "+", color: color, enabled: state.ready, down: { model.set(MDJBend, index, 4) }, up: { model.set(MDJBend, index, 0) }).padding(3)
                }.frame(height: row)
                Button(String(format: "PITCH  %+.2f%%", state.pitch)) { withAnimation(.easeOut(duration: 0.24)) { pitch.toggle() } }.buttonStyle(PerformanceKeyStyle(color: color, active: pitch)).frame(height: row)
            }
            .overlay {
                if pitch {
                    VStack(spacing: 8) {
                        HStack { Text("\(Ink.deckName(index)) · PITCH").font(Ink.font(13, bold: true)); Spacer(); Button("×") { pitch = false }.font(Ink.font(22)) }.foregroundStyle(color).frame(height: 36)
                        Text(state.bpm > 0 ? String(format: "%.2f BPM", state.bpm * (1 + Double(state.pitch) / 100)) : "NO BPM").font(Ink.font(18, bold: true)).foregroundStyle(color)
                        PerformanceFader(value: Binding(get: { (Double(state.pitch) + 8) / 16 }, set: { model.set(MDJPitch, index, $0 * 16 - 8) }), color: color, label: "\(Ink.deckName(index)) pitch fader")
                        Button("RESET 0.00%") { model.set(MDJPitch, index, 0) }.buttonStyle(PerformanceKeyStyle(color: color)).frame(height: 36)
                        Button(state.keyLock ? "KEY LOCK ON" : "KEY LOCK OFF") { model.set(MDJKeyLock, index, state.keyLock ? 0 : 1) }.buttonStyle(PerformanceKeyStyle(color: color, active: state.keyLock)).frame(height: 36)
                    }.padding(4).background(Ink.base).transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }.clipped()
        }.frame(minHeight: compact ? 316 : 360)
    }
}
