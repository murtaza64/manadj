import SwiftUI
import UniformTypeIdentifiers
import CEngine

@main struct ManadjApp: App {
    @StateObject private var model = AppModel()
    var body: some Scene {
        WindowGroup {
            WorkspaceView().environmentObject(model)
                .font(Ink.font()).foregroundStyle(Ink.text)
                .tint(Ink.accent).preferredColorScheme(.dark)
        }
    }
}

struct WorkspaceView: View {
    @EnvironmentObject var model: AppModel
    @State private var tab = 0
    @State private var pair = 0
    @State private var showLibrary = false
    @State private var showFiles = false
    @State private var fileTarget = 0
    @State private var fx = false
    @State private var effect = 0
    @State private var fxTarget = 0
    @State private var fxDepth = -0.5
    @State private var fxBeats = 0.5
    var body: some View {
        VStack(spacing: 0) {
            header
            Text(model.status).font(Ink.font(11)).foregroundStyle(Ink.muted).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).padding(.vertical, 4).background(Ink.crust)
            if tab == 0 { performance }
            else if tab == 1 { LibraryBrowser(onLoad: { track in let accepted = model.load(track, deck: model.loadTarget); if accepted { tab = 0 }; return accepted }) }
            else { SettingsView() }
            HStack(spacing: 0) {
                tabButton("PERFORM", icon: "slider.horizontal.3", index: 0)
                tabButton("LIBRARY", icon: "music.note.list", index: 1)
                tabButton("SETTINGS", icon: "gearshape", index: 2)
            }.background(Ink.crust)
        }
        .background(Ink.base.ignoresSafeArea())
        .sheet(isPresented: $showLibrary) {
            NavigationStack {
                LibraryBrowser(onLoad: { track in let accepted = model.load(track, deck: model.loadTarget); if accepted { showLibrary = false }; return accepted })
                    .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { showLibrary = false } } }
            }.environmentObject(model).font(Ink.font()).foregroundStyle(Ink.text).preferredColorScheme(.dark)
        }
        .fileImporter(isPresented: $showFiles, allowedContentTypes: [.audio], allowsMultipleSelection: false) { result in
            switch result {
            case .success(let urls): if let url = urls.first { model.importFile(url, deck: fileTarget) }
            case .failure(let error): model.error = error.localizedDescription
            }
        }
        .alert("manaDJ", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("OK", role: .cancel) { model.error = nil }
        } message: { Text(model.error ?? "") }
    }
    private var header: some View {
        HStack {
            Text("manaDJ").font(Ink.font(24, bold: true)).foregroundStyle(Ink.text)
            Text("iOS · WORK IN PROGRESS").font(Ink.font(9)).foregroundStyle(Ink.warning)
            Spacer(minLength: 4)
            Button { model.toggleRecording() } label: { Label(model.recording ? "STOP" : "REC", systemImage: "record.circle") }
                .buttonStyle(FlatButtonStyle(color: Ink.danger, active: model.recording))
        }.padding(.horizontal, 12).padding(.vertical, 8).background(Ink.crust)
    }
    private var performance: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 12) {
                    HStack(spacing: 8) {
                        Button("A / B") { pair = 0 }.buttonStyle(FlatButtonStyle(active: pair == 0))
                        Button("C / D") { pair = 1 }.buttonStyle(FlatButtonStyle(active: pair == 1))
                        Spacer(minLength: 4)
                        Button("GRID") { model.quantize.toggle(); model.set(MDJQuantize, 0, model.quantize ? 1 : 0) }.buttonStyle(FlatButtonStyle(color: Ink.cue, active: model.quantize))
                        Menu {
                            ForEach(0..<4) { index in Button("Deck \(Ink.deckName(index))") { fileTarget = index; showFiles = true } }
                        } label: { Image(systemName: "folder").frame(width: 44, height: 44) }.accessibilityLabel("Import audio from Files")
                    }
                    let columns = geometry.size.width >= 760 ? 2 : 1
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: columns), spacing: 12) {
                        ForEach((pair * 2)..<(pair * 2 + 2), id: \.self) { index in
                            DeckPanel(index: index, onLoad: { model.loadTarget = index; showLibrary = true })
                        }
                    }
                    HStack {
                        Text("A + C").foregroundStyle(Ink.decks[0])
                        Slider(value: $model.crossfade, in: -1...1).tint(Ink.accent).onChange(of: model.crossfade) { _, v in model.set(MDJCrossfade, 0, v) }.accessibilityLabel("Crossfader")
                        Text("B + D").foregroundStyle(Ink.decks[1])
                        Button("0") { model.crossfade = 0 }.frame(minWidth: 44, minHeight: 44).accessibilityLabel("Center crossfader")
                    }.font(Ink.font(12))
                    fxPanel
                    Text("Performance edits are local to this run. Desktop write-back and Session replay are not implemented yet.")
                        .font(Ink.font(11)).foregroundStyle(Ink.warning).frame(maxWidth: .infinity, alignment: .leading)
                }.padding(12)
            }
        }
    }
    private var fxPanel: some View {
        VStack(spacing: 8) {
            HStack {
                Text("BEAT FX").font(Ink.font(12, bold: true))
                Picker("Effect", selection: $effect) {
                    ForEach(Array(["ECHO", "LOW CUT", "REVERB", "FLANGER", "TRANS", "ROLL"].enumerated()), id: \.offset) { i, name in Text(name).tag(i) }
                }.tint(Ink.accent)
                Picker("FX target", selection: $fxTarget) { ForEach(0..<5) { index in Text(index == 4 ? "MASTER" : Ink.deckName(index)).tag(index) } }
                Spacer(minLength: 0)
                Button(fx ? "ON" : "OFF") { fx.toggle(); updateFX() }.buttonStyle(FlatButtonStyle(color: Ink.cue, active: fx))
            }
            HStack {
                Text("DRY").font(Ink.font(11))
                Slider(value: $fxDepth, in: -1...1).tint(Ink.cue).accessibilityLabel("FX dry wet").onChange(of: fxDepth) { _, _ in updateFX() }
                Text("WET").font(Ink.font(11))
                Picker("Beats", selection: $fxBeats) { ForEach([0.0625, 0.125, 0.25, 0.5, 0.75, 1, 2, 4, 8], id: \.self) { n in Text(String(format: "%g beats", n)).tag(n) } }
            }
        }.padding(12).background(Ink.panel).overlay(Rectangle().stroke(Ink.edge))
            .onChange(of: effect) { _, _ in updateFX() }.onChange(of: fxTarget) { _, _ in updateFX() }.onChange(of: fxBeats) { _, _ in updateFX() }
    }
    private func updateFX() { model.audio?.beatFX(effect: effect, target: fxTarget, on: fx, depth: fxDepth, beats: fxBeats) }
    private func tabButton(_ title: String, icon: String, index: Int) -> some View {
        Button { tab = index } label: {
            VStack(spacing: 4) { Image(systemName: icon); Text(title).font(Ink.font(11, bold: true)) }
                .foregroundStyle(tab == index ? Ink.accent : Ink.muted).frame(maxWidth: .infinity, minHeight: 56)
                .overlay(alignment: .top) { Rectangle().fill(tab == index ? Ink.accent : Ink.edge).frame(height: 2) }
        }.buttonStyle(.plain).accessibilityLabel(title)
    }
}
