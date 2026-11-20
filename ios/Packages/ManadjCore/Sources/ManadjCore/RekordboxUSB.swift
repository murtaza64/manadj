import Foundation
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

public struct USBReadError: Error, LocalizedError, Sendable {
    public let message: String
    public var errorDescription: String? { message }
}
public struct USBTrack: Sendable, Equatable, Identifiable, Codable {
    public let id: Int
    public let title: String
    public let artist: String?
    public let bpm: Double?
    public let duration: Int
    public let byteCount: Int
    public let path: String
}
public struct USBPlaylist: Sendable, Equatable, Identifiable, Codable {
    public let id: Int
    public let parent: Int
    public let order: Int
    public let folder: Bool
    public let name: String
    public let trackIds: [Int]
}
public struct USBLibrary: Sendable {
    public let tracks: [USBTrack]
    public let playlists: [USBPlaylist]
}

/// Bounded read-only classic DeviceSQL subset. No database or USB writes.
/// Format references: the repository's rekordbox/device/ksy/rekordbox_pdb.ksy
/// (Deep-Symmetry/crate-digger, EPL-1.0) and independent pdb_write.py fixtures.
/// This is not a generated-parser port or OneLibrary/ANLZ implementation.
public enum RekordboxUSBReader {
    public static let maximumBytes = 64 * 1024 * 1024
    public static func read(_ data: Data) throws -> USBLibrary {
        guard data.count >= 28, data.count <= maximumBytes else { throw failure("Invalid or oversized classic USB database") }
        let bytes = Array(data)
        let root = USBBytes(bytes, start: 0, end: bytes.count)
        let pageSize = try root.u32(4), tableCount = try root.u32(8)
        guard try root.u32(0) == 0, pageSize >= 512, pageSize <= 65536,
              pageSize.nonzeroBitCount == 1, bytes.count % pageSize == 0,
              tableCount <= 64, 28 + tableCount * 16 <= pageSize else { throw failure("Unsupported USB database header") }
        var rawTracks: [(Int, Int, String, String, Int, Int, Int)] = []
        var artists: [Int: String] = [:]
        var nodes: [(Int, Int, Int, Bool, String)] = []
        var entries: [Int: [(Int, Int)]] = [:]
        var types: Set<Int> = [], trackIds: Set<Int> = [], nodeIds: Set<Int> = []
        var totalRows = 0
        for table in 0..<tableCount {
            let header = 28 + table * 16
            let type = try root.u32(header)
            guard types.insert(type).inserted else { throw failure("Duplicate USB table") }
            var index = try root.u32(header + 8)
            let last = try root.u32(header + 12)
            var seen: Set<Int> = []
            while true {
                guard index > 0, index < bytes.count / pageSize, seen.insert(index).inserted else { throw failure("Invalid or cyclic USB page chain") }
                let base = index * pageSize
                let page = USBBytes(bytes, start: base, end: base + pageSize)
                guard try page.u32(0) == 0, try page.u32(4) == index, try page.u32(8) == type else { throw failure("USB table page identity mismatch") }
                let next = try page.u32(12)
                if try page.u8(27) & 0x40 == 0 {
                    let allocated = try page.u16(24) & 0x1fff
                    let groups = (allocated + 15) / 16
                    let directoryStart = pageSize - groups * 36
                    guard directoryStart >= 40 else { throw failure("USB row directory overlaps header") }
                    var offsets: [Int] = []
                    for group in 0..<groups {
                        let end = pageSize - group * 36
                        let present = try page.u16(end - 4)
                        for slot in 0..<16 where present & (1 << slot) != 0 {
                            guard group * 16 + slot < allocated else { throw failure("USB row presence exceeds allocation") }
                            let offset = try page.u16(end - 6 - slot * 2) + 40
                            guard offset >= 40, offset < directoryStart else { throw failure("USB row outside heap") }
                            offsets.append(offset)
                        }
                    }
                    guard Set(offsets).count == offsets.count else { throw failure("Duplicate USB row offset") }
                    let sortedOffsets = offsets.sorted()
                    totalRows += offsets.count
                    guard totalRows <= 200_000 else { throw failure("USB row limit exceeded") }
                    for offset in offsets {
                        let end = sortedOffsets.first { $0 > offset } ?? directoryStart
                        let row = USBBytes(bytes, start: base + offset, end: base + end)
                        switch type {
                        case 0:
                            let id = try row.u32(72)
                            guard id > 0, trackIds.insert(id).inserted else { throw failure("Duplicate or invalid USB track") }
                            let title = try row.text(row.u16(94 + 17 * 2))
                            let path = try row.text(row.u16(94 + 20 * 2))
                            rawTracks.append((id, try row.u32(68), title, path, try row.u32(56), try row.u16(84), try row.u32(16)))
                        case 2:
                            let subtype = try row.u16(0), id = try row.u32(4)
                            let offset = subtype & 4 != 0 ? try row.u16(10) : try row.u8(9)
                            guard artists[id] == nil else { throw failure("Duplicate USB artist") }
                            artists[id] = try row.text(offset)
                        case 7:
                            let id = try row.u32(12)
                            guard id > 0, nodeIds.insert(id).inserted else { throw failure("Duplicate USB playlist") }
                            nodes.append((id, try row.u32(0), try row.u32(8), try row.u32(16) != 0, try row.text(20)))
                        case 8:
                            let order = try row.u32(0), track = try row.u32(4), playlist = try row.u32(8)
                            entries[playlist, default: []].append((order, track))
                        default: break
                        }
                    }
                }
                if index == last { break }
                index = next
            }
        }
        guard types.contains(0) else { throw failure("No classic USB track table") }
        let tracks = rawTracks.map { USBTrack(id: $0.0, title: $0.2, artist: artists[$0.1], bpm: $0.4 > 0 ? Double($0.4) / 100 : nil, duration: $0.5, byteCount: $0.6, path: $0.3) }
        var playlists: [USBPlaylist] = []
        for node in nodes {
            let rows = entries[node.0, default: []]
            guard Set(rows.map(\.0)).count == rows.count else { throw failure("Ambiguous USB playlist order") }
            playlists.append(USBPlaylist(id: node.0, parent: node.1, order: node.2, folder: node.3, name: node.4, trackIds: rows.sorted { $0.0 < $1.0 }.map(\.1)))
        }
        return USBLibrary(tracks: tracks, playlists: playlists.sorted { $0.order < $1.order })
    }
    private static func failure(_ text: String) -> USBReadError { USBReadError(message: text) }
}

private struct USBBytes {
    let bytes: [UInt8]
    let start: Int
    let end: Int
    init(_ bytes: [UInt8], start: Int, end: Int) { self.bytes = bytes; self.start = start; self.end = end }
    func u8(_ offset: Int) throws -> Int {
        guard offset >= 0, offset < end - start else { throw USBReadError(message: "Truncated USB row") }
        return Int(bytes[start + offset])
    }
    func u16(_ offset: Int) throws -> Int { try u8(offset) | (u8(offset + 1) << 8) }
    func u32(_ offset: Int) throws -> Int { try u16(offset) | (u16(offset + 2) << 16) }
    func text(_ offset: Int) throws -> String {
        let kind = try u8(offset)
        let length: Int, skip: Int, encoding: String.Encoding
        if kind & 1 == 1 { length = (kind >> 1) - 1; skip = 1; encoding = .ascii }
        else if kind == 0x40 || kind == 0x90 { length = try u16(offset + 1) - 4; skip = 4; encoding = kind == 0x90 ? .utf16LittleEndian : .ascii }
        else { throw USBReadError(message: "Unsupported USB string encoding") }
        guard length >= 0, offset + skip <= end - start, length <= end - start - offset - skip else { throw USBReadError(message: "USB string escapes row") }
        let range = (start + offset + skip)..<(start + offset + skip + length)
        guard let result = String(data: Data(bytes[range]), encoding: encoding) else { throw USBReadError(message: "Malformed USB string") }
        return result
    }
}

public struct USBPreviewTrack: Sendable, Identifiable {
    public var id: Int { track.id }
    public let track: USBTrack
    public let relativePath: String?
    public let issue: String?
    let identity: String?
}
public struct USBImportPreview: Sendable {
    public let library: USBLibrary
    public let tracks: [USBPreviewTrack]
    public let database: Data
    public var available: [USBPreviewTrack] { tracks.filter { $0.issue == nil } }
}

/// Preview only. The caller owns the system-selected directory grant.
public enum RekordboxUSBPreview {
    public static func scan(root: URL) throws -> USBImportPreview {
        guard root.isFileURL else { throw USBReadError(message: "Select a local or connected USB folder") }
        let path = "PIONEER/rekordbox/export.pdb"
        if !FileManager.default.fileExists(atPath: root.appendingPathComponent(path).path) {
            throw USBReadError(message: "No classic export.pdb at this root. OneLibrary-only USBs are not supported")
        }
        let databaseURL = try confinedFile(root: root, relative: path)
        let size = try databaseURL.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size > 0, size <= RekordboxUSBReader.maximumBytes else { throw USBReadError(message: "Classic USB database is empty or too large") }
        let handle = try openSource(root: root, relative: path)
        defer { try? handle.close() }
        let data = try handle.read(upToCount: RekordboxUSBReader.maximumBytes + 1) ?? Data()
        let library = try RekordboxUSBReader.read(data)
        let pathCounts = Dictionary(grouping: library.tracks.compactMap { try? relativePath($0.path).lowercased() }, by: { $0 }).mapValues(\.count)
        let tracks = library.tracks.map { track -> USBPreviewTrack in
            do {
                let path = try relativePath(track.path)
                guard pathCounts[path.lowercased()] == 1 else { throw USBReadError(message: "Duplicate or case-colliding audio path") }
                let url = try confinedFile(root: root, relative: path)
                let source = try openSource(root: root, relative: path)
                defer { try? source.close() }
                var details = stat()
                guard fstat(source.fileDescriptor, &details) == 0 else { throw USBReadError(message: "USB audio is unavailable") }
                let size = Int(details.st_size)
                guard size > 0, track.byteCount == 0 || size == track.byteCount else { throw USBReadError(message: "Audio size differs from USB database") }
                guard ["wav", "aiff", "aif", "mp3", "m4a", "aac", "flac", "caf"].contains(url.pathExtension.lowercased()) else {
                    throw USBReadError(message: "Audio format not supported by this iOS prototype")
                }
                return USBPreviewTrack(track: track, relativePath: path, issue: nil, identity: identity(details))
            } catch {
                return USBPreviewTrack(track: track, relativePath: nil, issue: (error as? USBReadError)?.message ?? "Audio missing or unreadable", identity: nil)
            }
        }
        return USBImportPreview(library: library, tracks: tracks, database: data)
    }
    public static func relativePath(_ value: String) throws -> String {
        guard !value.contains("\\"), !value.contains(":"), !value.contains("\0") else { throw USBReadError(message: "Unsafe USB audio path") }
        let parts = value.split(separator: "/", omittingEmptySubsequences: true)
        guard !parts.isEmpty, !parts.contains(".."), !parts.contains(".") else { throw USBReadError(message: "Unsafe USB audio path") }
        return parts.joined(separator: "/")
    }
    static func confinedFile(root: URL, relative: String) throws -> URL {
        let canonical = root.resolvingSymlinksInPath().standardizedFileURL
        let safe = try relativePath(relative)
        var current = canonical
        let parts = safe.split(separator: "/")
        for (index, part) in parts.enumerated() {
            current.appendPathComponent(String(part))
            let values = try current.resourceValues(forKeys: [.isSymbolicLinkKey, .isRegularFileKey, .isDirectoryKey])
            guard values.isSymbolicLink != true else { throw USBReadError(message: "Symlinked USB paths are not imported") }
            if index == parts.count - 1 {
                guard values.isRegularFile == true else { throw USBReadError(message: "USB path is not a regular file") }
            } else if values.isDirectory != true { throw USBReadError(message: "USB parent path is not a directory") }
        }
        guard current.resolvingSymlinksInPath().path.hasPrefix(canonical.path + "/") else { throw USBReadError(message: "USB path escapes selected folder") }
        return current
    }
}


public struct USBImportReceipt: Sendable, Codable {
    public let tracks: [USBTrack]
    public let playlists: [USBPlaylist]
}

public enum RekordboxUSBCopy {
    /// Copies only reviewed, available tracks into a new app-owned directory.
    /// No merge into the desktop snapshot, no source writes, no overwrite.
    public static func copy(root: URL, preview: USBImportPreview, selected: Set<Int>, destination: URL) throws -> URL {
        let sourcePath = root.resolvingSymlinksInPath().standardizedFileURL.path
        let destinationPath = destination.resolvingSymlinksInPath().standardizedFileURL.path
        guard destinationPath != sourcePath, !destinationPath.hasPrefix(sourcePath + "/") else {
            throw USBReadError(message: "Import destination must be outside the source USB")
        }
        guard !selected.isEmpty, selected.isSubset(of: Set(preview.available.map(\.id))) else {
            throw USBReadError(message: "Selection includes unavailable USB tracks")
        }
        let db = try RekordboxUSBPreview.openSource(root: root, relative: "PIONEER/rekordbox/export.pdb")
        defer { try? db.close() }
        let current = try db.read(upToCount: RekordboxUSBReader.maximumBytes + 1) ?? Data()
        guard current == preview.database else { throw USBReadError(message: "USB database changed. Scan again before importing") }
        let manager = FileManager.default
        try manager.createDirectory(at: destination, withIntermediateDirectories: true)
        let stage = destination.appendingPathComponent(".staging-" + UUID().uuidString)
        let final = destination.appendingPathComponent(UUID().uuidString)
        try manager.createDirectory(at: stage, withIntermediateDirectories: false)
        var committed = false
        defer { if !committed { try? manager.removeItem(at: stage) } }
        var imported: [USBTrack] = []
        for item in preview.available where selected.contains(item.id) {
            guard let relative = item.relativePath else { throw USBReadError(message: "Invalid reviewed USB path") }
            let source = try RekordboxUSBPreview.openSource(root: root, relative: relative)
            defer { try? source.close() }
            var before = stat()
            guard fstat(source.fileDescriptor, &before) == 0, before.st_size > 0,
                  RekordboxUSBPreview.identity(before) == item.identity else {
                throw USBReadError(message: "USB audio changed. Scan again")
            }
            let file = stage.appendingPathComponent("\(item.id)." + URL(fileURLWithPath: relative).pathExtension.lowercased())
            guard manager.createFile(atPath: file.path, contents: nil) else { throw USBReadError(message: "Cannot create app import file") }
            let output = try FileHandle(forWritingTo: file)
            defer { try? output.close() }
            var copied: Int64 = 0
            while true {
                let chunk = try source.read(upToCount: 1024 * 1024) ?? Data()
                if chunk.isEmpty { break }
                copied += Int64(chunk.count)
                guard copied <= before.st_size else { throw USBReadError(message: "USB audio grew during import") }
                try output.write(contentsOf: chunk)
            }
            var after = stat()
            guard fstat(source.fileDescriptor, &after) == 0, copied == before.st_size,
                  sameFile(before, after) else { throw USBReadError(message: "USB audio changed during import") }
            imported.append(USBTrack(id: item.id, title: item.track.title, artist: item.track.artist, bpm: item.track.bpm, duration: item.track.duration, byteCount: Int(copied), path: file.lastPathComponent))
        }
        // Keep playlist order, omitting tracks the user did not select.
        let playlists = preview.library.playlists.map { USBPlaylist(id: $0.id, parent: $0.parent, order: $0.order, folder: $0.folder, name: $0.name, trackIds: $0.trackIds.filter { selected.contains($0) }) }
        let receipt = USBImportReceipt(tracks: imported, playlists: playlists)
        try JSONEncoder().encode(receipt).write(to: stage.appendingPathComponent("import.json"), options: .atomic)
        try manager.moveItem(at: stage, to: final)
        committed = true
        return final
    }
    private static func sameFile(_ a: stat, _ b: stat) -> Bool {
        #if canImport(Darwin)
        let times = a.st_mtimespec.tv_sec == b.st_mtimespec.tv_sec && a.st_mtimespec.tv_nsec == b.st_mtimespec.tv_nsec && a.st_ctimespec.tv_sec == b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec == b.st_ctimespec.tv_nsec
        #else
        let times = a.st_mtim.tv_sec == b.st_mtim.tv_sec && a.st_mtim.tv_nsec == b.st_mtim.tv_nsec && a.st_ctim.tv_sec == b.st_ctim.tv_sec && a.st_ctim.tv_nsec == b.st_ctim.tv_nsec
        #endif
        return a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_size == b.st_size && times
    }
}

extension RekordboxUSBPreview {
    static func identity(_ value: stat) -> String {
        #if canImport(Darwin)
        let time = "\(value.st_mtimespec.tv_sec):\(value.st_mtimespec.tv_nsec):\(value.st_ctimespec.tv_sec):\(value.st_ctimespec.tv_nsec)"
        #else
        let time = "\(value.st_mtim.tv_sec):\(value.st_mtim.tv_nsec):\(value.st_ctim.tv_sec):\(value.st_ctim.tv_nsec)"
        #endif
        return "\(value.st_dev):\(value.st_ino):\(value.st_size):\(time)"
    }
    /// openat each component without following symlinks, including during a swap.
    static func openSource(root: URL, relative: String) throws -> FileHandle {
        let components = try relativePath(relative).split(separator: "/").map(String.init)
        var directory = open(root.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard directory >= 0 else { throw USBReadError(message: "USB folder is unavailable") }
        defer { close(directory) }
        for component in components.dropLast() {
            let next = openat(directory, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
            guard next >= 0 else { throw USBReadError(message: "USB path changed or contains a symlink") }
            close(directory); directory = next
        }
        guard let leaf = components.last else { throw USBReadError(message: "Empty USB path") }
        let descriptor = openat(directory, leaf, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
        guard descriptor >= 0 else { throw USBReadError(message: "USB file is unreadable") }
        var details = stat()
        guard fstat(descriptor, &details) == 0, details.st_mode & S_IFMT == S_IFREG else {
            close(descriptor); throw USBReadError(message: "USB input is not a regular file")
        }
        return FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
    }
}
