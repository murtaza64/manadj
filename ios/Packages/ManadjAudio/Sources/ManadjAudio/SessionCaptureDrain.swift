import Foundation
import CEngine
import ManadjCore

public enum CaptureDrainError: Error, Equatable { case gap }

/// A caller must be the sole consumer for its engine epoch. This does not enable
/// capture or create a polling timer. It converts at most the128-slot queue size;
/// caller persists the returned segments sequentially before another drain.
public enum SessionCaptureDrain {
    public static func read(engine: MDJEngine, loads: SessionCaptureLoads) throws -> [AppliedSessionSegment] {
        var result: [AppliedSessionSegment] = []
        for _ in 0..<128 {
            var snapshot = MDJCaptureSnapshot()
            let status = mdj_capture_pop(engine, &snapshot)
            if status == 0 { return result }
            guard status == 1 else { throw CaptureDrainError.gap }
            result.append(try SessionCaptureAdapter.convert(snapshot) { loads.resolve(deck: $0, token: $1) })
        }
        // At capacity, do not claim the consumer caught up or spin indefinitely.
        // The caller can apply this bounded batch then drain again; overflow on
        // any subsequent read still permanently fails the recording epoch.
        return result
    }
}
