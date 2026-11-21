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
    @State private var source: BrowserSource = .collection
    private var playlist: Int? { if case let .playlist(id) = source { return id }; return nil }
    @State private var sort: SortColumn = .dateAdded
    @State private var downloadedOnly = false
    @State private var tags: Set<Int> = []
    @State private var filtersOpen = false
    @State private var bpmCenter: Double? = nil
    @State private var energy = 0
    @State private var followReference: Int? = nil
    @State private var selectedTrack: Int? = nil
    @State private var rows: [LibraryTrack] = []
    @State private var followLabels: [Int: String] = [:]
    @State private var filtering = false
    private var taskId: String {
        "\(model.libraryVersion)|\(model.downloaded.count)|\(search)|\(source.key)|\(sort.rawValue)|\(downloadedOnly)|\(tags.sorted())|\(bpmCenter ?? -1)|\(energy)|\(followReference ?? -1)"
    }
    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 2) {
                HStack(spacing: 8) {
                    Button("← A") { model.loadTarget = 0 }.foregroundStyle(Ink.decks[0]).frame(minWidth: 44, minHeight: 44)
                    Text("SWIPE A TRACK TO LOAD").font(Ink.font(9, bold: true)).foregroundStyle(Ink.muted).lineLimit(1).minimumScaleFactor(0.7)
                    Spacer(minLength: 0)
                    Button("B →") { model.loadTarget = 1 }.foregroundStyle(Ink.decks[1]).frame(minWidth: 44, minHeight: 44)
                    Button("BROWSE", action: onClose).buttonStyle(LibraryChipStyle(active: true)).frame(width: 66, height: 44)
                }
                // Match Android Library.kt: compact search capsule plus a separate FILTER key.
                // Keep a 44pt interaction row without inheriting the oversized system body font.
                HStack(spacing: 4) {
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass").font(.system(size: 14)).foregroundStyle(Ink.muted)
                        TextField("Search title, artist, file", text: $search)
                            .font(Ink.font(14)).foregroundStyle(Ink.text)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .submitLabel(.search).focused($searchFocused)
                            .accessibilityLabel("Search title, artist, file")
                        if !search.isEmpty {
                            Button { search = ""; searchFocused = true } label: {
                                Image(systemName: "xmark").font(.system(size: 12)).frame(width: 44, height: 44)
                            }.accessibilityLabel("Clear search")
                        }
                    }.padding(.leading, 12).frame(height: 38)
                        .background(Ink.crust, in: Capsule())
                        .overlay(Capsule().stroke(Ink.edge, lineWidth: 1))
                    Button { filtersOpen.toggle(); searchFocused = false } label: {
                        Text("FILTER").font(Ink.font(12, bold: true)).frame(width: 76, height: 38)
                            .background(filtersOpen ? Ink.accent.opacity(0.16) : Ink.crust, in: Capsule())
                            .overlay(Capsule().stroke(Ink.accent, lineWidth: 1))
                            .frame(height: 44).contentShape(Rectangle())
                    }.buttonStyle(.plain)
                        .foregroundStyle(filtersOpen || !tags.isEmpty || bpmCenter != nil || energy > 0 ? Ink.accent : Ink.muted)
                        .accessibilityLabel("Library filters").accessibilityValue(filtersOpen ? "Expanded" : "Collapsed")
                }.frame(height: 44)

                if !keyboardOpen { ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
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
                            Button(bpmCenter.map { String(format: "BPM %.0f ±6", $0) } ?? "BPM ≈ SELECTED") {
                                if bpmCenter != nil { bpmCenter = nil }
                                else { bpmCenter = model.snapshot?.tracks.first { $0.id == selectedTrack }?.bpm }
                            }.buttonStyle(LibraryChipStyle(active: bpmCenter != nil))
                                .disabled(bpmCenter == nil && model.snapshot?.tracks.first { $0.id == selectedTrack }?.bpm == nil)
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
                    Button { navigate(parent(of: source)) } label: {
                        Image(systemName: "chevron.left").frame(width: 44, height: 44)
                    }.disabled(source == .root).accessibilityLabel("Browser back")
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 4) {
                            ForEach(Array(path.enumerated()), id: \.offset) { index, node in
                                if index > 0 { Text("›").foregroundStyle(Ink.muted) }
                                Button(title(node).uppercased()) { navigate(node) }
                                    .frame(minHeight: 44).disabled(node == source)
                            }
                        }.font(Ink.font(11, bold: true))
                    }.foregroundStyle(Ink.accent)
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
                    Text("\(rows.count) \(rows.count == 1 ? "track" : "tracks") · \(model.downloaded.count) downloaded")
                    Spacer()
                    if filtering || model.busy { ProgressView().controlSize(.small) }
                }.font(Ink.font(11)).foregroundStyle(Ink.muted)
            }.padding(.horizontal, 8).padding(.vertical, 4).background(Ink.panel)
            if model.snapshot == nil {
                ContentUnavailableView("Bring your library", systemImage: "desktopcomputer", description: Text("Open manaDJ desktop → Settings → Phone sync. Pair this iPhone in Settings, then sync. Or import audio from Files on the Perform screen."))
            } else if source.isContainer {
                sourceList
            } else if rows.isEmpty && !filtering {
                ContentUnavailableView.search(text: search)
            } else {
                List(rows) { track in
                    // Android Library.kt SwipeToLoad: drag left → A, right → B,
                    // short travel or intentional flick commits on release, no full swipe.
                    SwipeToLoad(
                        loadA: { model.loadTarget = 0; if onLoad(track) { searchFocused = false } },
                        loadB: { model.loadTarget = 1; if onLoad(track) { searchFocused = false } },
                        background: selectedTrack == track.id ? Ink.accent.opacity(0.08) : Ink.base
                    ) {
                        HStack(spacing: 2) {
                            Button {
                                selectedTrack = selectedTrack == track.id ? nil : track.id
                            } label: {
                                Image(systemName: selectedTrack == track.id ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(selectedTrack == track.id ? Ink.accent : Ink.muted)
                                    .frame(width: 44, height: 44)
                            }.buttonStyle(.plain)
                                .accessibilityLabel("Select " + track.title)
                                .accessibilityValue(selectedTrack == track.id ? "Selected" : "Not selected")
                            Button {
                                let wasSearching = searchFocused
                                if onLoad(track) { searchFocused = false }
                                else { restoreSearchAfterError = wasSearching || !search.isEmpty }
                            } label: {
                                LibraryRow(track: track, downloaded: model.downloaded.contains(track.id), evidence: followLabels[track.id]).environmentObject(model)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .listRowBackground(selectedTrack == track.id ? Ink.accent.opacity(0.08) : Ink.base)
                    .listRowInsets(EdgeInsets(top: 0, leading: 2, bottom: 0, trailing: 8))
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
        private var path: [BrowserSource] {
            var nodes = [source]
            while let first = nodes.first, first != .root { nodes.insert(parent(of: first), at: 0) }
            return nodes
        }
        private func parent(of node: BrowserSource) -> BrowserSource {
            switch node {
            case .root, .collection, .playlists, .tags: return .root
            case .playlist: return .playlists
            case .category: return .tags
            case let .tag(id):
                return model.snapshot?.tags.first { $0.id == id }.map { .category($0.categoryId) } ?? .tags
            }
        }
        private func title(_ node: BrowserSource) -> String {
            switch node {
            case .root: return "Browse"
            case .collection: return "Collection"
            case .playlists: return "Playlists"
            case .tags: return "Tags"
            case let .playlist(id): return model.snapshot?.playlists.first { $0.id == id }?.name ?? "Playlist"
            case let .category(id): return model.snapshot?.categories.first { $0.id == id }?.name ?? "Uncategorised"
            case let .tag(id): return model.snapshot?.tags.first { $0.id == id }?.name ?? "Tag"
            }
        }
        private func navigate(_ node: BrowserSource) {
            source = node
            selectedTrack = nil
            searchFocused = false
            if case .playlist = node { sort = .playOrder }
            else if sort == .playOrder { sort = .dateAdded }
        }
        @ViewBuilder private var sourceList: some View {
            List {
                switch source {
                case .root:
                    sourceEntry(.collection, count: rows.count)
                    sourceEntry(.playlists, count: nil)
                    sourceEntry(.tags, count: nil)
                case .playlists:
                    ForEach((model.snapshot?.playlists ?? []).sorted { $0.displayOrder < $1.displayOrder }) { playlist in
                        sourceEntry(.playlist(playlist.id), count: rows.filter { playlist.trackIds.contains($0.id) }.count)
                    }
                    if model.snapshot?.playlists.isEmpty == true { Text("No playlists in this snapshot").foregroundStyle(Ink.muted) }
                case .tags:
                    ForEach(model.snapshot?.categories ?? [], id: \.id) { category in
                        let ids = Set((model.snapshot?.tags ?? []).filter { $0.categoryId == category.id }.map(\.id))
                        sourceEntry(.category(category.id), count: rows.filter { !ids.isDisjoint(with: $0.tagIds) }.count)
                    }
                    if model.snapshot?.categories.isEmpty == true { Text("No tags in this snapshot").foregroundStyle(Ink.muted) }
                case let .category(id):
                    ForEach((model.snapshot?.tags ?? []).filter { $0.categoryId == id }, id: \.id) { tag in
                        sourceEntry(.tag(tag.id), count: rows.filter { $0.tagIds.contains(tag.id) }.count)
                    }
                default: EmptyView()
                }
            }.listStyle(.plain).scrollContentBackground(.hidden)
        }
        private func sourceEntry(_ node: BrowserSource, count: Int?) -> some View {
            Button { navigate(node) } label: {
                HStack {
                    Text(title(node)).font(Ink.font(14, bold: true))
                    Spacer()
                    if let count { Text("\(count)").font(Ink.font(12)).foregroundStyle(Ink.muted) }
                    Image(systemName: "chevron.right").foregroundStyle(Ink.accent)
                }.frame(minHeight: 44).contentShape(Rectangle())
            }.buttonStyle(.plain).listRowBackground(Ink.base)
                .accessibilityIdentifier("source-" + node.key)
                .accessibilityValue(count.map { "\($0) tracks" } ?? "Folder")
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
            let scope = source
            let sourceTag: Int? = { if case let .tag(id) = scope { return id }; return nil }()
            let result = await Task.detached(priority: .userInitiated) { () -> ([LibraryTrack], [Int: String]) in
                let library = Library(snapshot, downloaded: { offline.contains($0.id) })
                if let reference, !scope.isContainer {
                    let ranked = library.follow([reference], within: query)
                    return (ranked.map(\.track).filter { track in sourceTag.map { track.tagIds.contains($0) } ?? true }, Dictionary(uniqueKeysWithValues: ranked.map { ($0.id, $0.label) }))
                }
                return (library.query(query).filter { track in sourceTag.map { track.tagIds.contains($0) } ?? true }, [:])
            }.value
            guard !Task.isCancelled else { return }
            rows = result.0; followLabels = result.1; filtering = false
        }
    }

    private struct LibraryChipStyle: ButtonStyle {
        var active = false
        func makeBody(configuration: Configuration) -> some View {
            configuration.label.font(Ink.font(10, bold: true)).lineLimit(1).padding(.horizontal, 8).frame(height: 28)
                .foregroundStyle(active ? Ink.accent : Ink.muted)
                .background(active || configuration.isPressed ? Ink.accent.opacity(0.13) : Ink.crust, in: Capsule())
                .overlay(Capsule().stroke(active ? Ink.accent : Ink.muted.opacity(0.65), lineWidth: 1))
                .frame(minHeight: 44).contentShape(Rectangle())
        }
    }

    private struct LibraryRow: View {
        @EnvironmentObject var model: AppModel
        let track: LibraryTrack
        let downloaded: Bool
        let evidence: String?
        @State private var waveform: PreviewWaveform?
        @State private var previewChecked = false
        var body: some View {
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .top, spacing: 10) {
                    VStack(spacing: 2) {
                        Text(track.bpm.map { String(format: "%.1f", $0) } ?? "--").foregroundStyle(Ink.decks[1])
                        Text(track.keyOpenKey ?? "--").foregroundStyle(Ink.play)
                    }.font(Ink.font(12, bold: true)).frame(width: 48)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(track.title).font(Ink.font(13, bold: true)).foregroundStyle(Ink.text).lineLimit(1)
                        Text(track.artist ?? track.fileName).font(Ink.font(11)).foregroundStyle(Ink.muted).lineLimit(1)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: downloaded ? "checkmark.circle.fill" : "icloud.and.arrow.down").font(.system(size: 11)).foregroundStyle(downloaded ? Ink.play : Ink.muted).accessibilityLabel(downloaded ? "Downloaded" : "Download required")
                }
                HStack(spacing: 6) {
                    if let waveform, !waveform.peaks.isEmpty {
                        WaveformView(waveform: waveform, color: Ink.accent, background: .clear).frame(width: 102, height: 16)
                            .accessibilityIdentifier("library-row-preview-\(track.id)")
                    } else {
                        Text(track.previewRev == nil ? "No preview on desktop" : (previewChecked ? "Preview unavailable locally" : "Loading preview…"))
                            .font(Ink.font(8)).foregroundStyle(Ink.muted)
                            .accessibilityIdentifier("library-row-preview-status-\(track.id)")
                    }
                    ForEach(track.tagIds.prefix(3), id: \.self) { id in
                        if let tag = model.snapshot?.tags.first(where: { $0.id == id }) {
                            Text(tag.name).font(Ink.font(9)).foregroundStyle(Ink.accent).padding(.horizontal, 3).background(Ink.accent.opacity(0.15), in: RoundedRectangle(cornerRadius: 3))
                        }
                    }
                    Spacer(minLength: 0)
                    Text(track.durationSecs.map(Ink.clock) ?? "--:--").font(Ink.font(9)).foregroundStyle(Ink.muted)
                }
                if let evidence { Text(evidence).font(Ink.font(10)).foregroundStyle(Ink.accent) }
            }.padding(.vertical, 2).frame(minHeight: 44)
            .task(id: "\(track.id)-\(track.previewRev ?? "none")-\(model.libraryVersion)") { previewChecked = false; waveform = await model.preview(track); previewChecked = true }
        }
    }

    private enum BrowserSource: Equatable, Sendable {
        case root, collection, playlists, playlist(Int), tags, category(Int), tag(Int)
        var isContainer: Bool {
            switch self { case .root, .playlists, .tags, .category: return true; default: return false }
        }
        var key: String {
            switch self {
            case .root: return "root"
            case .collection: return "collection"
            case .playlists: return "playlists"
            case let .playlist(id): return "playlist-\(id)"
            case .tags: return "tags"
            case let .category(id): return "category-\(id)"
            case let .tag(id): return "tag-\(id)"
            }
        }
    }
