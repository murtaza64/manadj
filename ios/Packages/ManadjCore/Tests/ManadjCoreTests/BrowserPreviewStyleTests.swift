import XCTest
@testable import ManadjCore

final class BrowserPreviewStyleTests: XCTestCase {
    private func wave() -> PreviewWaveform {
        PreviewWaveform(durationSecs: 1, gamma: 2, nBands: 8, sampleRate: 44100,
            peakHop: 512, bandHop: 512, stftWindow: 2048, peaks: [255, 255],
            bands: [255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0])
    }
    func testDefaultGroupsAndPreviewInterpolationDoNotUsePeaks() {
        let style = BrowserPreviewStyle()
        let columns = style.columns(wave(), count: 3)
        XCTAssertEqual(columns.count, 3)
        XCTAssertGreaterThan(columns[0][0], 0)
        XCTAssertEqual(columns[0][2], 0)
        XCTAssertEqual(columns[2][0], 0)
        XCTAssertGreaterThan(columns[2][2], 0)
        XCTAssertEqual(columns[1][0], columns[0][0] / 2, accuracy: 0.000001)
        XCTAssertEqual(columns[1][2], columns[2][2] / 2, accuracy: 0.000001)
        XCTAssertNil(style.color(groups: [0, 0, 0], amplitude: 0))
        XCTAssertTrue(style.columns(wave(), count: 0).isEmpty)
    }
    func testSyncedMinimapStyleAndMalformedValues() {
        let json = #"{"version":1,"minimap":{"styleId":"layered-opaque","params":{"master":0,"displayGamma":-1,"b1":99,"b2":-1}}}"#
        let style = BrowserPreviewStyle(json: json)
        XCTAssertEqual(style.master, 0)
        XCTAssertEqual(style.gamma, 0.01)
        XCTAssertEqual(style.b1, 7); XCTAssertEqual(style.b2, 8)
        XCTAssertTrue(style.columns(wave(), count: 5).flatMap { $0 }.allSatisfy { $0 == 0 })
        XCTAssertEqual(BrowserPreviewStyle(json: "bad").id, "additive-rgb")
    }
    func testAllSupportedColorsStayFiniteAndBounded() {
        for id in ["additive-rgb", "additive-soft", "additive-screen", "layered-opaque", "dominant-band"] {
            let style = BrowserPreviewStyle(json: "{\"version\":1,\"minimap\":{\"styleId\":\"" + id + "\"}}")
            XCTAssertTrue(style.supportsStyle)
            let c = style.color(groups: [0.8, 0.7, 0.6], amplitude: 0.4)!
            XCTAssertEqual(c.count, 3)
            XCTAssertTrue(c.allSatisfy { $0.isFinite && (0...1).contains($0) })
        }
    }
}
