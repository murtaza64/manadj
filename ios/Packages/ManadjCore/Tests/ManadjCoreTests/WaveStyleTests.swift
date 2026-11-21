import XCTest
@testable import ManadjCore

final class WaveStyleTests: XCTestCase {
    func testSingleGroupColumnsTakeTheGroupColor() {
        let full = WaveStyle.full
        // A pure-low column renders the Android FULL low color, quantized.
        let low = full.bucket(mask: 0b001, groups: [0.8, 0, 0])
        let c = WaveStyle.components(low)
        XCTAssertEqual(c.r, 0.7804, accuracy: 1.0 / 31)
        XCTAssertLessThan(c.g, 0.1)
        XCTAssertLessThan(c.b, 0.1)
        let high = full.bucket(mask: 0b100, groups: [0, 0, 0.8])
        let h = WaveStyle.components(high)
        XCTAssertEqual(h.b, 1.0, accuracy: 1.0 / 31)
        XCTAssertLessThan(h.r, 0.1)
    }

    func testOverlapWhitenTowardEnergyHueAndBatchIntoFewBuckets() {
        let full = WaveStyle.full
        // Overlapping groups (mask with several bits) whiten the core.
        let fringe = full.bucket(mask: 0b001, groups: [0.9, 0.1, 0])
        let core = full.bucket(mask: 0b011, groups: [0.9, 0.9, 0])
        let f = WaveStyle.components(fringe), c = WaveStyle.components(core)
        XCTAssertGreaterThan(c.g, f.g, "the low+mid core mixes toward the energy hue")
        // Quantization keeps a frame's segments in a handful of stroke buckets.
        var buckets = Set<Int>()
        for i in 0...100 {
            let t = Double(i) / 100
            buckets.insert(full.bucket(mask: 0b111, groups: [t, 1 - t, 0.5]))
        }
        XCTAssertLessThanOrEqual(buckets.count, 40)
    }

    func testMinimapDimsTowardWaveBackgroundNotBlack() {
        XCTAssertEqual(WaveStyle.minimap.master, 1.16, accuracy: 0.0001)
        let red = WaveStyle.minimap.bucket(mask: 0b001, groups: [1, 0, 0])
        let dimmed = WaveStyle.dimmed(red, factor: 0.52) // OverviewDim .65 * phone .8
        let d = WaveStyle.components(dimmed)
        let full = WaveStyle.components(red)
        XCTAssertLessThan(d.r, full.r)
        // The background #0b0b0f floor keeps dimmed blue above zero.
        let floor = WaveStyle.components(WaveStyle.dimmed(red, factor: 0))
        XCTAssertEqual(floor.b, 15.0 / 255, accuracy: 1.0 / 31)
        XCTAssertEqual(WaveStyle.dimmed(red, factor: 1), red, "factor 1 leaves colors untouched")
    }
}
