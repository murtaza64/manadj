/**
 * Greedy label staggering for the Session timeline's gesture markers
 * (sessions 21): clustered jump/cue labels all sat on one baseline and
 * smeared into an illegible pile. Assign each label the first row whose
 * previous label has ended; a freed row is reused, so sparse stretches
 * stay on the base row and only genuine clusters fan downward.
 */

/** One label's horizontal extent in timeline px. */
export interface StaggerItem {
  x0: number;
  x1: number;
}

/**
 * Row index per item (0 = base row). Items MUST be sorted by `x0`
 * (gesture marks are time-ordered and the axis is monotonic). When every
 * row is occupied the item drops onto the row that frees earliest — a
 * bounded overlap beats an unbounded fan into the waveform.
 */
export function staggerRows(items: StaggerItem[], maxRows: number): number[] {
  const rows = Math.max(1, maxRows);
  const lastEnd: number[] = [];
  return items.map(({ x0, x1 }) => {
    for (let r = 0; r < rows; r++) {
      if ((lastEnd[r] ?? -Infinity) <= x0) {
        lastEnd[r] = x1;
        return r;
      }
    }
    let best = 0;
    for (let r = 1; r < rows; r++) {
      if (lastEnd[r] < lastEnd[best]) best = r;
    }
    lastEnd[best] = x1;
    return best;
  });
}
