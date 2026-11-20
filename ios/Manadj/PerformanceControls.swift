import SwiftUI
import UIKit

/// Rounded 3-point inset body follows Android PILL key geometry. Native hit testing remains local.
struct PerformanceKeyStyle: ButtonStyle {
    var color: Color = Ink.accent
    var active = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(Ink.font(12, bold: true)).lineLimit(1).minimumScaleFactor(0.75)
            .foregroundStyle(color).frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Capsule().fill(active || configuration.isPressed ? color.opacity(0.2) : Ink.panel))
            .overlay(Capsule().stroke(color.opacity(active || configuration.isPressed ? 1 : 0.6), lineWidth: 1.5))
            .padding(3).contentShape(Rectangle()).scaleEffect(configuration.isPressed ? 0.93 : 1)
            .animation(reduceMotion ? nil : configuration.isPressed ? .linear(duration: 0) : .interpolatingSpring(stiffness: 900, damping: 20), value: configuration.isPressed)
            .sensoryFeedback(.selection, trigger: configuration.isPressed) { _, new in new }
    }
}

/// Relative drag, not absolute tap-to-value. A new gesture starts from the current value.
struct PerformanceKnob: View {
    let label: String
    let color: Color
    @Binding var value: Double
    var range: ClosedRange<Double> = 0...1
    var neutral: Double = 0.5
    var eqKillToggle = false
    @State private var start: Double?
    @State private var horizontal: Bool?
    @State private var lastValue = 0.0
    @State private var localValue: Double?
    private var fraction: Double { ((localValue ?? value) - range.lowerBound) / (range.upperBound - range.lowerBound) }
    var body: some View {
        VStack(spacing: 0) {
            Canvas { context, size in draw(context: context, size: size) }
            Text(label).font(Ink.font(8, bold: true)).foregroundStyle(Ink.muted).frame(height: 10)
        }.contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 0).onChanged { drag in
            if start == nil { start = value; lastValue = value }
            if horizontal == nil && hypot(drag.translation.width, drag.translation.height) > 6 { horizontal = abs(drag.translation.width) > abs(drag.translation.height) }
            guard let horizontal else { return }
            let delta = Double(horizontal ? drag.translation.width : -drag.translation.height) / 264
            var next = min(range.upperBound, max(range.lowerBound, (start ?? value) + delta * (range.upperBound - range.lowerBound)))
            if (lastValue - neutral) * (next - neutral) < 0 { next = neutral; UISelectionFeedbackGenerator().selectionChanged() }
            lastValue = next; localValue = next; value = next
        }.onEnded { _ in start = nil; horizontal = nil; localValue = nil })
        .simultaneousGesture(TapGesture(count: 2).onEnded { value = eqKillToggle && value >= neutral / 2 ? range.lowerBound : neutral; UIImpactFeedbackGenerator(style: .medium).impactOccurred() })
        .accessibilityElement().accessibilityLabel(label + " control").accessibilityValue(String(format: "%.2f", value))
        .accessibilityAdjustableAction { direction in value = min(range.upperBound, max(range.lowerBound, value + (direction == .increment ? 0.01 : -0.01))) }
    }
    private func draw(context: GraphicsContext, size: CGSize) {
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let radius: CGFloat = min(size.width, size.height) * 0.36
        let rect = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
        context.fill(Path(ellipseIn: rect), with: .color(Ink.crust))
        var arc = Path()
        arc.addArc(center: center, radius: radius, startAngle: .degrees(135), endAngle: .degrees(405), clockwise: false)
        context.stroke(arc, with: .color(Ink.edge), style: StrokeStyle(lineWidth: 2, lineCap: .round))
        let anchor = eqKillToggle ? 0 : (neutral - range.lowerBound) / (range.upperBound - range.lowerBound)
        let from = min(anchor, fraction), to = max(anchor, fraction)
        var filled = Path()
        filled.addArc(center: center, radius: radius, startAngle: .degrees(135 + from * 270), endAngle: .degrees(135 + to * 270), clockwise: false)
        context.stroke(filled, with: .color(color), style: StrokeStyle(lineWidth: 2, lineCap: .round))
        let angle: Double = (135.0 + min(1.0, max(0.0, fraction)) * 270.0) * Double.pi / 180.0
        let dx: CGFloat = CGFloat(cos(angle)) * radius * 0.82
        let dy: CGFloat = CGFloat(sin(angle)) * radius * 0.82
        var needle = Path()
        needle.move(to: center)
        needle.addLine(to: CGPoint(x: center.x + dx, y: center.y + dy))
        context.stroke(needle, with: .color(color), style: StrokeStyle(lineWidth: 2, lineCap: .round))
    }

}

struct PerformanceFader: View {
    @Binding var value: Double
    var color: Color
    var vertical = true
    var doubleTapCenter = false
    var label = "Channel fader"
    @State private var grab: CGFloat?
    @State private var dragValue: Double?
    @State private var held = false
    private var shown: Double { dragValue ?? value }
    var body: some View {
        GeometryReader { geometry in
            Canvas { context, size in
                let x = vertical ? size.width / 2 : CGFloat(shown) * (size.width - 44) + 22
                let y = vertical ? (1 - CGFloat(shown)) * (size.height - 36) + 18 : size.height / 2
                var rail = Path()
                rail.move(to: vertical ? CGPoint(x: x, y: 18) : CGPoint(x: 22, y: y))
                rail.addLine(to: vertical ? CGPoint(x: x, y: size.height - 18) : CGPoint(x: size.width - 22, y: y))
                context.stroke(rail, with: .color(Ink.edge), lineWidth: 4)
                if !vertical {
                    var middle = Path(); middle.move(to: CGPoint(x: size.width / 2, y: y - 9)); middle.addLine(to: CGPoint(x: size.width / 2, y: y + 9))
                    context.stroke(middle, with: .color(Ink.muted), lineWidth: 1.5)
                }
                if vertical {
                    var fill = Path(); fill.move(to: CGPoint(x: x, y: size.height - 18)); fill.addLine(to: CGPoint(x: x, y: y))
                    context.stroke(fill, with: .color(color.opacity(0.35 + 0.4 * shown)), lineWidth: 3)
                }
                if vertical {
                    var ticks = Path()
                    for i in 0...8 {
                        let yy = 18 + (size.height - 36) * CGFloat(i) / 8
                        ticks.move(to: CGPoint(x: x - 12, y: yy)); ticks.addLine(to: CGPoint(x: x - 7, y: yy))
                        ticks.move(to: CGPoint(x: x + 7, y: yy)); ticks.addLine(to: CGPoint(x: x + 12, y: yy))
                    }
                    context.stroke(ticks, with: .color(Ink.edge), lineWidth: 1)
                }
                let width = vertical ? min(size.width - 4, 40) : 44
                let rect = CGRect(x: x - width / 2, y: y - (vertical ? 11 : 15), width: width, height: vertical ? 22 : 30)
                context.fill(Path(roundedRect: rect, cornerRadius: 3), with: .color(Ink.crust))
                context.stroke(Path(roundedRect: rect, cornerRadius: 3), with: .color(color.opacity(held ? 1 : 0.85)), lineWidth: held ? 2 : 1.5)
                var line = Path(); line.move(to: CGPoint(x: x - width * 0.4, y: y)); line.addLine(to: CGPoint(x: x + width * 0.4, y: y))
                context.stroke(line, with: .color(color), lineWidth: 2)
            }.contentShape(Rectangle()).gesture(DragGesture(minimumDistance: 0).onChanged { drag in
                let low: CGFloat = vertical ? 18 : 22
                let length = max(1, vertical ? geometry.size.height - 36 : geometry.size.width - 44)
                let coordinate = vertical ? drag.location.y : drag.location.x
                if grab == nil {
                    held = true; UISelectionFeedbackGenerator().selectionChanged()
                    let origin = vertical ? drag.startLocation.y : drag.startLocation.x
                    let thumb = low + length * CGFloat(vertical ? 1 - value : value)
                    grab = abs(origin - thumb) <= (vertical ? 16 : 24) ? origin - thumb : 0
                }
                if (!vertical || doubleTapCenter) && hypot(drag.translation.width, drag.translation.height) < 5 { return }
                let fraction = Double((coordinate - (grab ?? 0) - low) / length)
                let next = min(1, max(0, vertical ? 1 - fraction : fraction))
                dragValue = next; value = next
            }.onEnded { _ in grab = nil; held = false; dragValue = nil })
            .simultaneousGesture(TapGesture(count: 2).onEnded { if !vertical || doubleTapCenter { value = 0.5; UISelectionFeedbackGenerator().selectionChanged() } })
        }.animation(.easeOut(duration: held ? 0.06 : 0.3), value: held)
        .accessibilityElement().accessibilityLabel(label).accessibilityValue("\(Int(value * 100)) percent")
        .accessibilityAdjustableAction { direction in value = min(1, max(0, value + (direction == .increment ? 0.05 : -0.05))) }
    }
}

/// Android strip groups actions inside one capsule. The individual hit regions remain distinct.
struct PerformanceStripStyle: ButtonStyle {
    var color: Color
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(Ink.font(12, bold: true)).lineLimit(1).minimumScaleFactor(0.65)
            .foregroundStyle(color).frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(configuration.isPressed ? color.opacity(0.2) : Color.clear)
            .contentShape(Rectangle()).sensoryFeedback(.selection, trigger: configuration.isPressed) { _, new in new }
    }
}

/// Browser-only transport treatment. Performance controls keep their original geometry.
struct BrowserAwareTransportStyle: ButtonStyle {
    var compact: Bool
    var active: Bool
    @ViewBuilder func makeBody(configuration: Configuration) -> some View {
        if compact {
            configuration.label.font(Ink.font(11, bold: true)).foregroundStyle(Ink.play)
                .frame(maxWidth: .infinity).frame(height: 44)
                .background(active || configuration.isPressed ? Ink.play.opacity(0.15) : Color.clear, in: Capsule())
                .overlay(Capsule().stroke(Ink.play.opacity(0.85), lineWidth: 1.5))
                .frame(height: 44).contentShape(Rectangle())
        } else {
            PerformanceKeyStyle(color: Ink.play, active: active).makeBody(configuration: configuration)
        }
    }
}
