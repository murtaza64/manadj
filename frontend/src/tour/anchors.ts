/**
 * Anchor resolution (feature-tour #282): a step points at a
 * `data-tour="<anchor>"` attribute; an anchor counts as rendered only
 * with a nonzero rect (display:none panes measure 0×0).
 */

import type { TourStep } from './steps';

export function findAnchor(anchor: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`);
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return node;
  }
  return null;
}

/** Story 5: only steps whose anchor is actually on screen take part. */
export function visibleSteps(steps: TourStep[]): TourStep[] {
  return steps.filter((step) => findAnchor(step.anchor) !== null);
}
