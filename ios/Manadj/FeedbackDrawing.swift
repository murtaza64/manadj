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
                                let point = CGPoint(
                                    x: min(1, max(0, value.location.x / geometry.size.width)),
                                    y: min(1, max(0, value.location.y / geometry.size.height)))
                                current.append(point)
                            }
                            .onEnded { _ in
                                if current.count > 1 { strokes.append(FeedbackStroke(points: current)) }
                                current = []
                            })
                }
            }
            .accessibilityIdentifier("feedback-canvas")
    }

    /// Burn the annotations into the screenshot PNG. Point space is the image's
    /// own points; scale matches the image so the export is pixel-faithful.
    static func flatten(_ image: UIImage, strokes: [FeedbackStroke]) -> UIImage {
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
            UIColor(Ink.warning).setStroke()
            stroke.stroke()
        }
    }
}
