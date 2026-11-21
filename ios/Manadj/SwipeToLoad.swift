import SwiftUI
import UIKit
import ManadjCore

/// Native directional pan fails immediately for vertical motion, leaving List's
/// own scroll/tap cancellation intact. Direction cannot change into a load later.
struct SwipeToLoad<Content: View>: View {
    static var armDistance: CGFloat { 60 }
    let loadA: () -> Void
    let loadB: () -> Void
    let tap: () -> Void
    var background: Color = Ink.base
    @ViewBuilder var content: Content
    @State private var dx: CGFloat = 0
    @State private var direction: Bool?
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
            content.background(background).offset(x: dx)
                .contentShape(Rectangle())
                .onTapGesture(perform: tap)
                .simultaneousGesture(DragGesture(minimumDistance: 12, coordinateSpace: .global)
                    .onChanged { value in
                        let t = value.translation
                        if direction == nil { direction = abs(t.width) > abs(t.height) * 1.5 }
                        if direction == true { dx = max(-240, min(240, t.width)) }
                    }.onEnded { value in
                        let t = value.translation
                        let target = direction == true ? LoadSwipeIntent.target(travel: Double(t.width), vertical: Double(t.height), projected: Double(t.width)) : nil
                        direction = nil
                        withAnimation(.easeOut(duration: 0.16)) { dx = 0 }
                        if target == 0 { loadA() }; if target == 1 { loadB() }
                    })
        }
        .accessibilityElement(children: .contain)
        .accessibilityAction(named: "Load selected deck", tap)
        .accessibilityAction(named: "Load to A", loadA)
        .accessibilityAction(named: "Load to B", loadB)
    }
}

/// Observe the real list pan, not a competing recognizer. Once scrolling reaches
/// its top, consume only the remaining downward travel for the enclosing drawer.
struct BrowserTopPull: UIViewRepresentable {
    var changed: (CGFloat) -> Void
    var ended: (CGFloat, CGFloat) -> Void
    var diagnostic: (String) -> Void = { _ in }
    func makeUIView(context: Context) -> Probe {
        #if DEBUG
        print("BROWSER_PROBE_CREATED")
        #endif
        return Probe()
    }
    func updateUIView(_ view: Probe, context: Context) {
        view.changed = changed; view.ended = ended; view.diagnostic = diagnostic
        DispatchQueue.main.async { [weak view] in view?.attach() }
    }
    static func dismantleUIView(_ view: Probe, coordinator: ()) { view.detach() }

    final class Probe: UIView {
        weak var scroll: UIScrollView?
        var changed: (CGFloat) -> Void = { _ in }
        var ended: (CGFloat, CGFloat) -> Void = { _, _ in }
        var diagnostic: (String) -> Void = { _ in }
        private func report(_ value: String) {
            #if DEBUG
            DispatchQueue.main.async { [weak self] in self?.diagnostic(value) }
            #endif
        }
        private var anchor: CGFloat?
        private var distance: CGFloat = 0
        private var priorBounces = true
        override func didMoveToWindow() {
            super.didMoveToWindow()
            #if DEBUG
            print("BROWSER_PROBE_WINDOW attached=\(window != nil)")
            #endif
            if window != nil { attach() } else { detach() }
        }
        override func layoutSubviews() { super.layoutSubviews(); attach() }
        func attach() {
            guard window != nil else { report("probe=no-window"); return }
            if let scroll, scroll.window == window { return }
            detach()
            func bind(_ list: UIScrollView) {
                scroll = list
                report("probe=bound id=\(list.accessibilityIdentifier ?? "nil") type=\(type(of:list)) size=\(list.bounds.size) content=\(list.contentSize)")
                list.panGestureRecognizer.addTarget(self, action: #selector(pan(_:)))
                #if DEBUG
                print("BROWSER_PAN_ATTACHED type=\(type(of: list)) frame=\(list.convert(list.bounds, to: nil)) content=\(list.contentSize) bounceY=\(list.alwaysBounceVertical)")
                #endif
            }
            // Prefer the actual enclosing list before inspecting sibling hosts.
            // Searching each ancestor's descendants immediately can bind a
            // horizontal source/header scroller before reaching this list.
            var enclosing = superview
            while let candidate = enclosing {
                if let list = candidate as? UIScrollView { bind(list); return }
                enclosing = candidate.superview
            }
            func findScroll(_ root: UIView) -> UIScrollView? {
                if let list = root as? UIScrollView,
                   list.bounds.height > 100,
                   list.alwaysBounceVertical || list.contentSize.height > list.bounds.height { return list }
                for child in root.subviews {
                    if let list = findScroll(child) { return list }
                }
                return nil
            }
            // SwiftUI may host the background beside its platform scroll view,
            // not below it. Search the nearest shared ancestor as well.
            var ancestor = superview
            while let candidate = ancestor {
                if let list = findScroll(candidate) {
                    bind(list); return
                }
                ancestor = candidate.superview
            }
            report("probe=no-scroll hierarchy=" + String(describing: superview))
        }
        func detach() {
            if let scroll {
                scroll.panGestureRecognizer.removeTarget(self, action: #selector(pan(_:)))
                if anchor != nil { scroll.bounces = priorBounces }
            }
            scroll = nil; anchor = nil; distance = 0
        }
        @objc private func pan(_ pan: UIPanGestureRecognizer) {
            guard let scroll else { return }
            let travel = pan.translation(in: scroll.window), top = -scroll.adjustedContentInset.top
            switch pan.state {
            case .began:
                anchor = nil; distance = 0; priorBounces = scroll.bounces
                report("probe=pan-began offset=\(scroll.contentOffset) top=\(top)")
                #if DEBUG
                print("BROWSER_PAN_BEGAN offset=\(scroll.contentOffset) top=\(top) global=\(scroll.convert(scroll.bounds, to: nil))")
                #endif
            case .changed:
                if anchor == nil, travel.y > 0, travel.y > abs(travel.x) * 1.5, scroll.contentOffset.y <= top + 0.5 {
                    // Include overscroll already delivered in this native pan update.
                    anchor = travel.y - max(0, top - scroll.contentOffset.y)
                    scroll.bounces = false
                }
                if let anchor {
                    distance = max(0, travel.y - anchor)
                    scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: top), animated: false)
                    changed(distance)
                    report("probe=handoff distance=\(distance) global=\(scroll.convert(CGPoint(x:0,y:top), to:nil))")
                    #if DEBUG
                    print("BROWSER_PAN_HANDOFF travel=\(travel.y) distance=\(distance) rowContentGlobal=\(scroll.convert(CGPoint(x: 0, y: top), to: nil)) offset=\(scroll.contentOffset.y)")
                    #endif
                }
            case .ended, .cancelled, .failed:
                guard anchor != nil else { return }
                let final = distance, velocity = pan.state == .ended ? pan.velocity(in: scroll.window).y : 0
                scroll.bounces = priorBounces; anchor = nil; distance = 0
                report("probe=ended distance=\(final) velocity=\(velocity)")
                ended(pan.state == .ended ? final : 0, velocity)
            default: break
            }
        }
    }
}
