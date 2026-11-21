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
