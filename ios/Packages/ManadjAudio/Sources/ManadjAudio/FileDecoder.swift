#if canImport(AVFoundation) && os(iOS)
import AVFoundation
import CEngine
import Foundation

/// Worker-only decode. Bounded full decode for short tracks; ring streaming for long tracks.
/// There is no track-duration cap and no silent truncation. Long tracks seek by re-claiming
/// the engine transport; key lock requires a full in-memory track and falls back to varispeed.
enum FileDecoder {
    static func run(url: URL, deck: Int, load: UInt64, engine: EngineHandle,
                    pending: inout CheckedContinuation<Double, Error>?) throws {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let d = Int32(deck)
        let deadline = Date().addingTimeInterval(3)
        try LoadAcknowledgement.wait(expected: load,
            current: { mdj_deck(engine.raw, d).load },
            cancelled: { engine.isCancelled },
            expired: { Date() >= deadline },
            pause: { Thread.sleep(forTimeInterval: 0.002) })
        let file = try AVAudioFile(forReading: url, commonFormat: .pcmFormatFloat32, interleaved: false)
        let format = file.processingFormat
        guard (1...2).contains(format.channelCount), format.sampleRate >= 8_000, format.sampleRate <= 192_000,
              file.length > 0, file.length < AVAudioFramePosition(Int64.max / 4) else {
            throw AudioFailure("Use a mono or stereo audio file at 8–192 kHz that iOS can decode")
        }
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 8192) else { throw AudioFailure("Could not allocate decode buffer") }
        let duration = Double(file.length) / format.sampleRate
        var stereo = [Float](repeating: 0, count: 16384)
        func read() throws -> Int {
            try file.read(into: buffer, frameCount: 8192)
            guard buffer.frameLength > 0, let channels = buffer.floatChannelData else { throw AudioFailure("Audio decoder stopped early") }
            let n = Int(buffer.frameLength)
            for i in 0..<n { stereo[2*i] = channels[0][i]; stereo[2*i+1] = channels[format.channelCount == 1 ? 0 : 1][i] }
            return n
        }
        func current() -> Bool { !engine.isCancelled && mdj_deck(engine.raw, d).load == load }
        // <=64 MiB per deck, <=256 MiB across four full tracks, plus engine buffers.
        // Larger tracks use the existing 0.5 MiB ring instead of failing or allocating more.
        if file.length <= 16_777_216 && mdj_track_begin(engine.raw, d, load, UInt64(file.length), Int32(format.sampleRate)) {
            while file.framePosition < file.length {
                guard current() else { throw AudioFailure("Load was replaced") }
                let n = try read()
                let accepted = stereo.withUnsafeBufferPointer { mdj_track_write(engine.raw, d, load, $0.baseAddress!, Int32(n)) }
                guard accepted == n else { throw AudioFailure("Load was replaced or exceeded its decoded capacity") }
            }
            guard mdj_track_finish(engine.raw, d, load) else { throw AudioFailure("Load was replaced") }
            pending?.resume(returning: duration); pending = nil
            return
        }

        var transport = UInt64.max
        var published = false
        var offered = 0
        var count = 0
        var consumed = 0
        while current() {
            let state = mdj_deck(engine.raw, d)
            if state.transport != transport {
                transport = state.transport
                let target = max(0, min(duration, state.target))
                file.framePosition = min(file.length, AVAudioFramePosition(target * format.sampleRate))
                let actual = Double(file.framePosition) / format.sampleRate
                guard mdj_stream_claim(engine.raw, d, load, transport, Int32(format.sampleRate), actual) else { continue }
                count = 0; consumed = 0; offered = 0; published = false
            }
            if consumed == count && file.framePosition < file.length { count = try read(); consumed = 0 }
            let remaining = count - consumed
            if remaining > 0 {
                let accepted = stereo.withUnsafeBufferPointer { mdj_stream_write(engine.raw, d, transport, $0.baseAddress!.advanced(by: consumed * 2), Int32(remaining)) }
                if accepted < 0 { continue } // a seek invalidated this block; next iteration reclaims
                consumed += Int(accepted); offered += Int(accepted)
                if accepted == 0 { Thread.sleep(forTimeInterval: 0.002) }
            }
            let eof = file.framePosition == file.length && consumed == count
            if (!published && (offered >= 32768 || eof)) || eof {
                if mdj_stream_publish(engine.raw, d, load, transport, eof) {
                    published = true
                    if pending != nil { pending?.resume(returning: duration); pending = nil }
                }
            }
            // At EOF remain available for cue/seek transport changes, without busy-spinning.
            if eof { Thread.sleep(forTimeInterval: 0.01) }
        }
        if pending != nil { throw AudioFailure("Load was replaced") }
    }
}
#endif
