import Foundation

/// Android's relative two-axis rotary gesture, including a sticky neutral
/// notch and jump-free second-finger fine mode. Coordinates are points.
public struct KnobDragState: Sendable {
    public private(set) var value: Double
    public private(set) var fine = false
    public private(set) var notched: Bool
    public private(set) var tick = 0
    private let neutral: Double
    private var horizontal: Bool?
    private var baseline: Double
    private var base = 0.0
    private var notchAt = 0.0
    public init(value: Double, neutral: Double = 0.5) {
        self.value = min(1, max(0, value)); self.neutral = neutral
        baseline = self.value; notched = abs(self.value - neutral) < 0.001
    }
    public mutating func move(x: Double, y: Double, fine nextFine: Bool) {
        guard x.isFinite, y.isFinite else { return }
        if horizontal == nil {
            guard hypot(x, y) > 6 else { return }
            horizontal = abs(x) > abs(y)
        }
        let coordinate = horizontal == true ? -x : y
        if nextFine != fine {
            fine = nextFine; baseline = value; base = coordinate
            if notched { notchAt = coordinate }
            tick += 1
        }
        let span = 264.0 * (fine ? 3.5 : 1)
        var next = min(1, max(0, baseline - (coordinate - base) / span))
        if notched {
            let travel = coordinate - notchAt, escape = fine ? 2.0 : 6.0
            if abs(travel) <= escape { next = neutral }
            else {
                notched = false; baseline = neutral
                base = notchAt + (travel < 0 ? -escape : escape)
                next = min(1, max(0, neutral - (coordinate - base) / span))
            }
        } else if neutral > 0.01 && neutral < 0.99 && value != neutral && (value - neutral) * (next - neutral) <= 0 {
            next = neutral; notched = true; notchAt = coordinate; tick += 1
        }
        value = next
    }
}
