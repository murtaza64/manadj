#if canImport(CryptoKit) && canImport(JavaScriptCore)
import Foundation
import CryptoKit
import CoreFoundation

/// Signed history evidence only. Remote history never enters the audio engine.
@MainActor public enum NativeSessionOperationCodec {
    public static func sign(group: UUID, origin: UUID, sequence: Int, id: UUID, session: UUID,
                            field: String, value: Any, key: Curve25519.Signing.PrivateKey) throws -> Data {
        let body: [String: Any] = ["format": "manadj-continuous-sync/v1", "generation": 1,
            "group_id": group.uuidString.lowercased(), "origin_id": origin.uuidString.lowercased(),
            "sequence": sequence, "operation_id": id.uuidString.lowercased(),
            "entity": "session:" + session.uuidString.lowercased(), "field": field, "parents": [String](), "value": value]
        try validate(body)
        let raw = try NativeOperationCodec.canonical(body)
        let signature = try key.signature(for: NativeOperationCodec.domain + raw).base64EncodedString()
        return Data(("{\"body\":" + String(decoding: raw, as: UTF8.self) + ",\"signature\":\"" + signature + "\"}").utf8)
    }

    static func verify(_ packet: Data, group: UUID, origin: UUID, pin: Curve25519.Signing.PublicKey) throws -> Data {
        guard packet.count <= 248 * 1024, let envelope = try JSONSerialization.jsonObject(with: packet) as? [String: Any],
              Set(envelope.keys) == ["body", "signature"], let body = envelope["body"] as? [String: Any],
              body["group_id"] as? String == group.uuidString.lowercased(), body["origin_id"] as? String == origin.uuidString.lowercased(),
              let encoded = envelope["signature"] as? String, let signature = Data(base64Encoded: encoded), signature.count == 64 else { throw NativeOperationError.invalid }
        try validate(body)
        let raw = try NativeOperationCodec.canonical(body)
        guard pin.isValidSignature(signature, for: NativeOperationCodec.domain + raw) else { throw NativeOperationError.untrusted }
        return raw
    }

    private static func validate(_ body: [String: Any]) throws {
        guard Set(body.keys) == ["entity", "field", "format", "generation", "group_id", "operation_id", "origin_id", "parents", "sequence", "value"],
              body["format"] as? String == "manadj-continuous-sync/v1", integer(body["generation"]) == 1,
              let sequence = integer(body["sequence"]), sequence > 0,
              let entity = body["entity"] as? String, entity.hasPrefix("session:"), canonicalUUID(String(entity.dropFirst(8))),
              ["group_id", "operation_id", "origin_id"].allSatisfy({ canonicalUUID(body[$0] as? String ?? "") }),
              let parents = body["parents"] as? [String], parents.isEmpty,
              let field = body["field"] as? String, let value = body["value"] else { throw NativeOperationError.invalid }
        if field == "start" || field == "end" {
            guard date(value) != nil else { throw NativeOperationError.invalid }; return
        }
        guard field.hasPrefix("chunk:"), let index = Int(field.dropFirst(6)), index >= 0, index < 1_000_000, field == "chunk:\(index)",
              let chunk = value as? [String: Any], Set(chunk.keys) == ["events", "tracks"],
              let events = chunk["events"] as? [[String: Any]], !events.isEmpty, events.count <= 1024,
              let tracks = chunk["tracks"] as? [String: String], tracks.count <= 512 else { throw NativeOperationError.invalid }
        for (source, logical) in tracks {
            guard let local = Int(source), local > 0, local <= 9_007_199_254_740_991, String(local) == source, canonicalUUID(logical) else { throw NativeOperationError.invalid }
        }
        var previous = -1.0
        for event in events {
            guard let time = number(event["t"]), time >= previous, time >= 0, time <= 1e9,
                  let kind = event["kind"] as? String, let fields = eventFields[kind], Set(event.keys).isSubset(of: fields) else { throw NativeOperationError.invalid }
            previous = time
            try bounded(event, depth: 0)
            try eventShape(event, kind: kind)
            // History accepts the existing event DTO, never arbitrary executable
            // controls. Every reference site must be known and explicitly bound.
            let sites: [Any]
            if kind == "load" { guard event.keys.contains("trackId") else { throw NativeOperationError.invalid }; sites = [event["trackId"]!] }
            else if kind == "init" {
                guard let decks = event["decks"] as? [String: [String: Any]], Set(decks.keys) == ["A", "B"],
                      let a = decks["A"]?["trackId"], let b = decks["B"]?["trackId"] else { throw NativeOperationError.invalid }; sites = [a, b]
            } else { sites = [] }
            let refs = countTrackKeys(event)
            guard refs == sites.count else { throw NativeOperationError.invalid }
            for site in sites where !(site is NSNull) {
                guard let local = integer(site), local > 0, tracks[String(local)] != nil else { throw NativeReplicaError.unresolvedBinding }
            }
        }
    }
    static func integer(_ value: Any?) -> Int? {
        guard let value = number(value), value.rounded() == value, abs(value) <= 9_007_199_254_740_991 else { return nil }; return Int(value)
    }
    static func number(_ value: Any?) -> Double? {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite else { return nil }; return n.doubleValue
    }
    static func date(_ value: Any) -> Date? {
        guard let text = value as? String, text.count <= 40 else { return nil }
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: text) { return date }
        formatter.formatOptions = [.withInternetDateTime]; return formatter.date(from: text)
    }
    private static func eventShape(_ e: [String: Any], kind: String) throws {
        let decks = Set(["A", "B", "C", "D"])
        if ["load", "transport", "pitch", "bend", "loop"].contains(kind) {
            guard let deck = e["channel"] as? String, decks.contains(deck) else { throw NativeOperationError.invalid }
        }
        func numeric(_ key: String) -> Bool { number(e[key]).map { abs($0) <= 1e12 } ?? false }
        switch kind {
        case "load": guard e.keys.contains("bpm"), e["bpm"] is NSNull || numeric("bpm") else { throw NativeOperationError.invalid }
        case "control":
            let controls: Set<String> = ["trim","eqLow","eqMid","eqHigh","filter","fader","pfl","slipMode","vinylMode","crossfaderAssignment","crossfader","crossfaderEnabled","master","stemVocals","stemDrums","stemBass","stemOther"]
            guard let control = e["control"] as? String, controls.contains(control), numeric("value"),
                  e["channel"] is NSNull || (e["channel"] as? String).map(decks.contains) == true else { throw NativeOperationError.invalid }
        case "pitch", "bend": guard numeric("value") else { throw NativeOperationError.invalid }
        case "transport":
            let actions: Set<String> = ["play","pause","seek","jumpBeats","hotCue","cue","previewStart","previewEnd","scratchBegin","scratchMove","scratchEnd"]
            guard let action = e["action"] as? String, actions.contains(action), numeric("playhead") else { throw NativeOperationError.invalid }
            for key in ["detail","deltaSeconds","durationSeconds","trackDuration","audioTime"] where e[key] != nil { guard numeric(key) else { throw NativeOperationError.invalid } }
            if let filter = e["filter"] { guard let object = filter as? [String: Any], Set(object.keys) == ["drive","rate"], object.values.allSatisfy({ number($0) != nil }) else { throw NativeOperationError.invalid } }
        case "loop":
            guard numeric("playhead"), let region = e["region"] else { throw NativeOperationError.invalid }
            if !(region is NSNull) { guard let object = region as? [String: Any], Set(object.keys) == ["start","end"], let start = number(object["start"]), let end = number(object["end"]), start < end else { throw NativeOperationError.invalid } }
            if let slip = e["slip"] { guard let n = slip as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { throw NativeOperationError.invalid } }
        case "tick": guard let playheads = e["playheads"] as? [String: Any], Set(playheads.keys).isSubset(of: decks), playheads.values.allSatisfy({ number($0) != nil }) else { throw NativeOperationError.invalid }
        case "tenure": guard let edge = e["edge"] as? String, ["start","end"].contains(edge), e["holder"] is String else { throw NativeOperationError.invalid }
        // The native engine mapper does not yet emit these shapes. Preserve
        // safety by rejecting rather than treating unsupported history as valid.
        case "init", "beatFx", "beatFxSettings": throw NativeOperationError.invalid
        default: throw NativeOperationError.invalid
        }
    }
    private static func canonicalUUID(_ text: String) -> Bool { UUID(uuidString: text)?.uuidString.lowercased() == text }
    private static func bounded(_ value: Any, depth: Int) throws {
        guard depth <= 12 else { throw NativeOperationError.invalid }
        if let object = value as? [String: Any] {
            guard object.count <= 64 else { throw NativeOperationError.invalid }
            for (key, child) in object { guard key.utf8.count <= 64 else { throw NativeOperationError.invalid }; try bounded(child, depth: depth + 1) }
        } else if let array = value as? [Any] {
            guard array.count <= (depth == 1 ? 1024 : 128) else { throw NativeOperationError.invalid }
            for child in array { try bounded(child, depth: depth + 1) }
        } else if let text = value as? String { guard text.utf8.count <= 8192 else { throw NativeOperationError.invalid } }
        else if let n = value as? NSNumber { guard n.doubleValue.isFinite, abs(n.doubleValue) <= 9_007_199_254_740_991 else { throw NativeOperationError.invalid } }
        else if !(value is NSNull) { throw NativeOperationError.invalid }
    }
    private static func countTrackKeys(_ value: Any) -> Int {
        if let object = value as? [String: Any] { return object.reduce(0) { $0 + ($1.key == "trackId" ? 1 : 0) + countTrackKeys($1.value) } }
        if let array = value as? [Any] { return array.reduce(0) { $0 + countTrackKeys($1) } }; return 0
    }
    private static let eventFields: [String: Set<String>] = [
        "load": ["t","kind","channel","trackId","bpm"], "control": ["t","kind","channel","control","value"],
        "transport": ["t","kind","channel","action","playhead","detail","deltaSeconds","durationSeconds","filter","trackDuration","audioTime"],
        "pitch": ["t","kind","channel","value"], "bend": ["t","kind","channel","value"], "loop": ["t","kind","channel","playhead","region","slip"],
        "tick": ["t","kind","playheads"], "tenure": ["t","kind","edge","holder"], "beatFx": ["t","kind","selected","target","on","depth","beats","held"],
        "beatFxSettings": ["t","kind","settings"], "init": ["t","kind","outgoingChannel","decks","crossfader","crossfaderEnabled","physicalDecks","beatFx"]]
}
#endif
