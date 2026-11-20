import SwiftUI
import UIKit

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
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> UIButton {
        let button = HoldButton(type: .custom)
        context.coordinator.button = button
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
        view.accessibilityHint = "Touch and hold to preview; release to stop"
    }
    static func dismantleUIView(_ view: UIButton, coordinator: Coordinator) { coordinator.endHold() }
    @MainActor final class Coordinator: NSObject {
        var parent: HoldControl
        private var held = false
        weak var button: UIButton?
        private let haptic = UIImpactFeedbackGenerator(style: .light)
        init(_ parent: HoldControl) { self.parent = parent }
        @objc func press() { guard !held else { return }; held = true; haptic.impactOccurred(); parent.down(); button?.layer.removeAllAnimations(); button?.transform = CGAffineTransform(scaleX: parent.rounded ? 0.93 : 0.92, y: parent.rounded ? 0.93 : 0.92) }
        @objc func endHold() { guard held else { return }; held = false; parent.up(); guard let button else { return }; if UIAccessibility.isReduceMotionEnabled { button.transform = .identity } else { UIView.animate(withDuration: 0.32, delay: 0, usingSpringWithDamping: 0.4, initialSpringVelocity: 0, options: [.allowUserInteraction]) { button.transform = .identity } } }
    }
}

private final class HoldButton: UIButton {
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
    override func layoutSubviews() { super.layoutSubviews(); layer.cornerRadius = rounded ? bounds.height / 2 : 0 }
}
