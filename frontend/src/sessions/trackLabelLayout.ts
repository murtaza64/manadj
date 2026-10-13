import type { TimeAxis, TrackSpan } from './timelineModel';
import { staggerRows } from './labelStagger';

const CHAR_PX = 6.4;
const GAP_PX = 12;

export function layoutTrackLabels(
  spans: TrackSpan[],
  axis: TimeAxis,
  names: Record<number, string>,
  scrollX: number,
  viewportW: number,
  maxRows = 3,
) {
  const labels = spans.flatMap((span, index) => {
    const label = names[span.trackId] ?? `#${span.trackId}`;
    const markerX = axis.tToPx(span.start);
    const collapsed = axis.segments.find(g => g.collapsed && span.start >= g.start && span.start <= g.end);
    const anchor = collapsed ? collapsed.px1 + 4 : markerX;
    const end = axis.tToPx(span.end);
    if (end < scrollX - 50 || anchor > scrollX + viewportW + 50) return [];
    const x = anchor < scrollX && end > scrollX
      ? Math.max(anchor, Math.min(scrollX + 6, end))
      : anchor;
    return [{ index, start: span.start, label, shown: label, x, markerX, row: 0, width: label.length * CHAR_PX }];
  });

  // Keep sparse titles on the top row; crowded loads get a readable prefix
  // on another row instead of disappearing behind the next track's label.
  const extents = labels.map((label, i) => {
    const available = labels[i + 1] ? labels[i + 1].x - label.x - GAP_PX : Infinity;
    label.width = Math.min(label.width, Math.max(8 * CHAR_PX, available));
    return { x0: label.x, x1: label.x + label.width + GAP_PX };
  });
  const rows = staggerRows(extents, maxRows);
  const nextX = new Map<number, number>();
  for (let i = labels.length - 1; i >= 0; i--) {
    const label = labels[i];
    label.row = rows[i];
    const available = Math.min(label.width, (nextX.get(label.row) ?? Infinity) - label.x - GAP_PX);
    const chars = Math.max(0, Math.floor(available / CHAR_PX));
    label.shown = chars >= label.label.length ? label.label
      : chars > 0 ? `${label.label.slice(0, chars - 1)}…` : '';
    label.width = label.shown.length * CHAR_PX;
    nextX.set(label.row, label.x);
  }
  // Even sub-pixel load clusters retain their markers and full hover titles.
  return labels;
}
