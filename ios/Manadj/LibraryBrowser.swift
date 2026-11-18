import SwiftUI
import ManadjCore

struct LibraryBrowser: View {
    @EnvironmentObject var model: AppModel
    var onLoad: (LibraryTrack) -> Void
    @State private var search = ""
    @State private var playlist: Int? = nil
    @State private var sort: SortColumn = .dateAdded
    @State private var downloadedOnly = false
    @State private var tag: Int? = nil
    @State private var energy = 0
    @State private var followReference: Int? = nil
    @State private var rows: [LibraryTrack] = []
    @State private var followLabels: [Int: String] = [:]
    @State private var filtering = false
    private var taskId: String {
        "\(model.libraryVersion)|\(model.downloaded.count)|\(search)|\(playlist ?? -1)|\(sort.rawValue)|\(downloadedOnly)|\(tag ?? -1)|\(energy)|\(followReference ?? -1)"
    }
    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 8) {
                HStack {
                    Text("LIBRARY").font(Ink.font(16, bold: true))
                    Spacer()
                    Menu("LOAD → \(Ink.deckName(model.loadTarget))") { ForEach(0..<4) { index in Button("Deck \(Ink.deckName(index))") { model.loadTarget = index } } }
                    Button { model.sync() } label: { Image(systemName: "arrow.triangle.2.circlepath").frame(width: 44, height: 44) }.disabled(model.busy)
                }
                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(Ink.muted)
                    TextField("Search title, artist, file", text: $search).textInputAutocapitalization(.never).autocorrectionDisabled().submitLabel(.search)
                    if !search.isEmpty { Button { search = "" } label: { Image(systemName: "xmark").frame(width: 44, height: 44) }.accessibilityLabel("Clear search") }
                }.padding(.leading, 12).frame(minHeight: 44).background(Ink.crust).overlay(Rectangle().stroke(Ink.edge))
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        Menu(playlist.flatMap { id in model.snapshot?.playlists.first { $0.id == id }?.name } ?? "ALL TRACKS") {
                            Button("All tracks") { playlist = nil }
                            ForEach(model.snapshot?.playlists ?? []) { p in Button(p.name) { playlist = p.id; sort = .playOrder } }
                        }.buttonStyle(FlatButtonStyle())
                        Menu("SORT: \(sort.rawValue.uppercased())") { ForEach(SortColumn.allCases, id: \.rawValue) { c in Button(c.rawValue) { sort = c } } }.buttonStyle(FlatButtonStyle())
                        Button("OFFLINE") { downloadedOnly.toggle() }.buttonStyle(FlatButtonStyle(active: downloadedOnly))
                        Menu(tag.flatMap { id in model.snapshot?.tags.first { $0.id == id }?.name } ?? "TAGS") {
                            Button("Any tag") { tag = nil }
                            ForEach(model.snapshot?.tags ?? [], id: \.id) { t in Button(t.name) { tag = t.id } }
                        }.buttonStyle(FlatButtonStyle(active: tag != nil))
                        Menu(energy == 0 ? "ENERGY" : "ENERGY \(energy)") { Button("Any energy") { energy = 0 }; ForEach(1...5, id: \.self) { n in Button("Energy \(n)") { energy = n } } }.buttonStyle(FlatButtonStyle(active: energy > 0))
                    }
                }
                if let followReference {
                    HStack {
                        Text("FOLLOW · \(model.snapshot?.tracks.first { $0.id == followReference }?.title ?? "reference")").lineLimit(1)
                        Spacer()
                        Button("CLEAR") { self.followReference = nil }.frame(minHeight: 44)
                    }.font(Ink.font(12)).foregroundStyle(Ink.accent)
                } else if let track = model.decks[model.loadTarget].track {
                    Button("FOLLOW DECK \(Ink.deckName(model.loadTarget)) · \(track.title)") { followReference = track.id }.font(Ink.font(12)).lineLimit(1).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
                HStack {
                    Text("\(rows.count) tracks · \(model.downloaded.count) downloaded")
                    Spacer()
                    if filtering || model.busy { ProgressView().controlSize(.small) }
                }.font(Ink.font(11)).foregroundStyle(Ink.muted)
            }.padding(12).background(Ink.panel)
            if model.snapshot == nil {
                ContentUnavailableView("Bring your library", systemImage: "desktopcomputer", description: Text("Open manaDJ desktop → Settings → Library → Phone sync. Pair this iPhone in Settings, then sync. Or import audio from Files on the Perform screen."))
            } else if rows.isEmpty && !filtering {
                ContentUnavailableView.search(text: search)
            } else {
                List(rows) { track in
                    Button { onLoad(track) } label: {
                        LibraryRow(track: track, downloaded: model.downloaded.contains(track.id), evidence: followLabels[track.id])
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(Ink.base)
                    .listRowSeparatorTint(Ink.edge)
                    .contextMenu { Button("Follow this track") { followReference = track.id }; ForEach(0..<4) { index in Button("Load deck \(Ink.deckName(index))") { model.load(track, deck: index) } } }
                }.listStyle(.plain).scrollContentBackground(.hidden)
            }
        }
        .background(Ink.base)
        .task(id: taskId) { await filter() }
    }
    private func filter() async {
        guard let snapshot = model.snapshot else { rows = []; return }
        filtering = true
        var q = LibraryQuery()
        q.search = search; q.playlistId = playlist; q.sort = sort; q.descending = sort == .dateAdded
        q.downloadedOnly = downloadedOnly; q.tagIds = tag.map { [$0] } ?? []
        q.energy = energy > 0 ? energy...energy : nil
        let query = q, offline = model.downloaded, reference = followReference
        let result = await Task.detached(priority: .userInitiated) { () -> ([LibraryTrack], [Int: String]) in
            let library = Library(snapshot, downloaded: { offline.contains($0.id) })
            if let reference {
                let ranked = library.follow([reference], within: query)
                return (ranked.map(\.track), Dictionary(uniqueKeysWithValues: ranked.map { ($0.id, $0.label) }))
            }
            return (library.query(query), [:])
        }.value
        guard !Task.isCancelled else { return }
        rows = result.0; followLabels = result.1; filtering = false
    }
}

private struct LibraryRow: View {
    let track: LibraryTrack
    let downloaded: Bool
    let evidence: String?
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: downloaded ? "checkmark.circle.fill" : "icloud.and.arrow.down").foregroundStyle(downloaded ? Ink.play : Ink.muted).frame(width: 24).accessibilityLabel(downloaded ? "Downloaded" : "Download required")
            VStack(alignment: .leading, spacing: 4) {
                Text(track.title).font(Ink.font(16, bold: true)).foregroundStyle(Ink.text).lineLimit(2)
                Text(track.artist ?? track.fileName).font(Ink.font(12)).foregroundStyle(Ink.muted).lineLimit(1)
                if let evidence { Text(evidence).font(Ink.font(11)).foregroundStyle(Ink.accent) }
            }.frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 4) {
                Text(track.bpm.map { String(format: "%.1f", $0) } ?? "--")
                Text("\(track.keyOpenKey ?? "--") · \(track.durationSecs.map(Ink.clock) ?? "--:--")").foregroundStyle(Ink.muted)
            }.font(Ink.font(12)).monospacedDigit()
        }.padding(.vertical, 8).frame(minHeight: 64)
    }
}
