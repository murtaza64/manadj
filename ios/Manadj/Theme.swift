import SwiftUI
import UIKit

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
    var background: Color = Ink.base
    var body: some View {
        Canvas { context, size in
            guard let waveform, !waveform.peaks.isEmpty else { return }
            let width = max(1, Int(size.width / 2))
            for x in 0..<width {
                let from = x * waveform.peaks.count / width
                let to = max(from + 1, (x + 1) * waveform.peaks.count / width)
                var amp = 0.0
                for i in from..<min(to, waveform.peaks.count) { amp = max(amp, waveform.amplitude(i)) }
                let height = max(CGFloat(1), CGFloat(amp) * size.height)
                let rect = CGRect(x: CGFloat(x) * 2, y: (size.height - height) / 2, width: 1.5, height: height)
                context.fill(Path(rect), with: .color(color.opacity(0.65)))
            }
            let x = CGFloat(min(1.0, max(0.0, progress))) * size.width
            var head = Path(); head.move(to: CGPoint(x: x, y: 0)); head.addLine(to: CGPoint(x: x, y: size.height))
            context.stroke(head, with: .color(Ink.playhead), lineWidth: 2)
        }
        .background(background)

        .accessibilityLabel("Track overview waveform")
        .accessibilityValue("\(Int(min(1, max(0, progress)) * 100)) percent")
    }
}
import ManadjCore

/// Browser substrate is a cached retina raster of spectral groups, not the
/// generic peak outline/playhead used for transport overviews.
struct LibraryPreviewWave: View {
    let waveform: ManadjCore.PreviewWaveform
    let track: ManadjCore.LibraryTrack
    let styleJSON: String?
    let revision: Int
    @Environment(\.displayScale) private var scale
    @State private var raster: UIImage?
    private var key: String { "\(track.id)|\(track.previewRev ?? "")|\(revision)|\(scale)|\(styleJSON ?? "default")" }
    var body: some View {
        ZStack {
            if waveform.nBands != 8 || waveform.bandFrames == 0 {
                WaveformView(waveform: waveform, color: Ink.accent, background: .clear)
                    .accessibilityLabel("Peak preview, spectral data unavailable")
            } else if let raster { Image(uiImage: raster).resizable().interpolation(.none) }
            Canvas { context, size in drawCues(context: context, size: size) }
        }.frame(width: 110, height: 19)
            .task(id: key) { raster = BrowserPreviewRaster.shared.image(key: key, wave: waveform, json: styleJSON, scale: scale) }
            .accessibilityLabel("Spectral track preview and saved hotcues")
    }
    private func cueColor(slot: Int, hex: String?) -> Color {
        guard let hex, let rgb = ManadjCore.parseHexColor(hex) else { return Ink.cues[slot] }
        let red = Double((rgb >> 16) & 255) / 255.0
        let green = Double((rgb >> 8) & 255) / 255.0
        let blue = Double(rgb & 255) / 255.0
        return Color(red: red, green: green, blue: blue)
    }
    private func drawCues(context: GraphicsContext, size: CGSize) {
        let duration: Double = waveform.durationSecs > 0 ? waveform.durationSecs : (track.durationSecs ?? 0)
        guard duration > 0 else { return }
        for cue in track.hotCues {
            guard cue.slot >= 0, cue.slot < Ink.cues.count, cue.time.isFinite, cue.time >= 0, cue.time <= duration else { continue }
            let x = min(size.width - 3, CGFloat(cue.time / duration) * size.width)
            let color = cueColor(slot: cue.slot, hex: cue.color)
            context.fill(Path(CGRect(x: x, y: 0, width: 1, height: size.height)), with: .color(color))
            context.fill(Path(CGRect(x: x, y: 0, width: 3, height: 3)), with: .color(color))
        }
    }
}

@MainActor final class BrowserPreviewRaster {
    static let shared = BrowserPreviewRaster()
    private let cache = NSCache<NSString, UIImage>()
    private init() { cache.countLimit = 128; cache.totalCostLimit = 8 * 1024 * 1024 }
    func image(key: String, wave: ManadjCore.PreviewWaveform, json: String?, scale: CGFloat) -> UIImage {
        if let image = cache.object(forKey: key as NSString) { return image }
        let scale = max(1, scale), width = 110, height = 19
        let style = ManadjCore.BrowserPreviewStyle(json: json)
        let columns = style.columns(wave, count: Int(CGFloat(width) * scale))
        let format = UIGraphicsImageRendererFormat(); format.scale = scale; format.opaque = false
        let image = UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format).image { renderer in
            let c = renderer.cgContext; c.setShouldAntialias(false); c.setLineWidth(1 / scale)
            for (x, groups) in columns.enumerated() {
                for value in groups.sorted(by: >) where value > 0.002 {
                    guard let rgb = style.color(groups: groups, amplitude: max(0, value - 0.000001)) else { continue }
                    c.setStrokeColor(UIColor(red: rgb[0], green: rgb[1], blue: rgb[2], alpha: 1).cgColor)
                    let center = CGFloat(height) / 2, size = CGFloat(value) * center, along = (CGFloat(x) + 0.5) / scale
                    c.move(to: CGPoint(x: along, y: center - size)); c.addLine(to: CGPoint(x: along, y: center + size)); c.strokePath()
                }
            }
        }
        cache.setObject(image, forKey: key as NSString, cost: Int(image.size.width * image.size.height * scale * scale * 4))
        return image
    }
}
