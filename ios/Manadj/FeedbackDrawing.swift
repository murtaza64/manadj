import SwiftUI
import UIKit

/// Finger drawing over the feedback screenshot. Strokes are normalized
/// (0...1 across the image) so they flatten onto the PNG at any scale.
struct FeedbackStroke {
    var points: [CGPoint]
}

struct FeedbackCanvasView: View {
    let image: UIImage
    @Binding var strokes: [FeedbackStroke]
    var picking = false
    var selection: CGPoint? = nil
    var onPick: ((CGPoint) -> Void)? = nil
    @State private var current: [CGPoint] = []

    private func path(_ points: [CGPoint], in size: CGSize) -> Path {
        var path = Path()
        let scaled = points.map { CGPoint(x: $0.x * size.width, y: $0.y * size.height) }
        path.addLines(scaled)
        return path
    }

    var body: some View {
        Image(uiImage: image)
            .resizable()
            .scaledToFit()
            .overlay {
                GeometryReader { geometry in
                    Canvas { context, size in
                        if let selection {
                            let ring = CGRect(x: selection.x * size.width - 12, y: selection.y * size.height - 12, width: 24, height: 24)
                            context.stroke(Path(ellipseIn: ring), with: .color(Ink.accent), lineWidth: 3)
                        }
                        for stroke in strokes + [FeedbackStroke(points: current)] where stroke.points.count > 1 {
                            context.stroke(
                                path(stroke.points, in: size), with: .color(Ink.warning),
                                style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
                        }
                    }
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { value in
                                guard !picking else { return }
                                let point = CGPoint(
                                    x: min(1, max(0, value.location.x / geometry.size.width)),
                                    y: min(1, max(0, value.location.y / geometry.size.height)))
                                current.append(point)
                            }
                            .onEnded { value in
                                if picking {
                                    onPick?(CGPoint(x: min(1, max(0, value.location.x / geometry.size.width)), y: min(1, max(0, value.location.y / geometry.size.height))))
                                    current = []; return
                                }
                                if current.count > 1 { strokes.append(FeedbackStroke(points: current)) }
                                current = []
                            })
                }
            }
            .accessibilityIdentifier("feedback-canvas")
    }

    /// Burn the annotations into the screenshot PNG. Point space is the image's
    /// own points; scale matches the image so the export is pixel-faithful.
    static func flatten(_ image: UIImage, strokes: [FeedbackStroke], selection: CGPoint? = nil) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = image.scale
        return UIGraphicsImageRenderer(size: image.size, format: format).image { _ in
            image.draw(at: .zero)
            let stroke = UIBezierPath()
            stroke.lineWidth = max(3, image.size.width / 200)
            stroke.lineCapStyle = .round
            stroke.lineJoinStyle = .round
            for line in strokes where line.points.count > 1 {
                let points = line.points.map {
                    CGPoint(x: $0.x * image.size.width, y: $0.y * image.size.height)
                }
                stroke.move(to: points[0])
                for point in points.dropFirst() { stroke.addLine(to: point) }
            }
            if let selection {
                let radius = max(8, image.size.width / 35)
                let ring = UIBezierPath(ovalIn: CGRect(x: selection.x * image.size.width - radius, y: selection.y * image.size.height - radius, width: radius * 2, height: radius * 2))
                UIColor(Ink.accent).setStroke(); ring.lineWidth = max(3, image.size.width / 200); ring.stroke()
            }
            UIColor(Ink.warning).setStroke()
            stroke.stroke()
        }
    }
}


/// Only explicitly registered visible controls are named. Unregistered points
/// remain screenshot areas, never a guessed semantic identity.
struct FeedbackTarget: Equatable, Sendable {
    let label: String
    let frame: CGRect

    static func label(at point: CGPoint, viewport: CGSize, in targets: [FeedbackTarget]) -> String? {
        guard viewport.width > 0, viewport.height > 0,
              point.x.isFinite, point.y.isFinite,
              (0...1).contains(point.x), (0...1).contains(point.y) else { return nil }
        let absolute = CGPoint(x: point.x * viewport.width, y: point.y * viewport.height)
        return targets.filter { $0.frame.width > 0 && $0.frame.height > 0 && $0.frame.contains(absolute) }
            .min { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }?.label
    }
}
struct FeedbackTargetPreference: PreferenceKey {
    static let defaultValue: [FeedbackTarget] = []
    static func reduce(value: inout [FeedbackTarget], nextValue: () -> [FeedbackTarget]) { value += nextValue() }
}
extension View {
    func feedbackTarget(_ label: String) -> some View {
        background(GeometryReader { geometry in
            Color.clear.preference(key: FeedbackTargetPreference.self,
                value: [FeedbackTarget(label: label, frame: geometry.frame(in: .global))])
        })
    }
}
