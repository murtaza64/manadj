import SwiftUI
import UIKit

/// UIKit touch tracking gives gated CUE/hot cues a real touch-cancel path.
/// A SwiftUI tap/long-press gesture alone can leave a preview held when a gesture is cancelled.
struct HoldControl: UIViewRepresentable {
    var title: String
    var color: Color
    var active = false
    var enabled = true
    var down: () -> Void
    var up: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> UIButton {
        let button = UIButton(type: .custom)
        button.titleLabel?.font = UIFont(name: "UbuntuMono-Bold", size: 14) ?? .monospacedSystemFont(ofSize: 14, weight: .bold)
        button.layer.borderWidth = 1
        button.addTarget(context.coordinator, action: #selector(Coordinator.press), for: .touchDown)
        button.addTarget(context.coordinator, action: #selector(Coordinator.endHold), for: [.touchUpInside, .touchUpOutside, .touchCancel])
        return button
    }
    func updateUIView(_ view: UIButton, context: Context) {
        context.coordinator.parent = self
        view.setTitle(title, for: .normal)
        view.setTitleColor(UIColor(active ? Ink.base : color), for: .normal)
        view.backgroundColor = UIColor(active ? color : Ink.panel)
        view.layer.borderColor = UIColor(color).cgColor
        view.isEnabled = enabled
        view.alpha = enabled ? 1 : 0.4
        view.accessibilityLabel = title
        view.accessibilityHint = "Touch and hold to preview; release to stop"
    }
    static func dismantleUIView(_ view: UIButton, coordinator: Coordinator) { coordinator.endHold() }
    final class Coordinator: NSObject {
        var parent: HoldControl
        private var held = false
        init(_ parent: HoldControl) { self.parent = parent }
        @objc func press() { guard !held else { return }; held = true; parent.down() }
        @objc func endHold() { guard held else { return }; held = false; parent.up() }
    }
}
