#if canImport(CryptoKit) && canImport(JavaScriptCore)
import Foundation
import CryptoKit
import CoreFoundation
import JavaScriptCore

public enum NativeOperationError: Error { case invalid, untrusted, canonicalization }

/// Native Apple codec for the existing protocol. No network or enrollment.
/// ECMAScript's own JSON number formatter is used rather than assuming Swift's
/// Double description matches RFC8785. Only fixed ASCII object keys are emitted.
@MainActor public enum NativeOperationCodec {
    public static let domain = Data("manadj-continuous-sync/v1\0".utf8)

    public static func body(group: UUID, origin: UUID, sequence: Int, id: UUID,
                            track: UUID, value: LibraryEditValue, parents: [UUID]) throws -> Data {
        guard sequence > 0, sequence <= 9_007_199_254_740_991,
              parents.count <= 32, Set(parents).count == parents.count else { throw NativeOperationError.invalid }
        let rawValue: Any
        switch value {
        case .title(let title):
            guard title.utf8.count <= 4096 else { throw NativeOperationError.invalid }
            rawValue = title
        case .mainCue(let cue):
            guard cue.map({ $0.isFinite && $0 >= 0 }) ?? true else { throw NativeOperationError.invalid }
            rawValue = cue.map { $0 as Any } ?? NSNull()
        }
        let object: [String: Any] = ["entity": "track:" + track.uuidString.lowercased(), "field": value.field,
            "format": "manadj-continuous-sync/v1", "generation": 1, "group_id": group.uuidString.lowercased(),
            "operation_id": id.uuidString.lowercased(), "origin_id": origin.uuidString.lowercased(),
            "parents": parents.map { $0.uuidString.lowercased() }, "sequence": sequence, "value": rawValue]
        return try canonical(object)
    }

    /// Recursive ECMAScript number/string formatting with lexical key order.
    /// Building the JSON string explicitly avoids JSON.stringify reordering
    /// integer-like Track reference keys ("12" must sort before "2").
    static func canonical(_ object: [String: Any]) throws -> Data {
        guard let context = JSContext() else { throw NativeOperationError.canonicalization }
        let function = context.evaluateScript("(function f(v){if(v===null||typeof v!==\"object\")return JSON.stringify(v);if(Array.isArray(v))return \"[\"+v.map(f).join(\",\")+\"]\";return \"{\"+Object.keys(v).sort().map(function(k){return JSON.stringify(k)+\":\"+f(v[k])}).join(\",\")+\"}\"})")
        guard let result = function?.call(withArguments: [object]), context.exception == nil,
              let text = result.toString(), let data = text.data(using: .utf8), data.count <= 240 * 1024 else { throw NativeOperationError.canonicalization }
        return data
    }

    public static func sign(group: UUID, origin: UUID, sequence: Int, id: UUID, track: UUID,
                            value: LibraryEditValue, parents: [UUID], key: Curve25519.Signing.PrivateKey) throws -> Data {
        let raw = try body(group: group, origin: origin, sequence: sequence, id: id, track: track, value: value, parents: parents)
        let signature = try key.signature(for: domain + raw).base64EncodedString()
        // body is already canonical JSON. Signature is constrained Base64.
        return Data(("{\"body\":" + String(decoding: raw, as: UTF8.self) + ",\"signature\":\"" + signature + "\"}").utf8)
    }

    public static func verify(_ packet: Data, expectedGroup: UUID, expectedOrigin: UUID,
                              pinnedKey: Curve25519.Signing.PublicKey) throws -> Data {
        guard packet.count <= 248 * 1024,
              let envelope = try JSONSerialization.jsonObject(with: packet) as? [String: Any],
              Set(envelope.keys) == ["body", "signature"],
              let object = envelope["body"] as? [String: Any],
              Set(object.keys) == ["entity", "field", "format", "generation", "group_id", "operation_id", "origin_id", "parents", "sequence", "value"],
              object["format"] as? String == "manadj-continuous-sync/v1",
              object["group_id"] as? String == expectedGroup.uuidString.lowercased(),
              object["origin_id"] as? String == expectedOrigin.uuidString.lowercased(),
              let generation = object["generation"] as? NSNumber, CFGetTypeID(generation) != CFBooleanGetTypeID(), generation.doubleValue == 1,
              let sequence = object["sequence"] as? NSNumber, CFGetTypeID(sequence) != CFBooleanGetTypeID(),
              sequence.doubleValue.isFinite, sequence.doubleValue.rounded() == sequence.doubleValue,
              sequence.doubleValue >= 1, sequence.doubleValue <= 9_007_199_254_740_991,
              let idText = object["operation_id"] as? String, let id = UUID(uuidString: idText), id.uuidString.lowercased() == idText,
              let entity = object["entity"] as? String, entity.hasPrefix("track:"),
              let track = UUID(uuidString: String(entity.dropFirst(6))), entity == "track:" + track.uuidString.lowercased(),
              let parentTexts = object["parents"] as? [String], parentTexts.count <= 32,
              let signatureText = envelope["signature"] as? String, let signature = Data(base64Encoded: signatureText), signature.count == 64 else {
            throw NativeOperationError.invalid
        }
        let parents = try parentTexts.map { text -> UUID in
            guard let id = UUID(uuidString: text), id.uuidString.lowercased() == text else { throw NativeOperationError.invalid }; return id
        }
        let value: LibraryEditValue
        switch object["field"] as? String {
        case "title":
            guard let text = object["value"] as? String else { throw NativeOperationError.invalid }; value = .title(text)
        case "main_cue":
            if object["value"] is NSNull { value = .mainCue(nil) }
            else {
                guard let number = object["value"] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { throw NativeOperationError.invalid }
                value = .mainCue(number.doubleValue)
            }
        default: throw NativeOperationError.invalid
        }
        let raw = try body(group: expectedGroup, origin: expectedOrigin, sequence: sequence.intValue,
                           id: id, track: track, value: value, parents: parents)
        guard pinnedKey.isValidSignature(signature, for: domain + raw) else { throw NativeOperationError.untrusted }
        return raw
    }
}
#endif
