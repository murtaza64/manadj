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
    @State private var nativeDiagnostic = "no native pan"
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
            if #available(iOS 18.0, *) {
                rowContent.gesture(HorizontalLoadPan(changed: { travel in
                    nativeDiagnostic = "changed travel=\(travel)"
                    dx = max(-240, min(240, travel.x))
                }, ended: { travel in
                    nativeDiagnostic = "ended travel=\(travel)"
                    let target = LoadSwipeIntent.target(travel: Double(travel.x), vertical: Double(travel.y), projected: Double(travel.x))
                    withAnimation(.easeOut(duration: 0.16)) { dx = 0 }
                    if target == 0 { loadA() }; if target == 1 { loadB() }
                }, cancelled: { withAnimation(.easeOut(duration: 0.16)) { dx = 0 } }))
            } else {
                rowContent
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
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("library-swipe-row")
        .accessibilityValue(nativeDiagnostic)
        .accessibilityAction(named: "Load selected deck", tap)
        .accessibilityAction(named: "Load to A", loadA)
        .accessibilityAction(named: "Load to B", loadB)
    }
    private var rowContent: some View {
        content.background(background).offset(x: dx)
            .contentShape(Rectangle()).onTapGesture(perform: tap)
    }

}

/// Fail vertical recognition before beginning, so a row cannot claim a native
/// list scroll merely because its SwiftUI DragGesture reached minimumDistance.
@available(iOS 18.0, *)
private struct HorizontalLoadPan: UIGestureRecognizerRepresentable {
    var changed: (CGPoint) -> Void
    var ended: (CGPoint) -> Void
    var cancelled: () -> Void
    func makeUIGestureRecognizer(context: Context) -> WindowTravelPan {
        let pan = WindowTravelPan()
        pan.maximumNumberOfTouches = 1
        pan.delegate = context.coordinator
        return pan
    }
    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }
    func handleUIGestureRecognizerAction(_ pan: WindowTravelPan, context: Context) {
        let travel = pan.fullTravel
        #if DEBUG
        print("ROW_NATIVE_PAN state=\(pan.state.rawValue) travel=\(travel) velocity=\(pan.velocity(in: nil))")
        #endif
        switch pan.state {
        case .began, .changed: changed(travel)
        case .ended: ended(travel)
        case .cancelled, .failed: cancelled()
        default: break
        }
    }
    final class WindowTravelPan: UIPanGestureRecognizer {
        private var origin: CGPoint?
        private var latest: CGPoint?
        var fullTravel: CGPoint {
            guard let origin, let latest else { return translation(in: view?.window) }
            return CGPoint(x: latest.x - origin.x, y: latest.y - origin.y)
        }
        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
            if let t = touches.first { origin = t.location(in: t.window); latest = origin }
            super.touchesBegan(touches, with: event)
        }
        override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
            if let t = touches.first { latest = t.location(in: t.window) }
            super.touchesMoved(touches, with: event)
        }
        override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
            if let t = touches.first { latest = t.location(in: t.window) }
            super.touchesEnded(touches, with: event)
        }
        override func reset() { super.reset(); origin = nil; latest = nil }
    }
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        func gestureRecognizerShouldBegin(_ gesture: UIGestureRecognizer) -> Bool {
            guard let pan = gesture as? UIPanGestureRecognizer else { return false }
            let velocity = pan.velocity(in: nil)
            #if DEBUG
            print("ROW_NATIVE_DIRECTION travel=\(pan.translation(in: nil)) velocity=\(velocity)")
            #endif
            return abs(velocity.x) > abs(velocity.y) * 1.5
        }
    }
}

/// Observes the actual list pan, rather than competing with it using a second
/// vertical recognizer. Native scrolling owns the gesture until a downward pan
/// reaches the top, then the whole drawer owns the remaining travel.
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
        private var offsetObservation: NSKeyValueObservation?
        private var pinningOffset = false
        private func pinListAtTop() {
            guard anchor != nil, let scroll, !pinningOffset else { return }
            let top = -scroll.adjustedContentInset.top
            guard abs(scroll.contentOffset.y - top) > 0.01 else { return }
            pinningOffset = true
            scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: top), animated: false)
            pinningOffset = false
        }
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
                // UIKit may apply its offset after the target callback. Pin both
                // orderings synchronously so rows cannot rubber-band independently
                // of their header, transport and enclosing drawer.
                offsetObservation = list.observe(\.contentOffset, options: [.new]) { [weak self] _, _ in
                    // UIScrollView's content offset is mutated on UIKit's main
                    // thread; preserve synchronous ownership, no one-frame hop.
                    MainActor.assumeIsolated { self?.pinListAtTop() }
                }
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
            offsetObservation?.invalidate(); offsetObservation = nil
            scroll = nil; anchor = nil; distance = 0
        }
        @objc private func pan(_ pan: UIPanGestureRecognizer) {
            guard let scroll else { return }
            let travel = pan.translation(in: scroll.window), top = -scroll.adjustedContentInset.top
            switch pan.state {
            case .began:
                anchor = nil; distance = 0
                let velocity = pan.velocity(in: scroll.window)
                if velocity.y > 0, velocity.y > abs(velocity.x) * 1.5,
                   scroll.contentOffset.y <= top + 0.5 {
                    anchor = 0; distance = max(0, travel.y)
                    priorBounces = scroll.bounces; scroll.bounces = false
                    pinListAtTop(); changed(distance)
                    report("probe=native-pan-began distance=\(distance)")
                }
            case .changed:
                if anchor == nil, travel.y > 0, travel.y > abs(travel.x) * 1.5, scroll.contentOffset.y <= top + 0.5 {
                    // Include overscroll already delivered in this native pan update.
                    anchor = travel.y - max(0, top - scroll.contentOffset.y)
                    priorBounces = scroll.bounces
                    scroll.bounces = false
                }
                if let anchor {
                    distance = max(0, travel.y - anchor)
                    pinListAtTop()
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

/// The handle uses the same UIKit pan velocity semantics as top-list handoff.
/// Its own transparent touch surface avoids SwiftUI release-velocity resampling.
struct BrowserHandlePan: UIViewRepresentable {
    var changed: (CGFloat) -> Void
    var ended: (CGFloat, CGFloat) -> Void
    var diagnostic: (String) -> Void = { _ in }
    func makeUIView(context: Context) -> Surface { Surface() }
    func updateUIView(_ view: Surface, context: Context) { view.changed = changed; view.ended = ended; view.diagnostic = diagnostic }
    final class Surface: UIView, UIGestureRecognizerDelegate {
        var changed: (CGFloat) -> Void = { _ in }
        var ended: (CGFloat, CGFloat) -> Void = { _, _ in }
        var diagnostic: (String) -> Void = { _ in }
        override init(frame: CGRect) {
            super.init(frame: frame)
            let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
            pan.maximumNumberOfTouches = 1; pan.delegate = self; addGestureRecognizer(pan)
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }
        override func gestureRecognizerShouldBegin(_ gesture: UIGestureRecognizer) -> Bool {
            guard let pan = gesture as? UIPanGestureRecognizer else { return false }
            let v = pan.velocity(in: window)
            return v.y > 0 && v.y > abs(v.x) * 1.5
        }
        @objc private func handlePan(_ pan: UIPanGestureRecognizer) {
            let distance = max(0, pan.translation(in: window).y)
            let velocity = pan.velocity(in: window).y
            #if DEBUG
            let sample = "handle state=\(pan.state.rawValue) distance=\(distance) velocity=\(velocity) time=\(ProcessInfo.processInfo.systemUptime)"
            DispatchQueue.main.async { [weak self] in self?.diagnostic(sample) }
            #endif
            switch pan.state {
            case .began, .changed: changed(distance)
            case .ended: ended(distance, velocity)
            case .cancelled, .failed: ended(0, 0)
            default: break
            }
        }
    }
}
