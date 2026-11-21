import SwiftUI
import UIKit
import ManadjCore

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

/// Relative touch rotary with Android's neutral detent and per-finger readout.
struct PerformanceKnob: View {
    let label: String
    let color: Color
    @Binding var value: Double
    var range: ClosedRange<Double> = 0...1
    var neutral: Double = 0.5
    var eqKillToggle = false
    var controlName: String? = nil
    @EnvironmentObject private var popups: KnobPopups
    @State private var id = UUID()
    @State private var interaction: KnobDragState?
    @State private var localValue: Double?
    private var name: String { controlName ?? label }
    private var normalized: Double { ((localValue ?? value) - range.lowerBound) / (range.upperBound - range.lowerBound) }
    private var center: Double { (neutral - range.lowerBound) / (range.upperBound - range.lowerBound) }
    private var readout: String {
        if eqKillToggle {
            if normalized <= 0.001 { return "KILL" }
            let db = normalized >= 0.5 ? (normalized - 0.5) * 12 : 20 * log10(normalized / 0.5)
            return String(format: "%+.1f dB", db)
        }
        if label == "TRIM" { return String(format: "%+.1f dB", (normalized - 0.5) * 24 - 6) }
        if label == "FILTER" {
            if abs(normalized - 0.5) < 0.01 { return "BYPASS" }
            return "\(normalized < 0.5 ? "LPF" : "HPF") \(Int(abs(normalized - 0.5) * 200))%"
        }
        return "\(Int(normalized * 100))%"
    }
    private func publish() {
        popups.show(id, name: name, value: normalized, neutral: center, eq: eqKillToggle,
                    color: color, readout: readout, fine: interaction?.fine == true,
                    notched: interaction?.notched == true)
    }
    var body: some View {
        VStack(spacing: 0) {
            KnobFace(value: normalized, neutral: center, eq: eqKillToggle, color: color, held: interaction != nil)
            Text(label).font(Ink.font(8, bold: true)).foregroundStyle(interaction == nil ? Ink.muted : color).frame(height: 10)
        }
        .overlay {
            KnobTouchSurface(begin: {
                popups.cancelDismissal(id)
                interaction = KnobDragState(value: normalized, neutral: center)
                publish()
            }, move: { x, y, fine in
                guard var state = interaction else { return }
                let tick = state.tick
                state.move(x: x, y: y, fine: fine)
                interaction = state
                localValue = range.lowerBound + state.value * (range.upperBound - range.lowerBound)
                value = localValue ?? value
                if state.tick != tick { UISelectionFeedbackGenerator().selectionChanged() }
                publish()
            }, end: { cancelled, doubleTap in
                if doubleTap && !cancelled {
                    value = eqKillToggle && value >= neutral / 2 ? range.lowerBound : neutral
                    localValue = value
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    publish()
                }
                interaction = nil; localValue = nil; popups.dismiss(id)
            })
        }
        .anchorPreference(key: KnobAnchorPreference.self, value: .bounds) { [id: $0] }
        .onDisappear { popups.remove(id) }
        .accessibilityElement(children: .ignore).accessibilityLabel(name + " control")
        .accessibilityIdentifier("knob-" + name)
        .accessibilityValue(readout + (abs(normalized - center) < 0.001 ? ", neutral" : ""))
        .accessibilityHint("Drag up or right to increase. Rest a second finger for fine adjustment. Double tap to reset or toggle EQ kill.")
        .accessibilityAdjustableAction { direction in
            value = min(range.upperBound, max(range.lowerBound, value + (direction == .increment ? 0.01 : -0.01) * (range.upperBound - range.lowerBound)))
        }
        .accessibilityAction(named: eqKillToggle ? "Toggle kill" : "Reset to neutral") {
            value = eqKillToggle && value >= neutral / 2 ? range.lowerBound : neutral
        }
    }
}

struct KnobFace: View {
    let value: Double
    var neutral = 0.5
    var eq = false
    let color: Color
    var held = false
    var body: some View {
        Canvas { context, size in
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let r = min(size.width, size.height) * 0.36
            let rect = CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2)
            context.fill(Path(ellipseIn: rect), with: .color(Ink.crust))
            var ring = Path()
            ring.addArc(center: center, radius: r, startAngle: .degrees(135), endAngle: .degrees(405), clockwise: false)
            context.stroke(ring, with: .color(Ink.edge), style: StrokeStyle(lineWidth: held ? 3 : 2, lineCap: .round))
            let anchor = eq ? 0 : neutral
            var fill = Path()
            fill.addArc(center: center, radius: r, startAngle: .degrees(135 + min(anchor, value) * 270), endAngle: .degrees(135 + max(anchor, value) * 270), clockwise: false)
            context.stroke(fill, with: .color(color), style: StrokeStyle(lineWidth: held ? 3 : 2, lineCap: .round))
            // A visible neutral tick complements the physical hold/escape notch.
            if neutral > 0 && neutral < 1 {
                var tick = Path()
                let a = (135 + neutral * 270) * .pi / 180
                tick.move(to: CGPoint(x: center.x + cos(a) * r * 0.92, y: center.y + sin(a) * r * 0.92))
                tick.addLine(to: CGPoint(x: center.x + cos(a) * r * 1.2, y: center.y + sin(a) * r * 1.2))
                context.stroke(tick, with: .color(abs(value - neutral) < 0.001 ? Ink.text : Ink.muted), lineWidth: 2)
            }
            let a = (135 + min(1, max(0, value)) * 270) * .pi / 180
            var needle = Path(); needle.move(to: center)
            needle.addLine(to: CGPoint(x: center.x + cos(a) * r * 0.82, y: center.y + sin(a) * r * 0.82))
            context.stroke(needle, with: .color(color), style: StrokeStyle(lineWidth: held ? 3 : 2, lineCap: .round))
        }
    }
}

private struct KnobTouchSurface: UIViewRepresentable {
    let begin: () -> Void
    let move: (Double, Double, Bool) -> Void
    let end: (Bool, Bool) -> Void
    func makeUIView(context: Context) -> KnobTouchView { KnobTouchView() }
    func updateUIView(_ view: KnobTouchView, context: Context) { view.begin = begin; view.move = move; view.end = end }
    static func dismantleUIView(_ view: KnobTouchView, coordinator: ()) { view.cancel() }
}

/// UIKit touch ownership allows another finger on this knob to be a modifier,
/// while a finger on another knob retains independent control and popup.
@MainActor private final class KnobTouchView: UIView {
    var begin: (() -> Void)?
    var move: ((Double, Double, Bool) -> Void)?
    var end: ((Bool, Bool) -> Void)?
    private var primary: UITouch?
    private var fingers = Set<UITouch>()
    private var origin = CGPoint.zero
    private var moved = false
    override init(frame: CGRect) { super.init(frame: frame); isMultipleTouchEnabled = true; backgroundColor = .clear; isAccessibilityElement = false }
    required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        fingers.formUnion(touches)
        if primary == nil, let touch = touches.first {
            primary = touch; origin = touch.location(in: self); moved = false; begin?()
        }
        update()
    }
    private func update() {
        guard let touch = primary else { return }
        let p = touch.location(in: self), x = p.x - origin.x, y = p.y - origin.y
        moved = moved || hypot(x, y) > 6
        move?(Double(x), Double(y), fingers.count > 1)
    }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) { update() }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        fingers.subtract(touches)
        if let touch = primary, touches.contains(touch) {
            end?(false, !moved && touch.tapCount == 2); primary = nil; fingers.removeAll()
        } else { update() }
    }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { cancel() }
    func cancel() { if primary != nil { end?(true, false) }; primary = nil; fingers.removeAll() }
    override func didMoveToWindow() { super.didMoveToWindow(); if window == nil { cancel() } }
}

@MainActor final class KnobPopups: ObservableObject {
    struct Entry: Identifiable {
        let id: UUID, name: String, value: Double, neutral: Double, eq: Bool, color: Color, readout: String, fine: Bool, notched: Bool
    }
    @Published var entries: [Entry] = []
    private var pending: [UUID: Task<Void, Never>] = [:]
    func cancelDismissal(_ id: UUID) { pending[id]?.cancel(); pending[id] = nil }
    func show(_ id: UUID, name: String, value: Double, neutral: Double, eq: Bool, color: Color, readout: String, fine: Bool, notched: Bool) {
        let entry = Entry(id: id, name: name, value: value, neutral: neutral, eq: eq, color: color, readout: readout, fine: fine, notched: notched)
        if let i = entries.firstIndex(where: { $0.id == id }) { entries[i] = entry } else { entries.append(entry) }
    }
    func dismiss(_ id: UUID) {
        cancelDismissal(id)
        pending[id] = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(100))
            guard !Task.isCancelled else { return }
            self?.entries.removeAll { $0.id == id }; self?.pending[id] = nil
        }
    }
    func remove(_ id: UUID) { cancelDismissal(id); entries.removeAll { $0.id == id } }
    func removeAll() { for task in pending.values { task.cancel() }; pending.removeAll(); entries = [] }
}
private struct KnobAnchorPreference: PreferenceKey {
    static let defaultValue: [UUID: Anchor<CGRect>] = [:]
    static func reduce(value: inout [UUID: Anchor<CGRect>], nextValue: () -> [UUID: Anchor<CGRect>]) { value.merge(nextValue(), uniquingKeysWith: { _, new in new }) }
}
private enum PopupAccessibilityTestSettings {
    static var enabled: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("--popup-accessibility-fixture")
        #else
        false
        #endif
    }
}
struct KnobPopupLayer: ViewModifier {
    @ObservedObject var popups: KnobPopups
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    private var reduceMotion: Bool { systemReduceMotion || PopupAccessibilityTestSettings.enabled }
    func body(content: Content) -> some View {
        content.overlayPreferenceValue(KnobAnchorPreference.self) { anchors in
            GeometryReader { geometry in
                let placed = placements(anchors: anchors, geometry: geometry)
                ForEach(popups.entries) { entry in
                    if let r = placed[entry.id] {
                        KnobPopupCard(entry: entry)
                            .frame(width: r.width, height: r.height).position(x: r.midX, y: r.midY)
                            .transition(reduceMotion ? .opacity : .scale(scale: 0.82).combined(with: .opacity))
                    }
                }
                .animation(reduceMotion ? .easeOut(duration: 0.12) : .spring(response: 0.28, dampingFraction: 0.84), value: popups.entries.map(\.id))
            }.allowsHitTesting(false).accessibilityHidden(true)
        }
    }
    private func placements(anchors: [UUID: Anchor<CGRect>], geometry: GeometryProxy) -> [UUID: CGRect] {
        var placed: [UUID: CGRect] = [:]
        let held = popups.entries.compactMap { anchors[$0.id].map { geometry[$0] } }
        let width: CGFloat = 132, height: CGFloat = 154, margin: CGFloat = 6
        for entry in popups.entries {
            guard let anchor = anchors[entry.id] else { continue }
            let a = geometry[anchor]
            let right = a.maxX + 10, left = a.minX - 10 - width
            let sides = a.midX < geometry.size.width / 2 ? [right, left] : [left, right]
            let candidates = [CGFloat(0), 1, -1, 2, -2].flatMap { row in sides.map { x in
                CGRect(x: max(margin, min(geometry.size.width - width - margin, x)),
                       y: max(margin, min(geometry.size.height - height - margin, a.midY - height / 2 + row * (height + margin))), width: width, height: height)
            } }
            let r = candidates.first { r in !held.contains { $0.intersects(r) } && !placed.values.contains { $0.intersects(r) } } ?? candidates[0]
            placed[entry.id] = r
        }
        return placed
    }
}
private struct KnobPopupCard: View {
    let entry: KnobPopups.Entry
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: 22, style: .continuous) }
    var body: some View {
        VStack(spacing: 0) {
            Text(entry.name + (entry.fine ? " · FINE" : "")).font(Ink.font(11, bold: true)).foregroundStyle(entry.color).lineLimit(1).minimumScaleFactor(0.75)
            KnobFace(value: entry.value, neutral: entry.neutral, eq: entry.eq, color: entry.color, held: true).frame(width: 84, height: 84)
            Text(entry.readout).font(Ink.font(16, bold: true)).monospacedDigit().foregroundStyle(Ink.text)
            Text(entry.notched ? "NEUTRAL" : entry.fine ? "FINE ADJUST" : "UP / RIGHT +").font(Ink.font(8, bold: true)).foregroundStyle(entry.notched ? entry.color : Ink.muted).padding(.top, 4)
        }.padding(10).frame(maxWidth: .infinity, maxHeight: .infinity)
            .modifier(KnobPopupMaterial(opaque: reduceTransparency || contrast == .increased || PopupAccessibilityTestSettings.enabled))
            .overlay(shape.stroke(entry.color.opacity(contrast == .increased || PopupAccessibilityTestSettings.enabled ? 1 : 0.7), lineWidth: contrast == .increased || PopupAccessibilityTestSettings.enabled ? 2 : 1))
            .shadow(color: .black.opacity(0.45), radius: 12, y: 5)
    }
}
private struct KnobPopupMaterial: ViewModifier {
    let opaque: Bool
    @ViewBuilder func body(content: Content) -> some View {
        if opaque { content.background(Ink.panel, in: RoundedRectangle(cornerRadius: 22)) }
        else {
            #if compiler(>=6.2)
            if #available(iOS 26.0, *) { content.glassEffect(.regular, in: RoundedRectangle(cornerRadius: 22)) }
            else { content.background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22)) }
            #else
            content.background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22))
            #endif
        }
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

/// Real device state, not a decorative percentage. Unknown stays unknown.
struct PerformanceBattery: View {
    @State private var level: Float = UIDevice.current.batteryLevel
    @State private var charging = UIDevice.current.batteryState == .charging || UIDevice.current.batteryState == .full
    private func refresh() {
        level = UIDevice.current.batteryLevel
        charging = UIDevice.current.batteryState == .charging || UIDevice.current.batteryState == .full
    }
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: charging ? "battery.100percent.bolt" : level < 0 ? "battery.0percent" : level < 0.2 ? "battery.25percent" : level < 0.6 ? "battery.50percent" : "battery.100percent")
            Text(level < 0 ? "--" : "\(Int((level * 100).rounded()))%")
        }.font(Ink.font(9)).foregroundStyle(level >= 0 && level < 0.2 ? Ink.danger : Ink.muted)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(level < 0 ? "Battery level unavailable" : "Battery \(Int((level * 100).rounded())) percent" + (charging ? ", charging" : ""))
            .accessibilityIdentifier("performance-battery")
            .onAppear { UIDevice.current.isBatteryMonitoringEnabled = true; refresh() }
            .onReceive(NotificationCenter.default.publisher(for: UIDevice.batteryLevelDidChangeNotification)) { _ in refresh() }
            .onReceive(NotificationCenter.default.publisher(for: UIDevice.batteryStateDidChangeNotification)) { _ in refresh() }
    }
}
