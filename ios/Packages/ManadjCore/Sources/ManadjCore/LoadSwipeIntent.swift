import Foundation

/// Explicit short iPhone flick, Android left=A/right=B mapping, release commits.
public enum LoadSwipeIntent {
    public static func target(travel: Double, vertical: Double, projected: Double) -> Int? {
        guard travel.isFinite, vertical.isFinite, projected.isFinite,
              abs(travel) > abs(vertical) * 1.2 else { return nil }
        let deliberate = abs(travel) >= 60
        let flick = abs(travel) >= 24 && abs(projected) >= 100 && travel * projected > 0
        guard deliberate || flick else { return nil }
        return travel < 0 ? 0 : 1
    }
}
