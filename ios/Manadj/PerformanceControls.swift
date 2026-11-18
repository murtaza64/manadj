import SwiftUI

/// Rounded 3-point inset body follows Android PILL key geometry. Native hit testing remains local.
struct PerformanceKeyStyle: ButtonStyle {
    var color: Color = Ink.accent
    var active = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(Ink.font(11, bold: true)).lineLimit(1).minimumScaleFactor(0.75)
            .foregroundStyle(color).frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Capsule().fill(active || configuration.isPressed ? color.opacity(0.2) : Ink.panel))
            .overlay(Capsule().stroke(color.opacity(active || configuration.isPressed ? 1 : 0.5), lineWidth: 1))
            .padding(3).contentShape(Rectangle()).scaleEffect(configuration.isPressed ? 0.96 : 1)
    }
}

/// Relative drag, not absolute tap-to-value. A new gesture starts from the current value.
struct PerformanceKnob: View {
    let label: String
    let color: Color
    @Binding var value: Double
    var range: ClosedRange<Double> = 0...1
    var neutral: Double = 0.5
    @State private var start: Double?
    private var fraction: Double { (value - range.lowerBound) / (range.upperBound - range.lowerBound) }
    var body: some View {
        VStack(spacing: 0) {
            Text(label).font(Ink.font(9, bold: true)).foregroundStyle(Ink.muted)
            Canvas { context, size in draw(context: context, size: size) }
        }.contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 0).onChanged { drag in
            if start == nil { start = value }
            let delta = Double(-drag.translation.height + drag.translation.width * 0.25) / 180
            value = min(range.upperBound, max(range.lowerBound, (start ?? value) + delta * (range.upperBound - range.lowerBound)))
        }.onEnded { _ in start = nil })
        .simultaneousGesture(TapGesture(count: 2).onEnded { value = neutral })
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
    var label = "Channel fader"
    @State private var start: Double?
    var body: some View {
        GeometryReader { geometry in
            Canvas { context, size in
                let x = vertical ? size.width / 2 : CGFloat(value) * (size.width - 22) + 11
                let y = vertical ? (1 - CGFloat(value)) * (size.height - 28) + 14 : size.height / 2
                var rail = Path()
                rail.move(to: vertical ? CGPoint(x: x, y: 12) : CGPoint(x: 11, y: y))
                rail.addLine(to: vertical ? CGPoint(x: x, y: size.height - 12) : CGPoint(x: size.width - 11, y: y))
                context.stroke(rail, with: .color(Ink.edge), lineWidth: 3)
                let rect = vertical ? CGRect(x: x - 15, y: y - 9, width: 30, height: 18) : CGRect(x: x - 9, y: y - 15, width: 18, height: 30)
                context.fill(Path(roundedRect: rect, cornerRadius: 3), with: .color(Ink.crust))
                context.stroke(Path(roundedRect: rect, cornerRadius: 3), with: .color(color), lineWidth: 1)
                var line = Path(); line.move(to: vertical ? CGPoint(x: x - 13, y: y) : CGPoint(x: x, y: y - 13)); line.addLine(to: vertical ? CGPoint(x: x + 13, y: y) : CGPoint(x: x, y: y + 13))
                context.stroke(line, with: .color(color), lineWidth: 2)
            }.contentShape(Rectangle()).gesture(DragGesture(minimumDistance: 0).onChanged { drag in
                if start == nil { start = value }
                let length = max(1, vertical ? geometry.size.height - 28 : geometry.size.width - 22)
                let delta = (vertical ? -drag.translation.height : drag.translation.width) / length
                value = min(1, max(0, (start ?? value) + Double(delta)))
            }.onEnded { _ in start = nil })
        }.accessibilityElement().accessibilityLabel(label).accessibilityValue("\(Int(value * 100)) percent")
        .accessibilityAdjustableAction { direction in value = min(1, max(0, value + (direction == .increment ? 0.05 : -0.05))) }
    }
}
