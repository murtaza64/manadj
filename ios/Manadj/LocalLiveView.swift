import SwiftUI

struct LocalLiveView: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        VStack(spacing: 12) {
            HStack { Text("LOCAL LIVE · PROTOTYPE").font(Ink.font(16, bold: true)); Spacer(); Button("STOP") { model.stopLocalLive() }.buttonStyle(FlatButtonStyle(color: Ink.danger)) }
            Text(model.liveStatus).font(Ink.font(13)).foregroundStyle(Ink.accent).accessibilityIdentifier("local-live-status")
            HStack { Text(String(format: "RTT %.0fms", model.liveRoundTrip * 1000)); Spacer(); Text(String(format: "CORRECTION %.0fms", model.liveDrift * 1000)) }.font(Ink.font(11)).foregroundStyle(Ink.muted)
            ForEach(0..<4, id: \.self) { index in
                VStack(alignment: .leading, spacing: 5) {
                    HStack { Text(Ink.deckName(index)).foregroundStyle(Ink.decks[index]); Text(model.decks[index].title).lineLimit(1); Spacer(); Image(systemName: model.decks[index].engine.playing ? "play.fill" : "pause.fill") }
                    Text(String(format: "%.2fs", model.decks[index].engine.position)).foregroundStyle(Ink.muted)
                }.font(Ink.font(14)).padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Ink.panel).overlay(Rectangle().stroke(Ink.edge))
            }
            Text("Own paired desktop, trusted LAN. Audio downloads first; sampled deck/mixer moves follow. Not an audio broadcast. Timing and sound equivalence are unproven. Loops, scratch, stems, FX and automation pause this prototype.").font(Ink.font(11)).foregroundStyle(Ink.warning)
            Spacer()
        }.padding(16).background(Ink.base).foregroundStyle(Ink.text)
        .interactiveDismissDisabled()
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)) { _ in model.stopLocalLive() }
    }
}
