#if DEBUG
import Foundation
import AVFoundation
import ManadjCore
import ManadjAudio
import CEngine

/// Synthetic, isolated cache for UI tests. Never reads a user library or connects to a desktop.
extension AppModel {
    func installPerformanceFixture() async {
        guard let audio else { return }
        do {
            for (index, name) in ["A", "B"].enumerated() {
                guard let url = Bundle.main.url(forResource: "synthetic-" + name, withExtension: "wav"),
                      let wave = Bundle.main.url(forResource: "synthetic-" + name, withExtension: "mwf") else { throw AudioFailure("Missing synthetic fixture resources") }
                let duration = try await audio.load(url, deck: index)
                audio.grid(index, bpm: 128, anchor: 0)
                audio.send(MDJFader, deck: index, value: index == 0 ? 0.75 : 0.55)
                for slot in 0..<(index == 0 ? 4 : 2) { audio.send(MDJHotCueSetAt, deck: index, value: Double(slot) * 3.75, slot: slot) }
                decks[index].title = "Synthetic pulse " + name
                decks[index].artist = "Generated PCM, no music source"
                decks[index].duration = duration
                decks[index].waveform = try PreviewWaveform.parse(Data(contentsOf: wave))
            }
        } catch { self.error = error.localizedDescription }
    }

    static func makePerformanceUIFixture() -> URL? {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("performance-ui-" + UUID().uuidString)
        do {
            let store = try LibraryStore(root: root.appendingPathComponent("library"))
            let text = #"{"version":1,"tag_categories":[],"tags":[],"settings":{},"playlists":[],"tracks":[{"id":1,"file_name":"synthetic-A.wav","title":"Synthetic pulse A","artist":"Generated PCM, no music source","bpm":128,"duration_secs":24,"audio_rev":"fixture","preview_rev":"fixture","waveform_rev":"detail-fixture"},{"id":2,"file_name":"synthetic-B.wav","title":"Synthetic pulse B","artist":"Generated PCM, no music source","bpm":128,"duration_secs":24,"audio_rev":"fixture","preview_rev":"fixture","waveform_rev":"detail-fixture"}]}"#
            try store.saveSnapshot(text)
            for (i, track) in try SnapshotJson.parse(text).tracks.enumerated() {
                let name = "synthetic-" + ["A", "B"][i]
                guard let source = Bundle.main.url(forResource: name, withExtension: "wav"), let wave = Bundle.main.url(forResource: name, withExtension: "mwf"), let target = store.audioFile(track) else { return nil }
                try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
                try FileManager.default.copyItem(at: source, to: target)
                guard let preview = Bundle.main.url(forResource: name + "-preview", withExtension: "mwf") else { return nil }
                try store.savePreview(Data(contentsOf: preview), track: track)
                try store.saveDetail(Data(contentsOf: wave), track: track)
            }
            return root
        } catch { return nil }
    }

    static func makeLibraryUIFixture() -> URL? {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("library-ui-" + UUID().uuidString)
        do {
            let store = try LibraryStore(root: root.appendingPathComponent("library"))
            let json = #"{"version":1,"tag_categories":[{"id":1,"name":"Style"}],"tags":[{"id":1,"name":"Rolling","category_id":1},{"id":2,"name":"Liquid","category_id":1}],"settings":{},"playlists":[{"id":10,"name":"Fixture set","display_order":0,"track_ids":[1,2]},{"id":11,"name":"Empty set","display_order":1,"track_ids":[]}],"tracks":[{"id":1,"file_name":"cached.wav","title":"Cached Test Tone","bpm":128,"tag_ids":[1],"artist":"Synthetic fixture","audio_rev":"fixture","preview_rev":"fixture"},{"id":2,"file_name":"offline.wav","title":"Offline Test Tone","bpm":174,"tag_ids":[2],"artist":"Synthetic fixture","audio_rev":"missing","preview_rev":"fixture"}]}"#
            var savedJSON = json
            if ProcessInfo.processInfo.arguments.contains("--browser-scroll-fixture"),
               var object = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
               var tracks = object["tracks"] as? [[String: Any]] {
                for i in 3...82 { tracks.append(["id": i, "file_name": "fixture-\(i).wav", "title": String(format: "Scroll fixture %03d", i), "artist": "Generated no-music fixture", "bpm": 128]) }
                object["tracks"] = tracks
                savedJSON = String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
            }
            if ProcessInfo.processInfo.arguments.contains("--browse-tags-fixture"),
               var object = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
               var tracks = object["tracks"] as? [[String: Any]] {
                let names = ["Rolling", "Liquid", "Vocal", "Deep", "Atmospheric", "Late night", "Heavy bass", "Fast", "Very long genre name that needs disclosure", "Warm", "Groove", "Peak", "Dub", "Soul"]
                object["tags"] = names.enumerated().map { ["id": $0.offset + 1, "name": $0.element, "category_id": 1, "color": $0.offset.isMultiple(of: 2) ? "#4a9eff" : "#ff9500"] as [String: Any] }
                tracks[0]["tag_ids"] = Array(1...8); tracks[1]["tag_ids"] = Array(1...14)
                for (offset, count) in [3, 5].enumerated() {
                    var track = tracks[0]; track["id"] = offset + 3; track["title"] = "\(count) tag fixture"; track["tag_ids"] = Array(1...count)
                    tracks.append(track)
                }
                object["tracks"] = tracks
                savedJSON = String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
            }
            try store.saveSnapshot(savedJSON)
            // Row preview coverage: both tracks carry a preview blob, so the
            // browser UI tests see the same waveform path as a synced phone.
            for (track, name) in zip(try SnapshotJson.parse(json).tracks, ["synthetic-A", "synthetic-B"]) {
                guard let wave = Bundle.main.url(forResource: name, withExtension: "mwf") else { return nil }
                try store.savePreview(Data(contentsOf: wave), track: track)
            }
            let track = try SnapshotJson.parse(json).tracks[0]
            guard let url = store.audioFile(track), let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2),
                  let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44100) else { return nil }
            buffer.frameLength = 44100
            guard let channels = buffer.floatChannelData else { return nil }
            for i in 0..<44100 {
                let sample = Float(sin(Double(i) * .pi * 2 * 440 / 44100)) * 0.05
                channels[0][i] = sample; channels[1][i] = sample
            }
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let file = try AVAudioFile(forWriting: url, settings: format.settings)
            try file.write(from: buffer)
            return root
        } catch { return nil }
    }
}
#endif
