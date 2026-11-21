import SwiftUI
import ManadjCore

/// Android Library.kt SwipeToLoad parity: drag left → deck A, drag right →
/// deck B. The row slides over a deck-colored reveal with the target letter;
/// crossing the arm threshold ticks a haptic and arms the load, releasing
/// armed commits, and dragging back under the threshold cancels. A quick
/// short swipe is enough — there is no full-width swipe requirement.
/// Only horizontally dominant drags move the row, so the List keeps
/// vertical scrolling.
struct SwipeToLoad<Content: View>: View {
    /// Android direction/release semantics, shorter 60pt threshold per iPhone feedback.
    static var armDistance: CGFloat { 60 }
    /// Horizontal-dominance slop before the row starts moving.
    private static var slop: CGFloat { 12 }
    /// Android clamps travel to 60% of the row width; rows here are phone-width.
    private static var maxTravel: CGFloat { 240 }

    let loadA: () -> Void
    let loadB: () -> Void
    var background: Color = Ink.base
    @ViewBuilder var content: Content

    @State private var dx: CGFloat = 0
    @State private var horizontal = false
    @State private var armed = false
    @State private var haptic = UISelectionFeedbackGenerator()

    /// Android: dx < 0 (dragged left) loads deck A, dx > 0 loads deck B.
    private var deck: Int { dx < 0 ? 0 : 1 }

    var body: some View {
        ZStack {
            if dx != 0 {
                HStack {
                    if dx < 0 { Spacer(minLength: 0) }
                    Text(armed ? "LOAD \(Ink.deckName(deck))" : Ink.deckName(deck))
                        .font(Ink.font(14, bold: true))
                        .foregroundStyle(armed ? Ink.text : Ink.decks[deck])
                        .padding(.horizontal, 16)
                    if dx > 0 { Spacer(minLength: 0) }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Ink.decks[deck].opacity(armed ? 0.45 : 0.15))
                .accessibilityIdentifier("swipe-load-reveal")
            }
            content
                .background(background)
                .offset(x: dx)
        }
        .simultaneousGesture(drag)
        .accessibilityAction(named: "Load to A") { loadA() }
        .accessibilityAction(named: "Load to B") { loadB() }
    }

    private var drag: some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                let t = value.translation
                if !horizontal {
                    // detectHorizontalDragGestures: claim only horizontal pans.
                    guard abs(t.width) > Self.slop, abs(t.width) > abs(t.height) * 1.2 else { return }
                    horizontal = true
                    haptic.prepare()
                }
                dx = max(-Self.maxTravel, min(Self.maxTravel, t.width))
                let now = abs(dx) >= Self.armDistance
                if now != armed { armed = now; haptic.selectionChanged() }
            }
            .onEnded { value in
                let target = horizontal ? LoadSwipeIntent.target(travel: value.translation.width,
                    vertical: value.translation.height, projected: value.predictedEndTranslation.width) : nil
                withAnimation(.easeOut(duration: 0.16)) { dx = 0 }
                horizontal = false
                armed = false
                guard let target else { return }
                if target == 0 { loadA() } else { loadB() }
            }
    }
}
