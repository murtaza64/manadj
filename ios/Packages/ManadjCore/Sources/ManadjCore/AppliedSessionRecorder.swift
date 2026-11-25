import Foundation

/// Input must be an applied engine segment, never UI state or command receipt.
/// Track identity must be resolved for the exact engine load token by the host.
public struct AppliedSessionDeck: Equatable, Sendable {
    public var load: UInt64 = 0
    public var trackID: Int?
    public var position = 0.0
    public var startPosition = 0.0
    public var bpm: Double?
    public var playing = false
    public var preview = false
    public var scratching = false
    public var ready = false
    public var launchFrame: UInt64 = 0
    public var fader = 1.0
    public var trim = 0.5
    public var pitch = 0.0
    public var bend = 0.0
    public var filter = 0.0
    public var eq = [0.5, 0.5, 0.5]
    public var stems = [1.0, 1.0, 1.0, 1.0]
    public var pfl = false
    public var loopStart: Double?
    public var loopEnd: Double?
    public init() {}
}

public struct AppliedSessionSegment: Equatable, Sendable {
    public var startFrame: UInt64
    public var endFrame: UInt64
    public var sampleRate: Int
    public var crossfade: Double
    public var fxActive = false
    public var decks: [AppliedSessionDeck]
    public init(startFrame: UInt64, endFrame: UInt64, sampleRate: Int, crossfade: Double, decks: [AppliedSessionDeck]) {
        self.startFrame = startFrame; self.endFrame = endFrame; self.sampleRate = sampleRate
        self.crossfade = crossfade; self.decks = decks
    }
}

public enum AppliedRecorderError: Error, Equatable {
    case invalidSegment, discontinuity, unresolvedTrack, contextFull, stopped
}

public enum SessionRecorderAction: Equatable, Sendable {
    case open(UUID, Date, Data)
    case append(UUID, Int, Data)
    case close(UUID, Date, incomplete: Bool)
}

/// Pure event/lifecycle mapper. The caller must persist returned actions in order
/// before processing the next segment. On a persistence failure discard this
/// mapper and reconcile the durable journal, never continue from advanced memory.
/// FX/scratch/preview need a richer adapter and are rejected rather than omitted.
public struct AppliedSessionRecorder: Sendable {
    public private(set) var session: UUID?
    private var previous: AppliedSessionSegment?
    private var context: [Data] = []
    private var contextBytes = 0
    private var contextEvents = 0
    private var baseFrame: UInt64?
    private var wallBase: Date?
    private var lastAudible: UInt64?
    private var nextSequence = 1
    private var stopped = false
    private var tickFrame: UInt64?
    public init() {}

    public mutating func observe(_ segment: AppliedSessionSegment, wallTime: Date) throws -> [SessionRecorderAction] {
        guard !stopped else { throw AppliedRecorderError.stopped }
        stopped = true // Any invalid/unsupported segment fails closed until reconciliation.
        guard segment.sampleRate > 0, segment.startFrame < segment.endFrame, segment.decks.count == 4, !segment.fxActive,
              wallTime.timeIntervalSince1970.isFinite, segment.crossfade.isFinite, (-1...1).contains(segment.crossfade) else { throw AppliedRecorderError.invalidSegment }
        if let previous {
            guard segment.startFrame == previous.endFrame, segment.sampleRate == previous.sampleRate else {
                stopped = true; throw AppliedRecorderError.discontinuity
            }
        }
        for deck in segment.decks {
            guard [deck.position, deck.startPosition, deck.fader, deck.trim, deck.pitch, deck.bend, deck.filter].allSatisfy(\.isFinite),
                  deck.eq.count == 3, deck.stems.count == 4, deck.eq.allSatisfy(\.isFinite), deck.stems.allSatisfy(\.isFinite),
                  deck.bpm.map({ $0.isFinite }) ?? true,
                  !deck.preview, !deck.scratching else { throw AppliedRecorderError.invalidSegment }
            if deck.load != 0 && deck.trackID == nil { throw AppliedRecorderError.unresolvedTrack }
        }
        if baseFrame == nil { baseFrame = segment.startFrame; wallBase = wallTime }
        let t = Double(segment.startFrame - baseFrame!) / Double(segment.sampleRate)
        let endT = Double(segment.endFrame - baseFrame!) / Double(segment.sampleRate)
        var events: [[String: Any]] = []
        func emit(_ event: [String: Any]) { events.append(event) }
        if previous == nil || previous!.crossfade != segment.crossfade {
            emit(["t": t, "kind": "control", "channel": NSNull(), "control": "crossfader", "value": segment.crossfade])
            if previous == nil { emit(["t": t, "kind": "control", "channel": NSNull(), "control": "crossfaderEnabled", "value": 1]) }
        }
        for index in 0..<4 {
            let channel = ["A", "B", "C", "D"][index], deck = segment.decks[index]
            let old = previous?.decks[index]
            if old == nil {
                emit(["t": t, "kind": "control", "channel": channel, "control": "crossfaderAssignment", "value": index % 2 == 0 ? -1 : 1])
            }
            var controls: [(String, Double, Double?)] = [
                ("fader", deck.fader, old?.fader), ("trim", deck.trim, old?.trim),
                ("filter", deck.filter, old?.filter), ("pfl", deck.pfl ? 1 : 0, old.map { $0.pfl ? 1 : 0 })]
            for k in 0..<3 { controls.append((["eqLow", "eqMid", "eqHigh"][k], deck.eq[k], old?.eq[k])) }
            for k in 0..<4 { controls.append((["stemVocals", "stemDrums", "stemBass", "stemOther"][k], deck.stems[k], old?.stems[k])) }
            for (name, value, oldValue) in controls where oldValue != value {
                emit(["t": t, "kind": "control", "channel": channel, "control": name, "value": value])
            }
            let changedLoad = old == nil || old!.load != deck.load || old!.trackID != deck.trackID
            if changedLoad {
                emit(["t": t, "kind": "load", "channel": channel, "trackId": deck.trackID as Any? ?? NSNull(), "bpm": deck.bpm as Any? ?? NSNull()])
            }
            if changedLoad || old!.pitch != deck.pitch { emit(["t": t, "kind": "pitch", "channel": channel, "value": deck.pitch]) }
            if changedLoad || old!.bend != deck.bend { emit(["t": t, "kind": "bend", "channel": channel, "value": deck.bend]) }
            if changedLoad || old!.loopStart != deck.loopStart || old!.loopEnd != deck.loopEnd {
                let region: Any = (deck.loopStart != nil && deck.loopEnd != nil) ? ["start": deck.loopStart!, "end": deck.loopEnd!] : NSNull()
                emit(["t": t, "kind": "loop", "channel": channel, "playhead": deck.startPosition, "region": region])
            }
            let playing = deck.playing && deck.launchFrame == 0
            let wasPlaying = old.map { $0.playing && $0.launchFrame == 0 } ?? false
            if changedLoad || playing != wasPlaying {
                emit(["t": t, "kind": "transport", "channel": channel, "action": playing ? "play" : "pause", "playhead": deck.startPosition])
            } else if let old, abs(deck.startPosition - old.position) > 0.0001 {
                emit(["t": t, "kind": "transport", "channel": channel, "action": "seek", "playhead": deck.startPosition])
            }
        }
        // Position evidence at segment end is distinct from applied control time.
        if tickFrame == nil || segment.endFrame - tickFrame! >= UInt64(segment.sampleRate) {
            emit(["t": endT, "kind": "tick", "playheads": Dictionary(uniqueKeysWithValues: (0..<4).map { (["A", "B", "C", "D"][$0], segment.decks[$0].position) })])
            tickFrame = segment.endFrame
        }
        let data = try JSONSerialization.data(withJSONObject: events, options: [.sortedKeys])
        let audible = segment.decks.enumerated().contains { index, deck in
            let xf = index % 2 == 0 ? min(1, 1 - segment.crossfade) : min(1, 1 + segment.crossfade)
            return deck.trackID != nil && deck.ready && deck.playing && deck.launchFrame == 0 && deck.fader > 0 && deck.trim > 0 && deck.eq.contains(where: { $0 > 0 }) && deck.stems.contains(where: { $0 > 0 }) && xf > 0
        }
        if audible { lastAudible = segment.endFrame }
        var actions: [SessionRecorderAction] = []
        if let session {
            if !events.isEmpty { actions.append(.append(session, nextSequence, data)); nextSequence += 1 }
            if let lastAudible, segment.endFrame - lastAudible >= UInt64(segment.sampleRate) * 600 {
                actions.append(.close(session, wallBase!.addingTimeInterval(endT), incomplete: false))
                self.session = nil; context = []; contextBytes = 0; contextEvents = 0
                baseFrame = nil; wallBase = nil; self.lastAudible = nil
                previous = nil; tickFrame = nil; stopped = false
                return actions // Next segment must seed a fresh complete context.
            }
        } else {
            if !events.isEmpty { context.append(data); contextBytes += data.count; contextEvents += events.count }
            guard contextBytes <= 160 * 1024, contextEvents <= 1024 else { stopped = true; throw AppliedRecorderError.contextFull }
            if audible {
                let id = UUID(); session = id; nextSequence = 1
                let objects = try context.flatMap { try JSONSerialization.jsonObject(with: $0) as! [[String: Any]] }
                actions.append(.open(id, wallBase!, try JSONSerialization.data(withJSONObject: objects, options: [.sortedKeys])))
                context = []; contextBytes = 0; contextEvents = 0
            }
        }
        previous = segment
        stopped = false
        return actions
    }

    public mutating func stop(at date: Date, incomplete: Bool) -> [SessionRecorderAction] {
        stopped = true
        guard let session else { return [] }
        self.session = nil
        return [.close(session, date, incomplete: incomplete)]
    }
}
