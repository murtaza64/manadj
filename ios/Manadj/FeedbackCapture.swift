import SwiftUI
import UIKit
import ManadjCore

/// One shake's worth of evidence: a screenshot plus the app-state snapshot the
/// reporter reviews before anything leaves the iPhone. Snapshot keys are the
/// closed set the desktop accepts (FeedbackLimits.snapshotFields).
struct FeedbackSection: Identifiable {
    let key: String
    let title: String
    var included = true
    var id: String { key }
}

struct FeedbackCapture {
    let screenshot: UIImage?
    let warnings: [String]
    let snapshot: [String: Any]
    let sections: [FeedbackSection]

    /// Largest screenshot edge in pixels; keeps the PNG data URL comfortably
    /// under the desktop's 4 MiB cap while staying readable for annotation.
    private static let maxScreenshotEdge: CGFloat = 1400

    @MainActor
    private static func screenshot() -> (image: UIImage?, warning: String?) {
        guard let window = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)
        else { return (nil, "No window was available to screenshot") }
        let format = UIGraphicsImageRendererFormat()
        format.scale = window.screen.scale
        var rendered = false
        let full = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in
            rendered = window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        guard rendered else { return (nil, "Screenshot unavailable: the window did not finish rendering") }
        let pixels = CGSize(width: full.size.width * full.scale, height: full.size.height * full.scale)
        let edge = max(pixels.width, pixels.height)
        guard edge > maxScreenshotEdge else { return (full, nil) }
        let ratio = maxScreenshotEdge / edge
        let size = CGSize(width: (pixels.width * ratio).rounded(.down), height: (pixels.height * ratio).rounded(.down))
        let flat = UIGraphicsImageRendererFormat()
        flat.scale = 1
        let scaled = UIGraphicsImageRenderer(size: size, format: flat).image { _ in
            full.draw(in: CGRect(origin: .zero, size: size))
        }
        return (scaled, "Screenshot scaled down to fit the report size limit")
    }

    @MainActor
    static func capture(model: AppModel, browsing: Bool, settings: Bool) -> FeedbackCapture {
        let (image, warning) = screenshot()
        let window = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene }).flatMap(\.windows).first(where: \.isKeyWindow)
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev"
        let userAgent = "manaDJ iOS \(version) (\(UIDevice.current.model); iOS \(UIDevice.current.systemVersion))"
        let view = settings ? "settings" : (browsing ? "library" : "performance")
        let decks: [[String: Any]] = (0..<4).map { index in
            let deck = model.decks[index]
            return [
                "deck": Ink.deckName(index),
                "title": deck.title,
                "artist": deck.artist,
                "playing": deck.engine.playing,
                "position": (deck.engine.position * 10).rounded() / 10,
                "duration": (deck.duration * 10).rounded() / 10,
                "loading": deck.loading,
            ]
        }
        var snapshot: [String: Any] = [
            "captured_at": ISO8601DateFormatter().string(from: Date()),
            "view": view,
            "user_agent": userAgent,
            "decks": decks,
            "mixer": ["crossfade": (model.crossfade * 100).rounded() / 100, "quantize": model.quantize],
            "session": [
                "recording": model.recording,
                "recordings": model.recordings.count,
                "paired_desktop": model.pairedOrigin ?? NSNull(),
                "status": model.status,
                "recent_operations": model.feedbackActions,
            ],
        ]
        if let window {
            snapshot["viewport"] = [
                "width": Int(window.bounds.width), "height": Int(window.bounds.height),
                "scale": Int(window.screen.scale),
            ]
        }
        if let error = model.error { snapshot["errors"] = [error] }

        var sections = [
            FeedbackSection(key: "session", title: "RECENT ACTIONS & SESSION"),
            FeedbackSection(key: "decks", title: "DECKS"),
            FeedbackSection(key: "mixer", title: "MIXER"),
            FeedbackSection(key: "user_agent", title: "APP & DEVICE"),
        ]
        if model.error != nil {
            sections.append(FeedbackSection(key: "errors", title: "LAST ERROR"))
        }
        return FeedbackCapture(
            screenshot: image, warnings: warning.map { [$0] } ?? [],
            snapshot: snapshot, sections: sections)
    }
}
