import Foundation

/// A local draft may be cleared only after the exact report id is acknowledged.
/// An existing-id conflict is not a receipt for a changed local report.
public struct CloudFeedbackReceipt: Decodable, Sendable, Equatable {
    public let version: Int
    public let id: String
    public let received: Bool
    public let repeated: Bool

    public static func confirmed(body: Data, status: Int, reportID: String) throws -> Self {
        guard body.count <= 1024, status == 200 || status == 201,
              let receipt = try? JSONDecoder().decode(Self.self, from: body),
              receipt.version == 1, receipt.id == reportID, receipt.received,
              (status == 200 && receipt.repeated) || (status == 201 && !receipt.repeated) else {
            throw FeedbackFailure("No matching cloud receipt. Keep this report on the iPhone to retry")
        }
        return receipt
    }
}
