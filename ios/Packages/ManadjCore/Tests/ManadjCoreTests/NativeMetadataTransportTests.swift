#if canImport(CryptoKit) && canImport(JavaScriptCore)
import XCTest
import CryptoKit
@testable import ManadjCore

final class NativeMetadataTransportTests: XCTestCase, @unchecked Sendable {
    @MainActor func testActualURLSessionLoopsConvergeThroughGeneratedLoopbackHTTP() async throws {
        guard ProcessInfo.processInfo.environment["MANADJ_NATIVE_HTTP_FIXTURE"] == "1" else { throw XCTSkip("Explicit generated loopback fixture not started") }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let group=UUID(), aID=UUID(), bID=UUID(), logical=UUID()
        let aKey=Curve25519.Signing.PrivateKey(), bKey=Curve25519.Signing.PrivateKey()
        let members=[aID:aKey.publicKey,bID:bKey.publicKey]
        func replica(_ origin: UUID, _ key: Curve25519.Signing.PrivateKey, _ local: Int) throws -> NativeMetadataReplica {
            try NativeMetadataReplica(file:root.appendingPathComponent(origin.uuidString+".json"),group:group,origin:origin,key:key,members:members,
                bindings:[.init(logicalID:logical,localID:local,contentSHA256:String(repeating:"a",count:64),byteLength:4096)])
        }
        let a=try replica(aID,aKey,12), b=try replica(bID,bKey,99)
        _=try a.edit(localID:12,value:.title("Native URLSession sender"))
        let endpoint=URL(string:"http://127.0.0.1:49371")!
        let syncA=try NativeMetadataSync(replica:a,group:group,origin:aID,origins:[aID,bID],token:{"generated-loopback-only"},endpoint:endpoint)
        let syncB=try NativeMetadataSync(replica:b,group:group,origin:bID,origins:[aID,bID],token:{"generated-loopback-only"},endpoint:endpoint)
        defer { syncA.stop();syncB.stop() }
        syncA.start();syncB.start()
        for _ in 0..<150 {
            if b.cursor(aID)==1 { break }
            try await Task.sleep(for:.milliseconds(100))
            if syncA.published>0 { try await syncB.tick() }
        }
        XCTAssertEqual(try b.values(localID:99,field:"title").first?["value"] as? String,"Native URLSession sender")
        _=try b.edit(localID:99,value:.mainCue(12.5))
        for _ in 0..<150 {
            try await syncB.tick();try await syncA.tick()
            if a.cursor(bID)==1 { break }
            try await Task.sleep(for:.milliseconds(100))
        }
        XCTAssertEqual(try a.values(localID:12,field:"main_cue").first?["value"] as? Double,12.5)
        try await syncA.tick();try await syncB.tick()
        XCTAssertEqual(a.allPackets().count,2);XCTAssertEqual(b.allPackets().count,2)
        XCTAssertNil(syncA.lastError);XCTAssertNil(syncB.lastError)
        XCTAssertGreaterThan(syncA.requests,0);XCTAssertGreaterThan(syncB.requests,0)
    }
}
#endif
