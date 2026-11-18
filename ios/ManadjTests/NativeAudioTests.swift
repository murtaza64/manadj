import XCTest
import AVFoundation
import ManadjAudio
import ManadjCore
import CEngine
@testable import Manadj

final class NativeAudioTests: XCTestCase {
    @MainActor func testAVFoundationDecodeAndTransport() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        defer { try? FileManager.default.removeItem(at: url) }
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2))
        do {
            let file = try AVAudioFile(forWriting: url, settings: format.settings)
            let pcm = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44100))
            pcm.frameLength = 44100
            let channels = try XCTUnwrap(pcm.floatChannelData)
            for i in 0..<44100 { let v = Float(sin(Double(i) * .pi * 2 * 440 / 44100)) * 0.1; channels[0][i] = v; channels[1][i] = v }
            try file.write(from: pcm)
        }
        let audio = try NativeAudio()
        let duration = try await audio.load(url, deck: 0)
        XCTAssertEqual(duration, 1, accuracy: 0.001)
        XCTAssertTrue(audio.state(0).ready)
        XCTAssertTrue(audio.state(0).fullyDecoded)
        XCTAssertTrue(audio.send(MDJPlay))
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertTrue(audio.state(0).playing)
        XCTAssertGreaterThan(audio.state(0).position, 0.05)
        audio.send(MDJPause)
        try await Task.sleep(for: .milliseconds(50))
        audio.send(MDJSeek, value: 0.5)
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(audio.state(0).position, 0.5, accuracy: 0.01)
    }
    func testProjectConfigurationHasLocalNetworkPurposeAndFonts() throws {
        XCTAssertNotNil(Bundle.main.object(forInfoDictionaryKey: "NSLocalNetworkUsageDescription"))
        XCTAssertNotNil(Bundle.main.url(forResource: "UbuntuMono-Regular", withExtension: "ttf"))
    }
}
