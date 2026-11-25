import Foundation
import CEngine
import ManadjCore

public enum CaptureAdapterError: Error, Equatable { case unsupported, unresolvedLoad, invalidSnapshot }

/// Converts callback publication, not UI state. Bindings are exact per-deck load
/// tokens retained by the load owner until all queued segments are consumed.
/// No capture enabling/draining or persistence occurs here.
public enum SessionCaptureAdapter {
    public static func convert(_ snapshot: MDJCaptureSnapshot,
        resolve: (_ deck: Int, _ load: UInt64) -> Int?) throws -> AppliedSessionSegment {
        guard !snapshot.fxOn, snapshot.fxHeld == 0 else { throw CaptureAdapterError.unsupported }
        guard snapshot.sampleRate > 0, snapshot.segmentStart < snapshot.frame else { throw CaptureAdapterError.invalidSnapshot }
        var tuple = snapshot.decks
        let native = withUnsafeBytes(of: &tuple) { Array($0.bindMemory(to: MDJCaptureDeck.self)) }
        var decks: [AppliedSessionDeck] = []
        for (index, source) in native.enumerated() {
            guard !source.preview, !source.scratching, source.previewSlot == -1 else { throw CaptureAdapterError.unsupported }
            var deck = AppliedSessionDeck()
            deck.load = source.load
            if source.load != 0 {
                guard let identity = resolve(index, source.load), identity > 0 else { throw CaptureAdapterError.unresolvedLoad }
                deck.trackID = identity
            }
            deck.startPosition = source.startPosition; deck.position = source.position
            deck.bpm = source.bpm > 0 ? source.bpm : nil
            deck.playing = source.playing; deck.ready = source.ready; deck.launchFrame = source.launchFrame
            deck.fader = Double(source.fader); deck.trim = Double(source.trim)
            deck.pitch = Double(source.pitch); deck.bend = Double(source.bend); deck.filter = Double(source.filter)
            var eq = source.eq, stems = source.stems
            deck.eq = withUnsafeBytes(of: &eq) { $0.bindMemory(to: Float.self).map(Double.init) }
            deck.stems = withUnsafeBytes(of: &stems) { $0.bindMemory(to: Float.self).map(Double.init) }
            deck.pfl = source.pfl
            if source.loop { deck.loopStart = source.loopStart; deck.loopEnd = source.loopEnd }
            decks.append(deck)
        }
        var segment = AppliedSessionSegment(startFrame: snapshot.segmentStart, endFrame: snapshot.frame,
            sampleRate: Int(snapshot.sampleRate), crossfade: Double(snapshot.crossfade), decks: decks)
        segment.fxActive = snapshot.fxOn || snapshot.fxHeld != 0
        return segment
    }
}
