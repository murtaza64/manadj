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
    private func canLatchHotCue(_ slot: Int) -> Bool {
        guard !shift, let live = model.audio?.state(index) else { return false }
        return live.preview && live.previewSlot == Int32(slot)
    }
    private func hotCuePad(_ slot: Int) -> some View {
        let time = cue(slot)
        return HoldControl(
            title: "\(slot + 1)\n\(time < 0 ? "SET" : Ink.clock(time))",
            color: Ink.cues[slot], active: state.preview && state.previewSlot == Int32(slot),
            enabled: state.ready, marked: time >= 0,
            down: { model.set(shift ? MDJHotCueClear : time < 0 ? MDJHotCueSet : MDJHotCueDown, index, 0, slot: slot) },
            up: { model.set(MDJHotCueUp, index, 0, slot: slot) },
            canLatch: { canLatchHotCue(slot) }, latch: { model.set(MDJPlay, index, 0) }
        ).accessibilityIdentifier("deck-\(index)-hotcue-\(slot)")
            .padding(3).accessibilityLabel("\(Ink.deckName(index)) hotcue \(slot + 1)")
    }
    var body: some View {
        GeometryReader { geometry in
            let padHeight: CGFloat = compact ? 80 : 104
            let row = max(CGFloat(22), (geometry.size.height - padHeight - 60) / 5)
            VStack(spacing: 4) {
                HStack(spacing: 0) {
                    if index == 0 { shiftKey }
                    Text("STEMS · WIP").font(Ink.font(8, bold: true)).foregroundStyle(Ink.muted.opacity(0.6)).frame(maxWidth: .infinity)
                    if index == 1 { shiftKey }
                }.frame(height: 24).accessibilityLabel("Stem controls unavailable on iOS")
                VStack(spacing: 0) {
                    ForEach(0..<2) { r in
                        HStack(spacing: 0) {
                            ForEach(0..<4) { c in
                                let slot = r * 4 + c
                                hotCuePad(slot)
                            }
                        }
                    }
                }.frame(height: compact ? 80 : 104)
                HStack(spacing: 0) {
                    Button("÷2") { model.set(MDJLoopResize, index, 0, slot: 0) }.frame(maxWidth: 40)
                    Rectangle().fill(color.opacity(0.5)).frame(width: 1).padding(.vertical, 10)
                    Button("⟲ LOOP \(Int(state.loopBeats))") { model.set(MDJLoopToggle, index, 0) }
                    Rectangle().fill(color.opacity(0.5)).frame(width: 1).padding(.vertical, 10)
                    Button("2×") { model.set(MDJLoopResize, index, 0, slot: 1) }.frame(maxWidth: 40)
                }.buttonStyle(PerformanceStripStyle(color: color)).background(state.loopActive ? color.opacity(0.15) : Color.clear).clipShape(Capsule()).overlay(Capsule().stroke(color.opacity(0.7), lineWidth: 1.5)).padding(3).frame(height: row).disabled(!state.ready || state.bpm <= 0)
                HStack(spacing: 0) {
                    Button("◀◀") { model.set(MDJBeatJump, index, -jump) }.frame(maxWidth: 40)
                    Rectangle().fill(color.opacity(0.5)).frame(width: 1).padding(.vertical, 10)
                    Button("JUMP \(Int(jump))") { jump = jump >= 64 ? 1 : jump * 2 }
                    Rectangle().fill(color.opacity(0.5)).frame(width: 1).padding(.vertical, 10)
                    Button("▶▶") { model.set(MDJBeatJump, index, jump) }.frame(maxWidth: 40)
                }.buttonStyle(PerformanceStripStyle(color: color)).clipShape(Capsule()).overlay(Capsule().stroke(color.opacity(0.7), lineWidth: 1.5)).padding(3).frame(height: row).disabled(!state.ready)
                onTransport().frame(height: row + 8)
                PerformanceBend(color: color, enabled: state.ready, value: Double(state.bend)) { model.set(MDJBend, index, $0) }.frame(height: row)
                Button { withAnimation(.easeOut(duration: 0.24)) { pitch.toggle() } } label: {
                    VStack(spacing: 0) {
                        Capsule().fill(color).frame(width: 28, height: 3).padding(.top, 3)
                        HStack(alignment: .center) {
                            Text(String(format: "%+.2f%%", state.pitch)).font(Ink.font(13, bold: true)).foregroundStyle(state.pitch == 0 ? Ink.text : color)
                            Spacer(minLength: 0)
                            VStack(alignment: .trailing, spacing: 0) {
                                Text(state.bpm > 0 ? String(format: "%.1f", state.bpm * (1 + Double(state.pitch) / 100)) : "-- BPM").font(Ink.font(10, bold: true)).foregroundStyle(Ink.accent)
                                Text((state.keyLock ? "▣ KEY " : "KEY ") + (model.decks[index].track?.keyOpenKey ?? "--")).font(Ink.font(8)).foregroundStyle(Ink.muted)
                            }
                        }.padding(.horizontal, 7).frame(maxHeight: .infinity)
                    }.background(Ink.panel).clipShape(UnevenRoundedRectangle(topLeadingRadius: 12, topTrailingRadius: 12))
                        .overlay(UnevenRoundedRectangle(topLeadingRadius: 12, topTrailingRadius: 12).stroke(color.opacity(0.6), lineWidth: 1.5)).padding(2)
                }.buttonStyle(.plain).frame(height: row).accessibilityLabel("\(Ink.deckName(index)) PITCH panel")

            }
            .overlay {
                if pitch {
                    VStack(spacing: 5) {
                        Capsule().fill(color).frame(width: 36, height: 3).frame(height: 10)
                        HStack(spacing: 4) {
                            Text(String(format: "%+.2f%%", state.pitch)).font(Ink.font(18, bold: true))
                            Spacer(minLength: 0)
                            Text(state.bpm > 0 ? String(format: "%.2f", state.bpm * (1 + Double(state.pitch) / 100)) : "--").font(Ink.font(10, bold: true))
                            Button("×") { withAnimation(.easeOut(duration: 0.24)) { pitch = false } }.font(Ink.font(24)).frame(width: 36, height: 36).accessibilityLabel("Close pitch panel")
                        }.foregroundStyle(color).frame(height: 36)
                        HStack(spacing: 0) {
                            Button(state.keyLock ? "KEY ON" : "KEY OFF") { model.set(MDJKeyLock, index, state.keyLock ? 0 : 1) }.buttonStyle(PerformanceKeyStyle(color: color, active: state.keyLock))
                            Button(model.syncStatuses[index] == .outOfLock ? "OUT OF LOCK" : model.syncStatuses[index] == .waiting ? "WAITING" : "SYNC") { model.toggleTempoSync(index) }.buttonStyle(PerformanceKeyStyle(color: color, active: model.syncStatuses[index] != .off)).disabled(model.liveListening || (!state.ready && model.syncStatuses[index] == .off)).accessibilityLabel("\(Ink.deckName(index)) tempo sync").accessibilityValue(model.syncStatuses[index].rawValue).accessibilityHint("Join or leave the tempo group. Quantize aligns phase once.")
                            Button("0") { model.set(MDJPitch, index, 0) }.buttonStyle(PerformanceKeyStyle(color: color)).frame(width: 36).accessibilityLabel("Reset pitch")
                        }.frame(height: 38)
                        HStack(spacing: 6) {
                            PerformanceFader(value: Binding(get: { (Double(state.pitch) + 8) / 16 }, set: { model.set(MDJPitch, index, $0 * 16 - 8) }), color: color, doubleTapCenter: true, label: "\(Ink.deckName(index)) pitch fader").frame(width: 52)
                            VStack(spacing: 8) {
                                Spacer(minLength: 0)
                                Image(systemName: "hand.draw").font(.system(size: 26)).foregroundStyle(Ink.muted)
                                Text("SCRATCH\nNOT YET AVAILABLE").font(Ink.font(9, bold: true)).foregroundStyle(Ink.muted).multilineTextAlignment(.center)
                                Spacer(minLength: 0)
                            }.frame(maxWidth: .infinity, maxHeight: .infinity).overlay(RoundedRectangle(cornerRadius: 10).stroke(Ink.edge))
                        }.frame(maxHeight: .infinity)
                        Button("RESET 0.00%") { model.set(MDJPitch, index, 0) }.buttonStyle(PerformanceKeyStyle(color: color)).frame(height: 36)
                    }.padding(.horizontal, 6).padding(.bottom, 6).frame(width: geometry.size.width, height: geometry.size.height)
                        .background(Color.black).clipShape(UnevenRoundedRectangle(topLeadingRadius: 14, topTrailingRadius: 14))
                        .overlay(UnevenRoundedRectangle(topLeadingRadius: 14, topTrailingRadius: 14).stroke(color.opacity(0.75), lineWidth: 1.5))
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }.clipped()
        }.frame(minHeight: compact ? 316 : 360)
    }
}
