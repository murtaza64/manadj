import SwiftUI
import UIKit
import ManadjCore

/// Native directional pan fails immediately for vertical motion, leaving List's
/// own scroll/tap cancellation intact. Direction cannot change into a load later.
struct SwipeToLoad<Content: View>: View {
    static var armDistance: CGFloat { 60 }
    let loadA: () -> Void
    let loadB: () -> Void
    var background: Color = Ink.base
    @ViewBuilder var content: Content
    @State private var dx: CGFloat = 0
    private var deck: Int { dx < 0 ? 0 : 1 }
    var body: some View {
        ZStack {
            if dx != 0 {
                HStack {
                    if dx < 0 { Spacer(minLength: 0) }
                    Text(abs(dx) >= Self.armDistance ? "LOAD \(Ink.deckName(deck))" : Ink.deckName(deck))
                        .font(Ink.font(14, bold: true)).foregroundStyle(Ink.decks[deck]).padding(.horizontal, 16)
                    if dx > 0 { Spacer(minLength: 0) }
                }.frame(maxWidth: .infinity, maxHeight: .infinity).background(Ink.decks[deck].opacity(0.2))
                    .accessibilityIdentifier("swipe-load-reveal")
            }
            DirectionLockedRow(content: content.background(background).offset(x: dx), changed: { dx = $0 }, ended: { travel, vertical, cancelled in
                let target = cancelled ? nil : LoadSwipeIntent.target(travel: travel, vertical: vertical, projected: travel)
                withAnimation(.easeOut(duration: 0.16)) { dx = 0 }
                if target == 0 { loadA() }; if target == 1 { loadB() }
            })
        }
        .accessibilityAction(named: "Load to A", loadA)
        .accessibilityAction(named: "Load to B", loadB)
    }
}

private struct DirectionLockedRow<Content: View>: UIViewControllerRepresentable {
    let content: Content
    let changed: (CGFloat) -> Void
    let ended: (Double, Double, Bool) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(changed: changed, ended: ended) }
    func makeUIViewController(context: Context) -> UIHostingController<Content> {
        let controller = UIHostingController(rootView: content)
        controller.safeAreaRegions = []; controller.view.backgroundColor = .clear
        let pan = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.pan(_:)))
        pan.delegate = context.coordinator; pan.maximumNumberOfTouches = 1
        pan.cancelsTouchesInView = true; controller.view.addGestureRecognizer(pan)
        return controller
    }
    func updateUIViewController(_ controller: UIHostingController<Content>, context: Context) {
        controller.rootView = content; context.coordinator.changed = changed; context.coordinator.ended = ended
    }
    func sizeThatFits(_ proposal: ProposedViewSize, uiViewController: UIHostingController<Content>, context: Context) -> CGSize? {
        uiViewController.sizeThatFits(in: CGSize(width: proposal.width ?? 320, height: proposal.height ?? .greatestFiniteMagnitude))
    }
    @MainActor final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var changed: (CGFloat) -> Void
        var ended: (Double, Double, Bool) -> Void
        private var armed = false
        private let haptic = UISelectionFeedbackGenerator()
        init(changed: @escaping (CGFloat) -> Void, ended: @escaping (Double, Double, Bool) -> Void) { self.changed = changed; self.ended = ended }
        func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
            guard let pan = recognizer as? UIPanGestureRecognizer else { return false }
            let t = pan.translation(in: pan.view), v = pan.velocity(in: pan.view)
            return abs(t.x) > 3 && abs(t.x) > abs(t.y) * 1.5 && abs(v.x) > abs(v.y) * 1.5
        }
        @objc func pan(_ pan: UIPanGestureRecognizer) {
            let t = pan.translation(in: pan.view)
            switch pan.state {
            case .began: haptic.prepare(); fallthrough
            case .changed:
                changed(max(-240, min(240, t.x)))
                let next = abs(t.x) >= 60
                if next != armed { armed = next; haptic.selectionChanged() }
            case .ended, .cancelled, .failed:
                ended(Double(t.x), Double(t.y), pan.state != .ended); armed = false
            default: break
            }
        }
    }
}
