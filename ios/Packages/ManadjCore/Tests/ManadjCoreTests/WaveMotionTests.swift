import XCTest
@testable import ManadjCore

final class WaveMotionTests: XCTestCase {
    func testPredictsBetweenSnapshotsAndSnapsSeeks() {
        var clock = WaveClock()
        XCTAssertEqual(clock.at(1, raw: 10, moving: true, rate: 1), 10)
        XCTAssertEqual(clock.at(1.016, raw: 10, moving: true, rate: 1), 10.016, accuracy: 0.000001)
        XCTAssertEqual(clock.at(1.032, raw: 10.030, moving: true, rate: 1), 10.03176, accuracy: 0.000001)
        XCTAssertEqual(clock.at(1.048, raw: 2, moving: true, rate: 1), 2, accuracy: 0.000001)
        XCTAssertEqual(clock.at(1.064, raw: 2, moving: false, rate: 1), 2)
    }
    func testPlaybackRateAndMonotonicCorrection() {
        var clock = WaveClock()
        _ = clock.at(1, raw: 4, moving: true, rate: 1.08)
        XCTAssertEqual(clock.at(1.1, raw: 4, moving: true, rate: 1.08), 4.108, accuracy: 0.000001)
        let before = clock.at(1.2, raw: 4.15, moving: true, rate: 1.08)
        XCTAssertGreaterThanOrEqual(clock.at(1.21, raw: 4.10, moving: true, rate: 1.08), before)
    }
    func testAndroidGroupsAndEmptyBands() {
        let wave = PreviewWaveform(durationSecs: 2, gamma: 0.5, nBands: 8, sampleRate: 100, peakHop: 1, bandHop: 10, stftWindow: 0, peaks: [], bands: [UInt8](repeating: 255, count: 80))
        let g = wave.columnGroups(from: 0.1, to: 0.4)
        for value in g { XCTAssertGreaterThan(value, 0.6); XCTAssertLessThanOrEqual(value, 1) }
        XCTAssertEqual(wave.columnGroups(from: 5, to: 6), [0,0,0])
        let silence = PreviewWaveform(durationSecs: 2, gamma: 0.5, nBands: 8, sampleRate: 100, peakHop: 1, bandHop: 10, stftWindow: 0, peaks: [], bands: [UInt8](repeating: 0, count: 80))
        XCTAssertEqual(silence.columnGroups(from: 0, to: 0.1), [0,0,0])
    }
}
