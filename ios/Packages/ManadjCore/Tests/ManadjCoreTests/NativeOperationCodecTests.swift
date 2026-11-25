#if canImport(CryptoKit) && canImport(JavaScriptCore)
import XCTest
import CryptoKit
@testable import ManadjCore

final class NativeOperationCodecTests: XCTestCase, @unchecked Sendable {
    @MainActor func testPythonRFC8785Ed25519VectorsVerifyOnActualAppleCodec() throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "native-operation-vectors", withExtension: "json"))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let key = try Curve25519.Signing.PublicKey(rawRepresentation: XCTUnwrap(Data(base64Encoded: object["publicKey"] as! String)))
        let vectors = try XCTUnwrap(object["vectors"] as? [[String: Any]])
        XCTAssertEqual(vectors.count, 8)
        for vector in vectors {
            let body = vector["body"] as! [String: Any]
            let packet = try JSONSerialization.data(withJSONObject: ["body": body, "signature": vector["signature"]!])
            let group = UUID(uuidString: body["group_id"] as! String)!, origin = UUID(uuidString: body["origin_id"] as! String)!
            let canonical = try NativeOperationCodec.verify(packet, expectedGroup: group, expectedOrigin: origin, pinnedKey: key)
            XCTAssertEqual(String(decoding: canonical, as: UTF8.self), vector["canonical"] as? String)
            XCTAssertThrowsError(try NativeOperationCodec.verify(packet, expectedGroup: UUID(), expectedOrigin: origin, pinnedKey: key))
            XCTAssertThrowsError(try NativeOperationCodec.verify(packet, expectedGroup: group, expectedOrigin: origin, pinnedKey: Curve25519.Signing.PrivateKey().publicKey))
        }
    }

    @MainActor func testNativeSignerRoundTripAndTamperDenial() throws {
        let key = Curve25519.Signing.PrivateKey(), group = UUID(), origin = UUID(), track = UUID(), id = UUID()
        let packet = try NativeOperationCodec.sign(group: group, origin: origin, sequence: 1, id: id, track: track,
            value: .title("Generated native title"), parents: [], key: key)
        _ = try NativeOperationCodec.verify(packet, expectedGroup: group, expectedOrigin: origin, pinnedKey: key.publicKey)
        // Optional generated CI export contains only a new public key and
        // signed generated packet, never private key or personal music.
        if let directory = ProcessInfo.processInfo.environment["MANADJ_NATIVE_VECTOR_OUTPUT"] {
            let result: [String: Any] = ["publicKey": key.publicKey.rawRepresentation.base64EncodedString(),
                "packet": try JSONSerialization.jsonObject(with: packet)]
            try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
            try JSONSerialization.data(withJSONObject: result).write(to: URL(fileURLWithPath: directory).appendingPathComponent("native-signed-vector.json"))
        }
        let changed = Data(String(decoding: packet, as: UTF8.self).replacingOccurrences(of: "Generated native title", with: "Changed").utf8)
        XCTAssertThrowsError(try NativeOperationCodec.verify(changed, expectedGroup: group, expectedOrigin: origin, pinnedKey: key.publicKey))
        XCTAssertThrowsError(try NativeOperationCodec.body(group: group, origin: origin, sequence: 0, id: id, track: track, value: .mainCue(1), parents: []))
        XCTAssertThrowsError(try NativeOperationCodec.body(group: group, origin: origin, sequence: 1, id: id, track: track, value: .mainCue(.infinity), parents: []))
    }
}
#endif
