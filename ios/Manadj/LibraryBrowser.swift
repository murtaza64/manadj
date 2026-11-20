import SwiftUI
import ManadjCore

struct LibraryBrowser: View {
    @EnvironmentObject var model: AppModel
    var onClose: () -> Void = {}
    var onLoad: (LibraryTrack) -> Bool
    @FocusState private var searchFocused: Bool
    @State private var restoreSearchAfterError = false
    @State private var keyboardOpen = false
    @State private var search = ""
    @State private var playlist: Int? = nil
    @State private var sort: SortColumn = .dateAdded
    @State private var downloadedOnly = false
    @State private var tags: Set<Int> = []
    @State private var filtersOpen = false
    @State private var bpmCenter: Double? = nil
    @State private var energy = 0
    @State private var followReference: Int? = nil
    @State private var rows: [LibraryTrack] = []
    @State private var followLabels: [Int: String] = [:]
    @State private var filtering = false
    private var taskId: String {
        "\(model.libraryVersion)|\(model.downloaded.count)|\(search)|\(playlist ?? -1)|\(sort.rawValue)|\(downloadedOnly)|\(tags.sorted())|\(bpmCenter ?? -1)|\(energy)|\(followReference ?? -1)"
    }
    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 8) {
                HStack(spacing: 8) {
                    Button("← A") { model.loadTarget = 0 }.foregroundStyle(Ink.decks[0]).frame(minWidth: 44, minHeight: 44)
                    Text("SWIPE A TRACK TO LOAD").font(Ink.font(9, bold: true)).foregroundStyle(Ink.muted).lineLimit(1).minimumScaleFactor(0.7)
                    Spacer(minLength: 0)
                    Button("B →") { model.loadTarget = 1 }.foregroundStyle(Ink.decks[1]).frame(minWidth: 44, minHeight: 44)
                    Button("BROWSE", action: onClose).buttonStyle(PerformanceKeyStyle(color: Ink.warning, active: true)).frame(width: 76, height: 44)
                }
                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(Ink.muted)
                    TextField("Search title, artist, file", text: $search).textInputAutocapitalization(.never).autocorrectionDisabled().submitLabel(.search).focused($searchFocused)
                    Button { filtersOpen.toggle(); searchFocused = false } label: {
                        Image(systemName: "line.3.horizontal.decrease").frame(width: 44, height: 44)
                    }.foregroundStyle(filtersOpen || !tags.isEmpty || bpmCenter != nil || energy > 0 ? Ink.accent : Ink.muted)
                        .accessibilityLabel("Library filters").accessibilityValue(filtersOpen ? "Expanded" : "Collapsed")
                    if !search.isEmpty { Button { search = ""; searchFocused = true } label: { Image(systemName: "xmark").frame(width: 44, height: 44) }.accessibilityLabel("Clear search") }
                }.padding(.leading, 12).frame(minHeight: 44).background(Ink.crust, in: Capsule()).overlay(Capsule().stroke(Ink.edge))
                if !keyboardOpen { ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        Menu(playlist.flatMap { id in model.snapshot?.playlists.first { $0.id == id }?.name } ?? "ALL TRACKS") {
                            Button("All tracks") { playlist = nil }
                            ForEach(model.snapshot?.playlists ?? []) { p in Button(p.name) { playlist = p.id; sort = .playOrder } }
                        }.buttonStyle(LibraryChipStyle())
                        Menu("\(sort.rawValue.uppercased()) ▼") { ForEach(SortColumn.allCases, id: \.rawValue) { c in Button(c.rawValue) { sort = c } } }.buttonStyle(LibraryChipStyle())
                        Button("● ON PHONE \(model.downloaded.count)") { downloadedOnly.toggle() }.buttonStyle(LibraryChipStyle(active: downloadedOnly))
                    }
                }
                if filtersOpen {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(model.snapshot?.tags ?? [], id: \.id) { tag in
                                Button(tag.name) {
                                    if tags.contains(tag.id) { tags.remove(tag.id) } else { tags.insert(tag.id) }
                                }.buttonStyle(LibraryChipStyle(active: tags.contains(tag.id)))
                                    .accessibilityLabel("Filter tag " + tag.name)
                                    .accessibilityValue(tags.contains(tag.id) ? "Selected" : "Not selected")
                            }
                        }
                    }
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            Button(bpmCenter.map { String(format: "BPM %.0f ±6", $0) } ?? "BPM ≈ DECK") {
                                if bpmCenter != nil { bpmCenter = nil }
                                else { bpmCenter = model.decks[model.loadTarget].track?.bpm }
                            }.buttonStyle(LibraryChipStyle(active: bpmCenter != nil))
                                .disabled(bpmCenter == nil && model.decks[model.loadTarget].track?.bpm == nil)
                                .accessibilityLabel("BPM filter")
                            Menu(energy == 0 ? "ENERGY" : "ENERGY \(energy)") { Button("Any energy") { energy = 0 }; ForEach(1...5, id: \.self) { n in Button("Energy \(n)") { energy = n } } }.buttonStyle(LibraryChipStyle(active: energy > 0))
                            if !tags.isEmpty || bpmCenter != nil || energy > 0 {
                                Button("RESET") { tags = []; bpmCenter = nil; energy = 0 }.buttonStyle(LibraryChipStyle())
                                    .accessibilityLabel("Reset library filters")
                            }
                        }
                    }
                }
                HStack {
                    Text("BROWSE  ›  " + (playlist == nil ? "COLLECTION" : "PLAYLIST")).font(Ink.font(11, bold: true)).foregroundStyle(Ink.accent)
                    Spacer()
                    Button { model.sync() } label: { Image(systemName: "arrow.triangle.2.circlepath").frame(width: 44, height: 44) }.disabled(model.busy).accessibilityLabel("Sync library")
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
                ContentUnavailableView("Bring your library", systemImage: "desktopcomputer", description: Text("Open manaDJ desktop → Settings → Phone sync. Pair this iPhone in Settings, then sync. Or import audio from Files on the Perform screen."))
            } else if rows.isEmpty && !filtering {
                ContentUnavailableView.search(text: search)
            } else {
                List(rows) { track in
                    Button {
                        let wasSearching = searchFocused
                        if onLoad(track) { searchFocused = false }
                        else { restoreSearchAfterError = wasSearching || !search.isEmpty }
                    } label: {
                        LibraryRow(track: track, downloaded: model.downloaded.contains(track.id), evidence: followLabels[track.id]).environmentObject(model)
                    }
                    .buttonStyle(.plain)
                    .swipeActions(edge: .leading, allowsFullSwipe: true) { Button("LOAD A") { model.loadTarget = 0; if onLoad(track) { searchFocused = false } }.tint(Ink.decks[0]) }
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) { Button("LOAD B") { model.loadTarget = 1; if onLoad(track) { searchFocused = false } }.tint(Ink.decks[1]) }
                    .listRowBackground(Ink.base)
                    .listRowSeparatorTint(Ink.edge)
                    .contextMenu { if let bpm = track.bpm { Button("Match BPM ±6") { bpmCenter = bpm; filtersOpen = true } }; Button("Follow this track") { followReference = track.id }; ForEach(0..<4) { index in Button("Load deck \(Ink.deckName(index))") { if model.load(track, deck: index) { searchFocused = false } } } }
                }.listStyle(.plain).scrollContentBackground(.hidden)
            }
        }
        .background(Ink.base)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboardOpen = true }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboardOpen = false }
        .task(id: taskId) { await filter() }
        .onChange(of: model.error) { _, error in
            if error == nil && restoreSearchAfterError {
                restoreSearchAfterError = false
                // SwiftUI dismisses the alert asynchronously. A focus write while it is
                // still the first responder is dropped on regular iPhone16/iOS18.5.
                searchFocused = false
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(350))
                    guard model.error == nil else { return }
                    searchFocused = true
                }
            }
        }
    }
    private func filter() async {
        guard let snapshot = model.snapshot else { rows = []; return }
        filtering = true
        var q = LibraryQuery()
        q.search = search; q.playlistId = playlist; q.sort = sort; q.descending = sort == .dateAdded
        q.downloadedOnly = downloadedOnly; q.tagIds = tags
        q.bpmCenter = bpmCenter; q.bpmTolerance = 6
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

private struct LibraryChipStyle: ButtonStyle {
    var active = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(Ink.font(11, bold: true)).lineLimit(1).padding(.horizontal, 11).frame(minHeight: 44)
            .foregroundStyle(active ? Ink.play : Ink.text)
            .background(active || configuration.isPressed ? Ink.accent.opacity(0.18) : Ink.crust, in: Capsule())
            .overlay(Capsule().stroke(active ? Ink.accent : Ink.edge, lineWidth: 1))
    }
}

private struct LibraryRow: View {
    @EnvironmentObject var model: AppModel
    let track: LibraryTrack
    let downloaded: Bool
    let evidence: String?
    @State private var waveform: PreviewWaveform?
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .top, spacing: 10) {
                VStack(spacing: 2) {
                    Text(track.bpm.map { String(format: "%.1f", $0) } ?? "--").foregroundStyle(Ink.decks[1])
                    Text(track.keyOpenKey ?? "--").foregroundStyle(Ink.play)
                }.font(Ink.font(12, bold: true)).frame(width: 48)
                VStack(alignment: .leading, spacing: 2) {
                    Text(track.title).font(Ink.font(15, bold: true)).foregroundStyle(Ink.text).lineLimit(1)
                    Text(track.artist ?? track.fileName).font(Ink.font(11)).foregroundStyle(Ink.muted).lineLimit(1)
                }.frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: downloaded ? "checkmark.circle.fill" : "icloud.and.arrow.down").font(.system(size: 11)).foregroundStyle(downloaded ? Ink.play : Ink.muted).accessibilityLabel(downloaded ? "Downloaded" : "Download required")
            }
            HStack(spacing: 6) {
                WaveformView(waveform: waveform, color: Ink.accent).frame(width: 102, height: 16)
                ForEach(track.tagIds.prefix(3), id: \.self) { id in
                    if let tag = model.snapshot?.tags.first(where: { $0.id == id }) {
                        Text(tag.name).font(Ink.font(9)).foregroundStyle(Ink.accent).padding(.horizontal, 3).background(Ink.accent.opacity(0.15), in: RoundedRectangle(cornerRadius: 3))
                    }
                }
                Spacer(minLength: 0)
                Text(track.durationSecs.map(Ink.clock) ?? "--:--").font(Ink.font(9)).foregroundStyle(Ink.muted)
            }
            if let evidence { Text(evidence).font(Ink.font(10)).foregroundStyle(Ink.accent) }
        }.padding(.vertical, 5).frame(minHeight: 54)
        .task(id: track.previewRev) { waveform = await model.preview(track) }
    }
}
