import Foundation

/// Samples the callback-owned generation exactly once per poll. Equality is
/// success, never replacement, even when acknowledgment arrives between polls.
enum LoadAcknowledgement {
    enum Failure: LocalizedError {
        case replaced, timedOut
        var errorDescription: String? {
            switch self {
            case .replaced: return "Load was replaced"
            case .timedOut: return "Audio output did not acknowledge the load"
            }
        }
    }
    static func wait(expected: UInt64, current: () -> UInt64, cancelled: () -> Bool,
                     expired: () -> Bool, pause: () -> Void) throws {
        while true {
            guard !cancelled() else { throw Failure.replaced }
            let observed = current()
            if observed == expected { return }
            guard observed < expected else { throw Failure.replaced }
            guard !expired() else { throw Failure.timedOut }
            pause()
        }
    }
}
