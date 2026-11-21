import Foundation

/// Android Deck.kt SlideLock: 55% key width, clamped to 80...220
/// physical pixels, either direction. Only an actual preview can latch.
public struct CueSlideLatch {
    public private(set) var held = false
    public private(set) var locked = false
    public init() {}
    public mutating func begin() { held = true; locked = false }
    public mutating func end() { held = false; locked = false }
    public func threshold(width: Double, scale: Double) -> Double {
        let s = max(1, scale)
        return min(220, max(80, width * s * 0.55)) / s
    }
    public mutating func move(delta: Double, width: Double, scale: Double, preview: Bool) -> Bool {
        guard held, !locked, preview, delta.isFinite, width.isFinite, scale.isFinite,
              abs(delta) >= threshold(width: width, scale: scale) else { return false }
        locked = true; return true
    }
}
