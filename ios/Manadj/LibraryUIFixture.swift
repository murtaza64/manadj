#if DEBUG
import Foundation
import AVFoundation
import ManadjCore

/// Synthetic, isolated cache for UI tests. Never reads a user library or connects to a desktop.
extension AppModel {
    static func makeLibraryUIFixture() -> URL? {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("library-ui-" + UUID().uuidString)
        do {
            let store = try LibraryStore(root: root.appendingPathComponent("library"))
            let json = #"{"version":1,"tag_categories":[],"tags":[],"settings":{},"playlists":[],"tracks":[{"id":1,"file_name":"cached.wav","title":"Cached Test Tone","artist":"Synthetic fixture","audio_rev":"fixture"},{"id":2,"file_name":"offline.wav","title":"Offline Test Tone","artist":"Synthetic fixture","audio_rev":"missing"}]}"#
            try store.saveSnapshot(json)
            let track = try SnapshotJson.parse(json).tracks[0]
            guard let url = store.audioFile(track), let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2),
                  let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44100) else { return nil }
            buffer.frameLength = 44100
            guard let channels = buffer.floatChannelData else { return nil }
            for i in 0..<44100 {
                let sample = Float(sin(Double(i) * .pi * 2 * 440 / 44100)) * 0.05
                channels[0][i] = sample; channels[1][i] = sample
            }
            let file = try AVAudioFile(forWriting: url, settings: format.settings)
            try file.write(from: buffer)
            return root
        } catch { return nil }
    }
}
#endif
