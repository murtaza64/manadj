import Foundation

public enum CaptureLoadError: Error, Equatable { case invalid, conflict, full }

/// Host-owned exact identity evidence. Tokens are registered before prepare is
/// submitted, not inferred from a decoder completion or the current UI selection.
/// No eviction while an engine epoch can still publish queued older loads.
public struct SessionCaptureLoads: Sendable {
    private struct Key: Hashable, Sendable { let deck: Int; let token: UInt64 }
    private var values: [Key: Int] = [:]
    public static let maximumBindings = 512
    public init() {}

    public mutating func register(deck: Int, token: UInt64, trackID: Int) throws {
        guard (0..<4).contains(deck), token > 0, trackID > 0 else { throw CaptureLoadError.invalid }
        let key = Key(deck: deck, token: token)
        if let existing = values[key] {
            guard existing == trackID else { throw CaptureLoadError.conflict }
            return
        }
        guard values.count < Self.maximumBindings else { throw CaptureLoadError.full }
        values[key] = trackID
    }
    public func resolve(deck: Int, token: UInt64) -> Int? { values[Key(deck: deck, token: token)] }
}
