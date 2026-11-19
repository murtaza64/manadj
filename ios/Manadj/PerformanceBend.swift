import SwiftUI
import UIKit

/// Android BendStrip: touch chooses ±2%, horizontal travel adds 8% per120pt; release/cancel resets.
struct PerformanceBend: UIViewRepresentable {
    var color: Color
    var enabled: Bool
    var value: Double
    var change: (Double) -> Void
    func makeUIView(context: Context) -> BendView { BendView() }
    func updateUIView(_ view: BendView, context: Context) {
        view.ink = UIColor(color); view.isUserInteractionEnabled = enabled; view.alpha = enabled ? 1 : 0.4
        view.value = value; view.change = change; view.setNeedsDisplay()
    }
    static func dismantleUIView(_ view: BendView, coordinator: ()) { view.change?(0) }
}
final class BendView: UIView {
    var ink = UIColor.cyan
    var value = 0.0
    var change: ((Double) -> Void)?
    private var origin: CGFloat = 0
    private var start = 0.0
    override init(frame: CGRect) { super.init(frame: frame); isOpaque = false; isAccessibilityElement = true; accessibilityLabel = "Momentary pitch bend"; accessibilityTraits = .button }
    required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }
    override func accessibilityActivate() -> Bool {
        update(2)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in self?.update(0) }
        return true
    }
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let point = touches.first?.location(in: self) else { return }
        origin = point.x; start = point.x < bounds.midX ? -2 : 2
        UISelectionFeedbackGenerator().selectionChanged(); update(start)
    }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let point = touches.first?.location(in: self) else { return }
        update(min(8, max(-8, start + Double(point.x - origin) / 120 * 8)))
    }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) { update(0) }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { update(0) }
    private func update(_ amount: Double) { value = amount; change?(amount); accessibilityValue = String(format: "%+.1f percent", amount); setNeedsDisplay() }
    override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext() else { return }
        let y = bounds.midY, width = bounds.width - 20
        context.setStrokeColor(ink.withAlphaComponent(0.3).cgColor); context.setLineWidth(1)
        context.move(to: CGPoint(x: 10, y: y)); context.addLine(to: CGPoint(x: bounds.width - 10, y: y))
        for i in -4...4 { let x = bounds.midX + CGFloat(i) * width / 9; let h: CGFloat = i == 0 ? 8 : 4; context.move(to: CGPoint(x: x, y: y - h)); context.addLine(to: CGPoint(x: x, y: y + h)) }
        context.strokePath()
        let x = 10 + width * CGFloat(0.5 + value / 16)
        if value != 0 { context.setStrokeColor(ink.cgColor); context.setLineWidth(6); context.setLineCap(.round); context.move(to: CGPoint(x: bounds.midX, y: y)); context.addLine(to: CGPoint(x: x, y: y)); context.strokePath() }
        context.setFillColor(ink.cgColor); context.fillEllipse(in: CGRect(x: x - 6, y: y - 6, width: 12, height: 12))
        let font = UIFont(name: "UbuntuMono-Bold", size: 10) ?? .monospacedSystemFont(ofSize: 10, weight: .bold)
        let label = value == 0 ? "BEND" : String(format: "%+.1f%%", value)
        let size = (label as NSString).size(withAttributes: [.font: font]); let box = CGRect(x: bounds.midX - size.width / 2 - 2, y: y - size.height / 2, width: size.width + 4, height: size.height)
        context.setFillColor(UIColor.black.cgColor); context.fill(box)
        (label as NSString).draw(in: box.insetBy(dx: 2, dy: 0), withAttributes: [.font: font, .foregroundColor: ink])
        ("−" as NSString).draw(at: CGPoint(x: 2, y: y - 7), withAttributes: [.font: font, .foregroundColor: ink])
        ("+" as NSString).draw(at: CGPoint(x: bounds.width - 9, y: y - 7), withAttributes: [.font: font, .foregroundColor: ink])
    }
}
