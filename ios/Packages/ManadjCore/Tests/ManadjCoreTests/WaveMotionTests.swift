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
    func testTransportChangeSnapsImmediately() {
        var clock = WaveClock()
        _ = clock.at(1, raw: 10, moving: true, rate: 1, transport: 7)
        _ = clock.at(1.016, raw: 10.014, moving: true, rate: 1, transport: 7)
        // A relocation smaller than the 0.25 s distance threshold still snaps when
        // the engine's relocation counter advances: no ease-across on cue/seek.
        XCTAssertEqual(clock.at(1.032, raw: 10.1, moving: true, rate: 1, transport: 8), 10.1, accuracy: 0.000001)
        // Same counter, small correction: eases as before.
        let eased = clock.at(1.048, raw: 10.12, moving: true, rate: 1, transport: 8)
        XCTAssertNotEqual(eased, 10.12, accuracy: 0.000001)
    }
    func testTransportRelocationToSameRawResetsPredictionAge() {
        var clock = WaveClock()
        _ = clock.at(1, raw: 10, moving: true, rate: 1, transport: 7)
        _ = clock.at(1.08, raw: 10, moving: true, rate: 1, transport: 7)
        XCTAssertEqual(clock.at(1.1, raw: 10, moving: true, rate: 1, transport: 8), 10, accuracy: 0.000001)
    }
    func testPlaybackRateAndMonotonicCorrection() {
        var clock = WaveClock()
        _ = clock.at(1, raw: 4, moving: true, rate: 1.08)
        XCTAssertEqual(clock.at(1.1, raw: 4, moving: true, rate: 1.08), 4.108, accuracy: 0.000001)
        let before = clock.at(1.2, raw: 4.15, moving: true, rate: 1.08)
        XCTAssertGreaterThanOrEqual(clock.at(1.21, raw: 4.10, moving: true, rate: 1.08), before)
    }
    func testFillNormalizationIsBoundedAndSilenceSafe() {
        let silence = PreviewWaveform(durationSecs: 2, gamma: 0.5, nBands: 8, sampleRate: 100, peakHop: 1, bandHop: 10, stftWindow: 0, peaks: [], bands: [UInt8](repeating: 0, count: 80))
        XCTAssertEqual(silence.displayFillGain, 1)
        let quiet = PreviewWaveform(durationSecs: 2, gamma: 0.5, nBands: 8, sampleRate: 100, peakHop: 1, bandHop: 10, stftWindow: 0, peaks: [], bands: [UInt8](repeating: 80, count: 80))
        XCTAssertEqual(quiet.displayFillGain, 3)
        let loud = PreviewWaveform(durationSecs: 2, gamma: 0.5, nBands: 8, sampleRate: 100, peakHop: 1, bandHop: 10, stftWindow: 0, peaks: [], bands: [UInt8](repeating: 255, count: 80))
        XCTAssertGreaterThanOrEqual(loud.displayFillGain, 1)
        XCTAssertLessThanOrEqual(loud.displayFillGain, 3)
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
