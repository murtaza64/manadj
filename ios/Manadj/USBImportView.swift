import SwiftUI
import ManadjCore
import UniformTypeIdentifiers

/// Separate app-owned imports. Never merges into the paired desktop snapshot.
struct USBImportView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var choosing = false
    @State private var working = false
    @State private var source: URL?
    @State private var preview: USBImportPreview?
    @State private var selected: Set<Int> = []
    @State private var message: String?
    @State private var imported: [(URL, USBImportReceipt)] = []
    @State private var fixtureImports = FileManager.default.temporaryDirectory.appendingPathComponent("usb-import-output-" + UUID().uuidString)
    private var imports: URL {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--usb-ui-fixture") { return fixtureImports }
        #endif
        return FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("USBImports")
    }
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button("Choose Rekordbox USB folder") { choosing = true }.disabled(working)
                    Text("Choose the drive's top folder in Files. Classic export.pdb only. Preview reads the USB; Import copies selected audio into this app and leaves the USB untouched.")
                        .font(Ink.font(11)).foregroundStyle(Ink.muted)
                    Text("Prototype: no OneLibrary, cue/grid/analysis import, USB export or physical-drive validation. Audio still needs to decode successfully on this iPhone.")
                        .font(Ink.font(11)).foregroundStyle(Ink.warning)
                    if working { ProgressView("Reading USB") }
                    if let message { Text(message).font(Ink.font(12)).accessibilityIdentifier("usb-status") }
                }
                if let preview {
                    Section("Preview · \(preview.available.count) available / \(preview.tracks.count) tracks") {
                        ForEach(preview.tracks) { item in
                            HStack {
                                Button {
                                    if selected.contains(item.id) { selected.remove(item.id) } else { selected.insert(item.id) }
                                } label: {
                                    Image(systemName: selected.contains(item.id) ? "checkmark.circle.fill" : "circle").frame(width: 44, height: 44)
                                }.buttonStyle(.plain).disabled(item.issue != nil || working)
                                    .accessibilityLabel("Import " + item.track.title)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(item.track.title).font(Ink.font(13, bold: true))
                                    Text(item.issue ?? (item.track.artist ?? item.track.path)).font(Ink.font(11)).foregroundStyle(item.issue == nil ? Ink.muted : Ink.warning)
                                }
                            }
                        }
                        Text("Selected audio: " + ByteCountFormatter.string(fromByteCount: preview.available.filter { selected.contains($0.id) }.reduce(Int64(0)) { $0 + Int64($1.track.byteCount) }, countStyle: .file)).font(Ink.font(11)).foregroundStyle(Ink.muted)
                        Button("Import \(selected.count) selected") { copy() }.disabled(working || selected.isEmpty)
                            .accessibilityIdentifier("usb-confirm-import")
                    }
                    Section("USB playlists · preview") {
                        ForEach(preview.library.playlists) { playlist in
                            HStack { Image(systemName: playlist.folder ? "folder" : "music.note.list"); Text(playlist.name); Spacer(); Text("\(playlist.trackIds.count)") }.font(Ink.font(12))
                        }
                    }
                }
                ForEach(imported, id: \.0) { folder, receipt in
                    Section("On this iPhone · USB import") {
                        ForEach(receipt.tracks) { track in
                            VStack(alignment: .leading) {
                                Text(track.title).font(Ink.font(13, bold: true))
                                HStack {
                                    ForEach(0..<2) { index in
                                        Button("Load \(Ink.deckName(index))") {
                                            model.importFile(folder.appendingPathComponent(track.path), deck: index, title: track.title, artist: track.artist)
                                            dismiss()
                                        }.buttonStyle(FlatButtonStyle(color: Ink.decks[index]))
                                    }
                                }
                            }
                        }
                    }
                }
            }.scrollContentBackground(.hidden).background(Ink.base)
                .navigationTitle("Rekordbox USB").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }.preferredColorScheme(.dark).tint(Ink.accent)
            .fileImporter(isPresented: $choosing, allowedContentTypes: [.folder]) { result in
                switch result {
                case let .success(url): scan(url)
                case let .failure(error): message = error.localizedDescription
                }
            }
            .task {
                refresh()
                #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("--usb-ui-fixture"), let fixture = makeFixture() { scan(fixture) }
                #endif
            }
    }
    private func scan(_ url: URL) {
        guard !working else { return }
        working = true; preview = nil; selected = []; source = url; message = nil
        Task {
            do {
                let result = try await Task.detached(priority: .userInitiated) {
                    let allowed = url.startAccessingSecurityScopedResource()
                    defer { if allowed { url.stopAccessingSecurityScopedResource() } }
                    return try RekordboxUSBPreview.scan(root: url)
                }.value
                preview = result
                selected = Set(result.available.map(\.id))
                message = "Preview only. Nothing copied."
            } catch { message = error.localizedDescription }
            working = false
        }
    }
    private func copy() {
        guard !working, let source, let preview else { return }
        let selected = selected, destination = imports
        working = true
        Task {
            do {
                _ = try await Task.detached(priority: .userInitiated) {
                    let allowed = source.startAccessingSecurityScopedResource()
                    defer { if allowed { source.stopAccessingSecurityScopedResource() } }
                    return try RekordboxUSBCopy.copy(root: source, preview: preview, selected: selected, destination: destination)
                }.value
                self.preview = nil; self.selected = []
                message = "Imported \(selected.count) track\(selected.count == 1 ? "" : "s") into this iPhone. USB unchanged."
                refresh()
            } catch { message = error.localizedDescription }
            working = false
        }
    }
    private func refresh() {
        imported = ((try? FileManager.default.contentsOfDirectory(at: imports, includingPropertiesForKeys: nil)) ?? []).compactMap { url in
            guard !url.lastPathComponent.hasPrefix("."), let data = try? Data(contentsOf: url.appendingPathComponent("import.json")), let receipt = try? JSONDecoder().decode(USBImportReceipt.self, from: data) else { return nil }
            return (url, receipt)
        }
    }
    #if DEBUG
    private func makeFixture() -> URL? {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("usb-ui-" + UUID().uuidString)
        do {
            guard let db = Bundle.main.url(forResource: "synthetic-usb-export", withExtension: "pdb"), let audio = Bundle.main.url(forResource: "synthetic-A", withExtension: "wav") else { return nil }
            let database = root.appendingPathComponent("PIONEER/rekordbox/export.pdb")
            try FileManager.default.createDirectory(at: database.deletingLastPathComponent(), withIntermediateDirectories: true)
            try FileManager.default.copyItem(at: db, to: database)
            let contents = root.appendingPathComponent("Contents")
            try FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
            try FileManager.default.copyItem(at: audio, to: contents.appendingPathComponent("tone1.wav"))
            return root
        } catch { return nil }
    }
    #endif
}
