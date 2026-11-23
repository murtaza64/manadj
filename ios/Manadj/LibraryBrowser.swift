import SwiftUI
import UIKit
import ManadjCore

struct LibraryBrowser: View {
    @EnvironmentObject var model: AppModel
    var onClose: () -> Void = {}
    var onDrawerPull: (CGFloat) -> Void = { _ in }
    var onDrawerRelease: (CGFloat, CGFloat) -> Void = { _, _ in }
    var onLoad: (LibraryTrack) -> Bool
    var visibleDeckIndices = [0, 1]
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
    @State private var followEnabled = false
    @State private var tagsOpen = false
    @State private var tagMatch: TagMatch = .any
    @State private var playlistMenu = false
    @State private var playlistSearch = ""
    @State private var followMatches: [Int: [Int]] = [:]
    private var visibleFollowDecks: [BrowseFollowPolicy.Deck] {
        visibleDeckIndices.filter { model.decks.indices.contains($0) }.map {
            BrowseFollowPolicy.Deck(index: $0, trackId: model.decks[$0].track?.id, playing: model.decks[$0].engine.playing)
        }
    }
    private var referenceDecks: [BrowseFollowPolicy.Deck] { BrowseFollowPolicy.references(visibleFollowDecks) }
    private var followKey: String { followEnabled ? referenceDecks.map { "\($0.index):\($0.trackId ?? -1)" }.joined(separator: ",") + ":\(BrowseFollowPolicy.isPracticePause(visibleFollowDecks))" : "off" }
    @State private var selectedTrack: Int? = nil
    @State private var rows: [LibraryTrack] = []
    @State private var followLabels: [Int: String] = [:]
    @State private var filtering = false
    @State private var firstRowTiming = "awaiting first row"
    @State private var panDiagnostic = "probe=not-reported"
    private var taskId: String {
        "\(model.libraryVersion)|\(model.downloaded.count)|\(search)|\(source.key)|\(sort.rawValue)|\(downloadedOnly)|\(tags.sorted())|\(bpmCenter ?? -1)|\(energy)|\(tagMatch == .all)|\(followKey)"
    }
    var body: some View {
        VStack(spacing: 0) {
            if !playlistMenu {
            VStack(spacing: 2) {
                HStack(spacing: 8) {
                    Button("← A") { model.loadTarget = 0 }.foregroundStyle(Ink.decks[0]).frame(minWidth: 44, minHeight: 44)
                    Text("SWIPE A TRACK TO LOAD").font(Ink.font(9, bold: true)).foregroundStyle(Ink.muted).lineLimit(1).minimumScaleFactor(0.7)
                    Spacer(minLength: 0)
                    Button("B →") { model.loadTarget = 1 }.foregroundStyle(Ink.decks[1]).frame(minWidth: 44, minHeight: 44)
                    Button("BROWSE", action: onClose).accessibilityIdentifier("browser-close").buttonStyle(LibraryChipStyle(active: true)).frame(width: 66, height: 44)
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
                        Text("FILTER ⋮").font(Ink.font(12, bold: true)).frame(width: 76, height: 38)
                            .background(filtersOpen ? Ink.accent.opacity(0.16) : Ink.crust, in: Capsule())
                            .overlay(Capsule().stroke(Ink.accent, lineWidth: 1))
                            .frame(height: 44).contentShape(Rectangle())
                    }.buttonStyle(.plain)
                        .foregroundStyle(filtersOpen || !tags.isEmpty || bpmCenter != nil || energy > 0 ? Ink.accent : Ink.muted)
                        .accessibilityLabel("Library filters").accessibilityValue(filtersOpen ? "Expanded" : "Collapsed")
                }.frame(height: 44)

                if !keyboardOpen {
                    HStack(spacing: 6) {
                        Button { playlistMenu = true; searchFocused = false } label: {
                            HStack(spacing: 4) { Text(playlist.map { id in model.snapshot?.playlists.first { $0.id == id }?.name ?? "Playlists" } ?? "Playlists").lineLimit(1); Image(systemName: "chevron.right").font(.system(size: 8)) }
                        }.buttonStyle(LibraryChipStyle(active: playlist != nil)).accessibilityIdentifier("browse-playlists")
                        Button { followEnabled.toggle() } label: { Text("FOLLOW").lineLimit(1) }
                            .buttonStyle(LibraryChipStyle(active: followEnabled)).accessibilityValue(followEnabled ? "On" : "Off").accessibilityIdentifier("browse-follow")
                        Button { tagsOpen.toggle() } label: { Text(tags.isEmpty ? "TAGS" : "TAGS \(tags.count)") }
                            .buttonStyle(LibraryChipStyle(active: tagsOpen || !tags.isEmpty)).accessibilityIdentifier("browse-tags")
                        Spacer(minLength: 0)
                        Button { model.sync() } label: { Image(systemName: "arrow.triangle.2.circlepath").frame(width: 44, height: 44) }.disabled(model.busy).accessibilityLabel("Sync library")
                    }.frame(height: 44)
                    if tagsOpen {
                        HStack(spacing: 5) {
                            TagMatchSwitch(mode: $tagMatch)
                            ScrollView(.horizontal, showsIndicators: true) {
                                HStack(spacing: 5) {
                                    ForEach(model.snapshot?.tags ?? [], id: \.id) { tag in
                                        Button { if tags.contains(tag.id) { tags.remove(tag.id) } else { tags.insert(tag.id) } } label: {
                                            TagBadge(tag: tag, active: tags.contains(tag.id))
                                                .frame(minHeight: 44).contentShape(Rectangle())
                                        }.buttonStyle(.plain).accessibilityLabel("Filter tag " + tag.name).accessibilityValue(tags.contains(tag.id) ? "Selected" : "Not selected")
                                    }
                                }
                            }.accessibilityLabel("Tags, scroll horizontally")
                            Button("Clear") { tags = [] }.font(Ink.font(10)).frame(minWidth: 44, minHeight: 44).disabled(tags.isEmpty).accessibilityLabel("Clear tag selections")
                        }
                    }
                    if filtersOpen {
                        ScrollView(.horizontal, showsIndicators: true) {
                            HStack(spacing: 6) {
                                Menu(sort.rawValue.uppercased()) { ForEach(SortColumn.allCases, id: \.rawValue) { c in Button(c.rawValue) { sort = c } } }.buttonStyle(LibraryChipStyle())
                                Button("ON PHONE") { downloadedOnly.toggle() }.buttonStyle(LibraryChipStyle(active: downloadedOnly))
                                Button(bpmCenter.map { String(format: "BPM %.0f ±6", $0) } ?? "BPM ≈ SELECTED") {
                                    if bpmCenter != nil { bpmCenter = nil } else { bpmCenter = model.snapshot?.tracks.first { $0.id == selectedTrack }?.bpm }
                                }.buttonStyle(LibraryChipStyle(active: bpmCenter != nil)).accessibilityLabel("BPM filter")
                                    .disabled(bpmCenter == nil && model.snapshot?.tracks.first { $0.id == selectedTrack }?.bpm == nil)
                                Menu(energy == 0 ? "ENERGY" : "ENERGY \(energy)") { Button("Any energy") { energy = 0 }; ForEach(1...5, id: \.self) { n in Button("Energy \(n)") { energy = n } } }.buttonStyle(LibraryChipStyle(active: energy > 0))
                                Button("RESET") { tags = []; bpmCenter = nil; energy = 0 }.buttonStyle(LibraryChipStyle()).accessibilityLabel("Reset library filters")
                            }.frame(minHeight: 44)
                        }
                    }
                }
                HStack {
                    Text("\(rows.count) tracks · " + (followEnabled ? "Follow " + referenceDecks.map { Ink.deckName($0.index) }.joined(separator: "+") : sort.rawValue))
                    Spacer()
                    if filtering || model.busy { ProgressView().controlSize(.small) }
                }.font(Ink.font(11)).foregroundStyle(Ink.muted)
            }.padding(.horizontal, 8).padding(.vertical, 4).background(Ink.panel)
            }
            if model.snapshot == nil {
                ContentUnavailableView("Bring your library", systemImage: "desktopcomputer", description: Text("Open manaDJ desktop → Settings → Phone sync. Pair this iPhone in Settings, then sync. Or import audio from Files on the Perform screen."))
            } else if playlistMenu {
                playlistPicker
            } else if rows.isEmpty && !filtering {
                ContentUnavailableView.search(text: search)
            } else {
                ScrollView { LazyVStack(spacing: 0) { ForEach(rows) { track in
                    // Android Library.kt SwipeToLoad: drag left → A, right → B,
                    // short travel or intentional flick commits on release, no full swipe.
                    SwipeToLoad(
                        loadA: { model.loadTarget = 0; if onLoad(track) { searchFocused = false } },
                        loadB: { model.loadTarget = 1; if onLoad(track) { searchFocused = false } },
                        tap: {
                            let wasSearching = searchFocused
                            if onLoad(track) { searchFocused = false }
                            else { restoreSearchAfterError = wasSearching || !search.isEmpty }
                        },
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
                            LibraryRow(track: track, downloaded: model.downloaded.contains(track.id), evidence: followLabels[track.id], selectedTags: tags, matchedDecks: followMatches[track.id] ?? []).environmentObject(model)
                        }
                    }
                    .onAppear {
                        #if DEBUG
                        if let began = model.browserOpenStarted {
                            firstRowTiming = String(format: "nativeTapToRowAppearMs=%.3f rows=%d", (ProcessInfo.processInfo.systemUptime - began) * 1000, rows.count)
                            model.browserOpenStarted = nil
                        }
                        #endif
                    }
                    .padding(.leading, 2).padding(.trailing, 8)
                    .overlay(alignment: .bottom) { Rectangle().fill(Ink.edge).frame(height: 0.5) }
                    .contextMenu { if let bpm = track.bpm { Button("Match BPM ±6") { bpmCenter = bpm; filtersOpen = true } }; ForEach(0..<4) { index in Button("Load deck \(Ink.deckName(index))") { if model.load(track, deck: index) { searchFocused = false } } } }
                } } }.scrollDismissesKeyboard(.interactively)
                    .overlay(alignment: .topLeading) {
                        BrowserTopPull(changed: onDrawerPull, ended: onDrawerRelease, diagnostic: { panDiagnostic = $0 })
                            .frame(width: 1, height: 1).allowsHitTesting(false)
                    }
                    .accessibilityIdentifier("library-track-list")
                    .accessibilityValue(firstRowTiming + " " + panDiagnostic)
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
        private var playlistPicker: some View {
            VStack(spacing: 0) {
                HStack {
                    Button { playlistMenu = false } label: { Label("Browse", systemImage: "chevron.left") }.frame(minHeight: 44).accessibilityLabel("Back to Browse")
                    Spacer(); Text("PLAYLISTS").font(Ink.font(12, bold: true)); Spacer()
                }.padding(.horizontal, 8)
                TextField("Search playlists", text: $playlistSearch).font(Ink.font(13)).textInputAutocapitalization(.never).autocorrectionDisabled().padding(10).background(Ink.crust).padding(.horizontal, 8)
                List {
                    Button("All tracks") { navigate(.collection); playlistMenu = false }.listRowBackground(Ink.base).accessibilityIdentifier("source-collection")
                    ForEach((model.snapshot?.playlists ?? []).filter { playlistSearch.isEmpty || $0.name.localizedCaseInsensitiveContains(playlistSearch) }.sorted { $0.displayOrder < $1.displayOrder }) { playlist in
                        Button { navigate(.playlist(playlist.id)); playlistMenu = false } label: {
                            HStack { Text(playlist.name); Spacer(); Text("\(playlist.trackIds.count)").foregroundStyle(Ink.muted); Image(systemName: "chevron.right") }.font(Ink.font(13)).frame(minHeight: 44)
                        }.listRowBackground(Ink.base).accessibilityIdentifier("source-playlist-\(playlist.id)").accessibilityValue("\(playlist.trackIds.count) tracks")
                    }
                }.listStyle(.plain).scrollContentBackground(.hidden)
            }.background(Ink.base)
        }
        private func navigate(_ node: BrowserSource) {
            source = node
            selectedTrack = nil
            searchFocused = false
            if case .playlist = node { sort = .playOrder }
            else if sort == .playOrder { sort = .dateAdded }
        }
        private func filter() async {
            guard let snapshot = model.snapshot else { rows = []; return }
            filtering = true
            var q = LibraryQuery()
            q.search = search; q.playlistId = playlist; q.sort = sort; q.descending = sort == .dateAdded
            q.downloadedOnly = downloadedOnly; q.tagIds = tags
            q.bpmCenter = bpmCenter; q.bpmTolerance = 6
            q.energy = energy > 0 ? energy...energy : nil
            let scope = source
            let sourceTag: Int? = { if case let .tag(id) = scope { return id }; return nil }()
            q.tagMatch = tagMatch
            let offline = model.downloaded
            let references = followEnabled ? BrowseFollowPolicy.trackIds(referenceDecks) : []
            let shouldFollow = followEnabled
            let decks = referenceDecks
            let paused = BrowseFollowPolicy.isPracticePause(visibleFollowDecks)
            let query = q
            let result = await Task.detached(priority: .userInitiated) { () -> ([LibraryTrack], [Int: String], [Int: [Int]]) in
                let library = Library(snapshot, downloaded: { offline.contains($0.id) })
                if shouldFollow {
                    var params = snapshot.performance.follow
                    params.sharedMatchBonus = paused ? 2 : 0
                    let ranked = library.follow(references, params: params, within: query)
                    let matches = Dictionary(uniqueKeysWithValues: ranked.map { row in
                        let ids = Set(row.referenceMatches.map(\.referenceId))
                        return (row.id, decks.filter { $0.trackId.map(ids.contains) ?? false }.map(\.index))
                    })
                    return (ranked.map(\.track).filter { sourceTag.map($0.tagIds.contains) ?? true }, Dictionary(uniqueKeysWithValues: ranked.map { ($0.id, $0.label) }), matches)
                }
                let request = BrowserQueryRequest(query: query, downloadedIds: offline, referenceId: nil,
                    sourceIsContainer: scope.isContainer, sourceTagId: sourceTag)
                let plain = request.evaluate(snapshot)
                return (plain.rows, plain.followLabels, [:])
            }.value
            guard !Task.isCancelled else { return }
            rows = result.0; followLabels = result.1; followMatches = result.2; filtering = false
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
        let selectedTags: Set<Int>
        let matchedDecks: [Int]
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
                        Text(track.artist?.isEmpty == false ? track.artist! : "Unknown artist").font(Ink.font(11)).foregroundStyle(Ink.muted).lineLimit(1)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                    HStack(spacing: 2) { ForEach(matchedDecks, id: \.self) { deck in Text(Ink.deckName(deck)).font(Ink.font(9, bold: true)).foregroundStyle(Ink.decks[deck]) } }
                    Image(systemName: downloaded ? "checkmark.circle.fill" : "icloud.and.arrow.down").font(.system(size: 11)).foregroundStyle(downloaded ? Ink.play : Ink.muted).accessibilityLabel(downloaded ? "Downloaded" : "Download required")
                }
                HStack(spacing: 6) {
                    if let waveform, !waveform.peaks.isEmpty {
                        LibraryPreviewWave(waveform: waveform, track: track, styleJSON: model.snapshot?.settings["manadj.waveformStyles"]?.json, revision: model.libraryVersion)
                            .accessibilityIdentifier("library-row-preview-\(track.id)")
                    } else {
                        Text(track.previewRev == nil ? "No preview on desktop" : (previewChecked ? "Preview unavailable locally" : "Loading preview…"))
                            .font(Ink.font(8)).foregroundStyle(Ink.muted)
                            .frame(width: 110, height: 19)
                            .accessibilityIdentifier("library-row-preview-status-\(track.id)")
                    }
                    TrackTagRail(track: track, allTags: model.snapshot?.tags ?? [], selected: selectedTags)
                    Spacer(minLength: 0)
                    Text(track.durationSecs.map(Ink.clock) ?? "--:--").font(Ink.font(9)).foregroundStyle(Ink.muted)
                }
                if let evidence, evidence != "Compatible" { Text(evidence).font(Ink.font(10)).foregroundStyle(Ink.accent) }
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

private struct TagBadge: View {
    let tag: LibraryTag
    var active: Bool
    private var selectedText: Color {
        guard let value = parseHexColor(tag.color) else { return .black }
        let r = Double((value >> 16) & 255) / 255, g = Double((value >> 8) & 255) / 255, b = Double(value & 255) / 255
        return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.52 ? .black : .white
    }
    private var color: Color {
        guard let value = parseHexColor(tag.color) else { return Ink.accent }
        return Color(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
    }
    var body: some View {
        Text(tag.name).font(Ink.font(9, bold: active)).lineLimit(1)
            .foregroundStyle(active ? selectedText : color.opacity(0.9))
            .padding(.horizontal, 4).padding(.vertical, 2)
            .background(active ? color : color.opacity(0.12), in: RoundedRectangle(cornerRadius: 4))
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(color.opacity(active ? 1 : 0.35), lineWidth: 0.5))
    }
}

private struct TagMatchSwitch: View {
    @Binding var mode: TagMatch
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    var body: some View {
        Button { withAnimation(.spring(response: 0.25, dampingFraction: 0.85)) { mode = mode == .any ? .all : .any } } label: {
            ZStack(alignment: mode == .any ? .leading : .trailing) {
                Capsule().fill(Ink.crust)
                lens.frame(width: 43, height: 26).padding(2)
                HStack(spacing: 0) { Text("ANY").frame(maxWidth: .infinity); Text("ALL").frame(maxWidth: .infinity) }
                    .font(Ink.font(10, bold: true)).foregroundStyle(Ink.text)
            }.frame(width: 92, height: 30).overlay(Capsule().stroke(Ink.edge))
                .frame(minHeight: 44).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityLabel("Tag matching").accessibilityValue(mode == .any ? "Any selected tag" : "All selected tags")
            .accessibilityHint("Double tap to switch matching mode").accessibilityIdentifier("tag-match-mode")
    }
    @ViewBuilder private var lens: some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *), !reduceTransparency {
            Capsule().fill(Ink.accent.opacity(0.18)).glassEffect(.regular.tint(Ink.accent.opacity(0.2)).interactive(), in: Capsule())
        } else { Capsule().fill(Ink.accent.opacity(reduceTransparency ? 0.7 : 0.35)) }
        #else
        Capsule().fill(Ink.accent.opacity(reduceTransparency ? 0.7 : 0.35))
        #endif
    }
}

private struct TrackTagRail: View {
    let track: LibraryTrack
    let allTags: [LibraryTag]
    let selected: Set<Int>
    @State private var expanded = false
    private var tags: [LibraryTag] {
        let values = track.tagIds.compactMap { id in allTags.first { $0.id == id } }
        return values.enumerated().sorted {
            let a = selected.contains($0.element.id), b = selected.contains($1.element.id)
            return a == b ? $0.offset < $1.offset : a
        }.map(\.element)
    }
    var body: some View {
        GeometryReader { geometry in
            // Width-aware measured layout; disclosure reserves its own space.
            let visible = visibleTags(width: geometry.size.width)
            let hidden = tags.count - visible.count
            HStack(spacing: 3) {
                VStack(alignment: .leading, spacing: 1) {
                    ForEach(Array(lines(visible, width: max(0, geometry.size.width - (hidden > 0 ? disclosureWidth + 3 : 0))).enumerated()), id: \.offset) { _, row in
                        HStack(spacing: 3) { ForEach(row, id: \.id) { tag in TagBadge(tag: tag, active: selected.contains(tag.id)) } }
                    }
                }
                if hidden > 0 { Button("+\(hidden)") { expanded = true }.font(Ink.font(9)).frame(width: disclosureWidth, height: 44).accessibilityLabel("Show all \(tags.count) tags").accessibilityIdentifier("track-tags-\(track.id)") }
            }
        }.frame(minWidth: 0, maxWidth: .infinity).frame(height: 44)
            .sheet(isPresented: $expanded) {
                NavigationStack { List(tags, id: \.id) { tag in TagBadge(tag: tag, active: selected.contains(tag.id)).frame(minHeight: 32) }
                    .navigationTitle("Track tags").toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { expanded = false } } } }
                    .presentationDetents([.medium, .large])
            }
    }
    private var disclosureWidth: CGFloat {
        let base = UIFont(name: "UbuntuMono-Regular", size: 9) ?? .monospacedSystemFont(ofSize: 9, weight: .regular)
        let font = UIFontMetrics(forTextStyle: .body).scaledFont(for: base)
        return max(44, ceil(("+\(tags.count)" as NSString).size(withAttributes: [.font: font]).width) + 8)
    }
    private func width(_ tag: LibraryTag) -> CGFloat {
        let name = selected.contains(tag.id) ? "UbuntuMono-Bold" : "UbuntuMono-Regular"
        let base = UIFont(name: name, size: 9) ?? UIFont.monospacedSystemFont(ofSize: 9, weight: .regular)
        let font = UIFontMetrics(forTextStyle: .body).scaledFont(for: base)
        return ceil((tag.name as NSString).size(withAttributes: [.font: font]).width) + 8
    }
    private func lines(_ values: [LibraryTag], width limit: CGFloat) -> [[LibraryTag]] {
        var result: [[LibraryTag]] = [[]]; var used: CGFloat = 0
        for tag in values {
            let size = width(tag)
            if !result[result.count - 1].isEmpty && used + 3 + size > limit { result.append([]); used = 0 }
            result[result.count - 1].append(tag); used += (used == 0 ? 0 : 3) + size
        }
        return result
    }
    private func visibleTags(width available: CGFloat) -> [LibraryTag] {
        if lines(tags, width: available).count <= 2 && tags.allSatisfy({ width($0) <= available }) { return tags }
        var result: [LibraryTag] = []
        for tag in tags {
            guard width(tag) <= max(0, available - disclosureWidth - 3), lines(result + [tag], width: max(0, available - disclosureWidth - 3)).count <= 2 else { break }
            result.append(tag)
        }
        return result
    }
}
