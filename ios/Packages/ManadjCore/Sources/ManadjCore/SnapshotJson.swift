import Foundation
import CoreFoundation

/// Parses GET /api/device-sync/snapshot (backend/routers/device_sync.py).
/// Keeps Android's optional-field defaults, but rejects malformed identities/duplicates
/// before accepting a snapshot into the offline cache.
public enum SnapshotJson {
    public static let supportedVersion = Snapshot.supportedVersion

    public struct ParseError: Error, Equatable {
        public let message: String
    }

    public static func parse(_ text: String) throws -> Snapshot {
        guard let data = text.data(using: .utf8),
              let anyRoot = try? JSONSerialization.jsonObject(with: data),
              let root = anyRoot as? [String: Any]
        else { throw ParseError(message: "Snapshot is not a JSON object") }
        guard let version = int(root, "version") else { throw ParseError(message: "Snapshot has no version") }
        guard version == supportedVersion else { throw ParseError(message: "Unsupported snapshot version \(version)") }

        for key in ["tag_categories", "tags", "tracks", "playlists"] {
            guard let entries = root[key] as? [[String: Any]] else { throw ParseError(message: "Snapshot has no valid \(key) array") }
            var seen = Set<Int>()
            for entry in entries {
                guard let id = int(entry, "id"), id > 0, seen.insert(id).inserted else { throw ParseError(message: "Invalid or duplicate identity in \(key)") }
                if key == "tags", int(entry, "category_id") == nil { throw ParseError(message: "Missing tag category") }
                if key != "tracks", !(entry["name"] is String) { throw ParseError(message: "Missing name in \(key)") }
                if key == "tracks", !(entry["file_name"] is String) { throw ParseError(message: "Missing track filename") }
            }
        }
        let categories: [TagCategory] = array(root, "tag_categories").compactMap { entry in
            guard let id = entry["id"] as? Int, let name = entry["name"] as? String else { return nil }
            return TagCategory(id: id, name: name, color: str(entry, "color"), displayOrder: int(entry, "display_order") ?? 0)
        }
        let byCategory = Dictionary(uniqueKeysWithValues: categories.map { ($0.id, $0) })

        let tags: [LibraryTag] = array(root, "tags").compactMap { entry in
            guard let id = entry["id"] as? Int,
                  let name = entry["name"] as? String,
                  let categoryId = entry["category_id"] as? Int else { return nil }
            let category = byCategory[categoryId]
            return LibraryTag(
                id: id,
                name: name,
                categoryId: categoryId,
                categoryName: category?.name ?? "",
                color: str(entry, "color") ?? category?.color,
                displayOrder: int(entry, "display_order") ?? 0
            )
        }

        let trackEntries = array(root, "tracks")
        let tracks = trackEntries.map(track(_:))

        let playlists: [Playlist] = array(root, "playlists").compactMap { entry in
            guard let id = entry["id"] as? Int, let name = entry["name"] as? String else { return nil }
            let ids = (entry["track_ids"] as? [Any] ?? []).compactMap { ($0 as? NSNumber)?.intValue }
            return Playlist(id: id, name: name, color: str(entry, "color"), displayOrder: int(entry, "display_order") ?? 0, trackIds: ids)
        }

        let links: [(Int, Int)] = (root["links"] as? [Any] ?? []).compactMap { pair in
            guard let a = pair as? [Any], a.count == 2,
                  let lo = (a[0] as? NSNumber)?.intValue,
                  let hi = (a[1] as? NSNumber)?.intValue else { return nil }
            return (lo, hi)
        }

        let transitions: [TransitionEdge] = array(root, "transitions").compactMap { entry in
            guard let a = entry["a"] as? Int, let b = entry["b"] as? Int else { return nil }
            return TransitionEdge(a: a, b: b, count: int(entry, "count") ?? 0, favorite: entry["favorite"] as? Bool ?? false)
        }
        let cameos: [CameoEdge] = array(root, "cameos").compactMap { entry in
            guard let host = entry["host"] as? Int, let guest = entry["guest"] as? Int else { return nil }
            return CameoEdge(host: host, guest: guest, count: int(entry, "count") ?? 0, favorite: entry["favorite"] as? Bool ?? false)
        }
        let takes: [TakeEdge] = array(root, "takes").compactMap { entry in
            guard let a = entry["a"] as? Int, let b = entry["b"] as? Int else { return nil }
            return TakeEdge(a: a, b: b, count: int(entry, "count") ?? 0, lastAt: instant(str(entry, "last_at")))
        }

        // Older desktop/cached snapshots lack fields this app relies on: stale, resync.
        let stale = root["settings"] == nil || trackEntries.contains { $0["waveform_rev"] == nil || $0["bpm_centi"] == nil }

        var settings: [String: SyncedSetting] = [:]
        if let raw = root["settings"] as? [String: Any] {
            for (key, value) in raw {
                guard let entry = value as? [String: Any] else { continue }
                var json: String? = nil
                if let v = entry["value"], !(v is NSNull),
                   let vd = try? JSONSerialization.data(withJSONObject: v, options: [.fragmentsAllowed]),
                   let vs = String(data: vd, encoding: .utf8) {
                    json = vs
                }
                settings[key] = SyncedSetting(json: json, updatedAt: instant(str(entry, "updated_at")))
            }
        }

        return Snapshot(
            version: version,
            generatedAt: instant(str(root, "generated_at")),
            categories: categories,
            tags: tags,
            tracks: tracks,
            playlists: playlists,
            links: links,
            transitions: transitions,
            cameos: cameos,
            takes: takes,
            schemaStale: stale,
            settings: settings
        )
    }

    static func track(_ entry: [String: Any]) -> LibraryTrack {
        let fileName = entry["file_name"] as? String ?? ""
        var grid: Beatgrid? = nil
        if let g = entry["grid"] as? [String: Any], let origin = g["origin"] as? String {
            let changes: [TempoChange] = array(g, "tempo_changes").compactMap { tc in
                guard let start = dbl(tc, "start_time"), let bpm = dbl(tc, "bpm") else { return nil }
                return TempoChange(
                    startTime: start,
                    bpm: bpm,
                    timeSignatureNum: int(tc, "time_signature_num") ?? 4,
                    barPosition: int(tc, "bar_position") ?? 1,
                    timeSignatureDen: int(tc, "time_signature_den") ?? 4
                )
            }
            grid = Beatgrid(origin: origin, anchorTime: dbl(g, "anchor_time"), tempoChanges: changes)
        }

        let rawTitle = str(entry, "title")
        let title = (rawTitle?.isBlank == false ? rawTitle! : String(fileName.dropLastExtension()))
        let rawArtist = str(entry, "artist")

        let bpmCenti: Int64?
        if !entry.keys.contains("bpm_centi") {
            // Older desktops: approximate the gate column from the served bpm.
            bpmCenti = dbl(entry, "bpm").flatMap { value in
                let rounded = (value * 100 + 0.5).rounded(.down)
                return rounded.isFinite && rounded > Double(Int64.min) && rounded < Double(Int64.max) ? Int64(rounded) : nil
            }
        } else {
            bpmCenti = int64(entry, "bpm_centi")
        }

        let ladder = (entry["metric_ladder"] as? [String: Any]).map { m in
            MetricLadder(
                arities: (m["arities"] as? [Any] ?? []).compactMap { ($0 as? NSNumber)?.intValue },
                resetMarks: (m["reset_marks"] as? [Any] ?? []).compactMap { ($0 as? NSNumber)?.doubleValue }
            )
        }

        return LibraryTrack(
            id: int(entry, "id") ?? 0,
            title: title,
            artist: rawArtist?.isBlank == false ? rawArtist : nil,
            fileName: fileName,
            bpm: dbl(entry, "bpm"),
            bpmCenti: bpmCenti,
            key: int(entry, "key"),
            keyOpenKey: str(entry, "key_openkey"),
            keyCamelot: str(entry, "key_camelot"),
            energy: int(entry, "energy"),
            durationSecs: dbl(entry, "duration_secs"),
            dateAdded: instant(str(entry, "date_added")),
            mainCue: dbl(entry, "main_cue"),
            codec: str(entry, "codec"),
            fileSizeBytes: int64(entry, "filesize_bytes"),
            audioRev: str(entry, "audio_rev"),
            previewRev: str(entry, "preview_rev"),
            waveformRev: str(entry, "waveform_rev"),
            stemsRev: str(entry, "stems_rev"),
            tagIds: (entry["tag_ids"] as? [Any] ?? []).compactMap { ($0 as? NSNumber)?.intValue },
            hotCues: array(entry, "hot_cues").compactMap { c in
                guard let slot = c["slot"] as? Int, let time = dbl(c, "time") else { return nil }
                return HotCue(slot: slot, time: time, label: str(c, "label"), color: str(c, "color"))
            },
            grid: grid,
            ladder: ladder
        )
    }

    // MARK: - Lenient accessors (JSONObject str/dbl/int helpers)

    static func array(_ object: [String: Any], _ key: String) -> [[String: Any]] {
        (object[key] as? [Any] ?? []).compactMap { $0 as? [String: Any] }
    }

    static func str(_ object: [String: Any], _ key: String) -> String? {
        guard let value = object[key], !(value is NSNull) else { return nil }
        return value as? String
    }

    static func dbl(_ object: [String: Any], _ key: String) -> Double? {
        guard let value = object[key], !(value is NSNull) else { return nil }
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite else { return nil }
        return n.doubleValue
    }

    static func int(_ object: [String: Any], _ key: String) -> Int? {
        guard let value = object[key], !(value is NSNull) else { return nil }
        guard let n = dbl(object, key), n.rounded() == n, n > Double(Int.min), n < Double(Int.max) else { return nil }
        return Int(n)
    }

    static func int64(_ object: [String: Any], _ key: String) -> Int64? {
        guard let value = object[key], !(value is NSNull) else { return nil }
        guard let n = dbl(object, key), n.rounded() == n, n > Double(Int64.min), n < Double(Int64.max) else { return nil }
        return Int64(n)
    }

    /// OffsetDateTime.parse equivalent: ISO-8601 with offset, fractional seconds optional.
    public static func instant(_ text: String?) -> Date? {
        guard let text else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: text) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: text)
    }
}

private extension String {
    var isBlank: Bool { allSatisfy(\.isWhitespace) }

    /// Kotlin substringBeforeLast('.'): "a.b.mp3" -> "a.b"; no dot -> self.
    func dropLastExtension() -> Substring {
        guard let dot = lastIndex(of: ".") else { return self[...] }
        return self[..<dot]
    }
}
