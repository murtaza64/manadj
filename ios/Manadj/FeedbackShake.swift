import CoreMotion
import Foundation

/// Accelerometer shake → feedback. Works regardless of which control holds
/// first responder, unlike motionEnded. The simulator has no accelerometer;
/// simulator coverage uses the --feedback-ui-fixture launch argument instead.
@MainActor
final class ShakeDetector {
    /// Called on the main queue at most once per cooldown window.
    var onShake: (@MainActor () -> Void)?

    private let manager = CMMotionManager()
    private var lastFire = Date.distantPast
    private let threshold = 2.7 // g, total acceleration including gravity
    private let cooldown: TimeInterval = 2

    func start() {
        guard manager.isAccelerometerAvailable, !manager.isAccelerometerActive else { return }
        manager.accelerometerUpdateInterval = 1.0 / 50
        manager.startAccelerometerUpdates(to: .main) { [weak self] data, _ in
            guard let data else { return }
            let a = data.acceleration
            let magnitude = (a.x * a.x + a.y * a.y + a.z * a.z).squareRoot()
            Task { @MainActor [weak self] in
                guard let self else { return }
                guard magnitude > self.threshold,
                      Date().timeIntervalSince(self.lastFire) > self.cooldown
                else { return }
                self.lastFire = Date()
                self.onShake?()
            }
        }
    }

    func stop() {
        manager.stopAccelerometerUpdates()
    }
}
