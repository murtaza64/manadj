import SwiftUI

/// manaDJ semantic palette, projected from DESIGN.md and frontend theme tokens.
enum Ink {
    static let base = Color.black
    static let panel = Color(hex: 0x080a0c)
    static let crust = Color(hex: 0x111111)
    static let edge = Color(hex: 0x313136)
    static let text = Color(hex: 0xcdd6f4)
    static let muted = Color(hex: 0xa6adc8)
    static let accent = Color(hex: 0x4a9eff)
    static let play = Color(hex: 0x00e676)
    static let warning = Color(hex: 0xffcc00)
    static let danger = Color(hex: 0xff2d55)
    static let cue = Color(hex: 0xff9500)
    static let playhead = Color(hex: 0xf5c2e7)
    static let decks = [0x00e5ff, 0xff2d95, 0xff7a00, 0x8f4dff].map(Color.init(hex:))
    static let cues = [0x1e90ff, 0xffd400, 0xff8800, 0xff4455, 0x2ed573, 0xff5cc8, 0xa855f7, 0x00cec9].map(Color.init(hex:))
    static let bands = [Color(red: 1, green: 0.1, blue: 0.1), Color(red: 0, green: 1, blue: 0.25), Color(red: 0.2, green: 0.45, blue: 1)]
    static func font(_ size: CGFloat = 14, bold: Bool = false) -> Font { .custom(bold ? "UbuntuMono-Bold" : "UbuntuMono-Regular", size: size, relativeTo: .body) }
    static func deckName(_ index: Int) -> String { ["A", "B", "C", "D"][index] }
    static func clock(_ seconds: Double) -> String {
        guard seconds.isFinite else { return "--:--" }
        let s = Int(abs(seconds))
        return "\(seconds <= -1 ? "-" : "")\(s / 60):\(String(format: "%02d", s % 60))"
    }
}
extension Color {
    init(hex: Int) { self.init(red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255) }
}

struct FlatButtonStyle: ButtonStyle {
    var color: Color = Ink.accent
    var active = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Ink.font(14, bold: true))
            .foregroundStyle(active || configuration.isPressed ? Ink.base : color)
            .frame(minWidth: 44, minHeight: 44)
            .padding(.horizontal, 8)
            .background(active || configuration.isPressed ? color : Ink.panel)
            .overlay(Rectangle().stroke(color, lineWidth: 1))
            .contentShape(Rectangle())
    }
}

struct SectionLabel: View {
    let title: String
    var body: some View { Text(title).font(Ink.font(12, bold: true)).foregroundStyle(Ink.muted).frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8) }
}

/// Downsampled from actual MWF1 data only. An empty state never invents a waveform.
struct WaveformView: View {
    let waveform: ManadjCore.PreviewWaveform?
    var progress: Double = 0
    var color: Color = Ink.accent
    var body: some View {
        Canvas { context, size in
            guard let waveform, !waveform.peaks.isEmpty else { return }
            let width = max(1, Int(size.width / 2))
            for x in 0..<width {
                let from = x * waveform.peaks.count / width
                let to = max(from + 1, (x + 1) * waveform.peaks.count / width)
                var amp = 0.0
                for i in from..<min(to, waveform.peaks.count) { amp = max(amp, waveform.amplitude(i)) }
                let height = max(1, amp * size.height)
                let rect = CGRect(x: CGFloat(x) * 2, y: (size.height - height) / 2, width: 1.5, height: height)
                context.fill(Path(rect), with: .color(color.opacity(0.65)))
            }
            let x = min(1, max(0, progress)) * size.width
            var head = Path(); head.move(to: CGPoint(x: x, y: 0)); head.addLine(to: CGPoint(x: x, y: size.height))
            context.stroke(head, with: .color(Ink.playhead), lineWidth: 2)
        }
        .background(Ink.base)
        .overlay { if waveform == nil { Text("NO CACHED WAVEFORM").font(Ink.font(11)).foregroundStyle(Ink.muted) } }
        .accessibilityLabel("Track overview waveform")
        .accessibilityValue("\(Int(min(1, max(0, progress)) * 100)) percent")
    }
}
import ManadjCore
