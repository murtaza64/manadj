import SwiftUI
import UIKit
import ManadjCore

/// UIKit touch tracking gives gated CUE/hot cues a real touch-cancel path.
/// A SwiftUI tap/long-press gesture alone can leave a preview held when a gesture is cancelled.
struct HoldControl: UIViewRepresentable {
    var title: String
    var color: Color
    var active = false
    var enabled = true
    var rounded = false
    var bare = false
    var marked = false
    var compact = false
    var down: () -> Void
    var up: () -> Void
    var canLatch: () -> Bool = { false }
    var latch: (() -> Void)? = nil
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> UIButton {
        let button = HoldButton(type: .custom)
        context.coordinator.button = button
        button.slide = { [weak coordinator = context.coordinator] delta in coordinator?.slide(delta: delta) }
        button.titleLabel?.font = UIFont(name: "UbuntuMono-Bold", size: 14) ?? .monospacedSystemFont(ofSize: 14, weight: .bold)
        button.titleLabel?.numberOfLines = 2
        button.titleLabel?.textAlignment = .center
        button.layer.borderWidth = 1.5
        button.addTarget(context.coordinator, action: #selector(Coordinator.press), for: .touchDown)
        button.addTarget(context.coordinator, action: #selector(Coordinator.endHold), for: [.touchUpInside, .touchUpOutside, .touchCancel])
        return button
    }
    func updateUIView(_ view: UIButton, context: Context) {
        context.coordinator.parent = self
        view.titleLabel?.font = UIFont(name: "UbuntuMono-Bold", size: compact ? 11 : 14) ?? .monospacedSystemFont(ofSize: compact ? 11 : 14, weight: .bold)
        let components = title.split(separator: "\n", maxSplits: 1).map(String.init)
        if components.count == 2 {
            let text = NSMutableAttributedString(string: components[0], attributes: [.font: UIFont(name: "UbuntuMono-Bold", size: 15) ?? UIFont.monospacedSystemFont(ofSize: 15, weight: .bold), .foregroundColor: UIColor(color)])
            text.append(NSAttributedString(string: "\n" + components[1], attributes: [.font: UIFont(name: "UbuntuMono-Regular", size: 8) ?? UIFont.monospacedSystemFont(ofSize: 8, weight: .regular), .foregroundColor: UIColor(color).withAlphaComponent(0.9)]))
            view.setAttributedTitle(text, for: .normal)
            let highlighted = NSMutableAttributedString(attributedString: text)
            highlighted.addAttribute(.foregroundColor, value: UIColor(Ink.text), range: NSRange(location: 0, length: highlighted.length))
            view.setAttributedTitle(highlighted, for: .highlighted)
        } else {
            view.setAttributedTitle(nil, for: .normal); view.setAttributedTitle(nil, for: .highlighted)
            view.setTitle(title, for: .normal)
            view.setTitleColor(UIColor(color), for: .normal)
        }
        if let button = view as? HoldButton {
            button.rounded = rounded; button.bare = bare; button.compact = compact; button.ink = UIColor(color); button.engaged = active; button.marked = marked
            button.refreshAppearance()
        }
        view.setNeedsLayout()
        view.isEnabled = enabled
        view.alpha = enabled ? 1 : 0.4
        view.accessibilityLabel = title
        view.accessibilityHint = latch == nil ? "Touch and hold to preview; release to stop" : "Hold to preview. Slide left or right to keep playing after release."
    }
    static func dismantleUIView(_ view: UIButton, coordinator: Coordinator) { coordinator.endHold() }
    @MainActor final class Coordinator: NSObject {
        var parent: HoldControl
        private var held = false
        private var intent = CueSlideLatch()
        private let latchHaptic = UIImpactFeedbackGenerator(style: .medium)
        func slide(delta: CGFloat) {
            guard held, parent.latch != nil, let button = button as? HoldButton else { return }
            let scale = button.window?.screen.scale ?? button.contentScaleFactor
            let threshold = intent.threshold(width: button.bounds.width, scale: scale)
            let preview = parent.canLatch()
            if preview && !intent.locked { button.slideProgress = max(-1, min(1, delta / threshold)); button.setNeedsLayout() }
            if intent.move(delta: delta, width: button.bounds.width, scale: scale, preview: preview) {
                parent.latch?(); latchHaptic.impactOccurred(); button.showLatch()
            }
        }
        weak var button: UIButton?
        private let haptic = UIImpactFeedbackGenerator(style: .light)
        init(_ parent: HoldControl) { self.parent = parent }
        @objc func press() { guard !held else { return }; held = true; intent.begin(); haptic.impactOccurred(); parent.down(); button?.layer.removeAllAnimations(); button?.transform = CGAffineTransform(scaleX: parent.rounded ? 0.93 : 0.92, y: parent.rounded ? 0.93 : 0.92) }
        @objc func endHold() { guard held else { return }; held = false; intent.end(); (button as? HoldButton)?.slideProgress = 0; button?.setNeedsLayout(); parent.up(); guard let button else { return }; if UIAccessibility.isReduceMotionEnabled { button.transform = .identity } else { UIView.animate(withDuration: 0.32, delay: 0, usingSpringWithDamping: 0.4, initialSpringVelocity: 0, options: [.allowUserInteraction]) { button.transform = .identity } } }
    }
}

private final class HoldButton: UIButton {
    var slide: ((CGFloat) -> Void)?
    var slideProgress: CGFloat = 0
    private var originX: CGFloat = 0
    private let progressFill = CALayer()
    private let latchBadge = UILabel()
    override init(frame: CGRect) {
        super.init(frame: frame)
        progressFill.backgroundColor = UIColor.clear.cgColor
        layer.insertSublayer(progressFill, at: 0)
        latchBadge.text = "▶"; latchBadge.textAlignment = .center
        latchBadge.font = .systemFont(ofSize: 14, weight: .bold); latchBadge.alpha = 0
        latchBadge.isUserInteractionEnabled = false; addSubview(latchBadge)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }
    override func beginTracking(_ touch: UITouch, with event: UIEvent?) -> Bool {
        originX = touch.location(in: self).x; slideProgress = 0
        return super.beginTracking(touch, with: event)
    }
    override func continueTracking(_ touch: UITouch, with event: UIEvent?) -> Bool {
        _ = super.continueTracking(touch, with: event)
        slide?(touch.location(in: self).x - originX)
        return true // A held cue may slide beyond the button while remaining gated.
    }
    func showLatch() {
        latchBadge.textColor = ink; latchBadge.alpha = 1
        UIView.animate(withDuration: 0.42, delay: 0, options: [.allowUserInteraction]) { self.latchBadge.alpha = 0 }
    }
    var rounded = false
    var bare = false
    var marked = false
    var engaged = false
    var compact = false
    var ink = UIColor.white
    private var lastAppearance = ""
    override var isHighlighted: Bool { didSet { refreshAppearance() } }
    func refreshAppearance() {
        let lit = engaged || isHighlighted
        let key = "\(lit)-\(bare)-\(marked)-\(rounded)-\(compact)-\(ink)"
        guard key != lastAppearance else { return }; lastAppearance = key
        let target: UIColor = bare ? .clear : ink.withAlphaComponent(lit ? 0.5 : marked ? 0.1 : 0)
        if lit || UIAccessibility.isReduceMotionEnabled { layer.removeAllAnimations(); backgroundColor = target }
        else { UIView.animate(withDuration: 0.24, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) { self.backgroundColor = target } }
        layer.borderWidth = bare ? 0 : compact ? 1.5 : rounded ? 2 : marked || lit ? 1.5 : 1
        layer.borderColor = ink.withAlphaComponent(lit || rounded || marked || compact ? 1 : 0.45).cgColor
    }
    override func layoutSubviews() {
        super.layoutSubviews(); layer.cornerRadius = rounded ? bounds.height / 2 : 0
        CATransaction.begin(); CATransaction.setDisableActions(true)
        let width = bounds.width * abs(slideProgress)
        progressFill.frame = CGRect(x: slideProgress < 0 ? bounds.width - width : 0, y: 0, width: width, height: bounds.height)
        progressFill.backgroundColor = ink.withAlphaComponent(0.3).cgColor
        progressFill.cornerRadius = rounded ? bounds.height / 2 : 0
        CATransaction.commit()
        latchBadge.frame = CGRect(x: slideProgress < 0 ? 3 : max(0, bounds.width - 24), y: 0, width: 21, height: bounds.height)
    }
}
