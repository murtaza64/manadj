/**
 * The coach-mark overlay (feature-tour #282): spotlight + popover for one
 * section's steps. In-house, no dependency, no animation (DESIGN.md D9).
 *
 * - Anchors are `data-tour` attributes; steps whose anchor isn't rendered
 *   (missing, display:none, zero rect) are skipped. The anchor rect is
 *   re-measured on a short interval so layout shifts track.
 * - role="dialog" is deliberate: hasKeyboardOverlay() then silences deck
 *   hotkeys while the tour is up. Hardware MIDI input is unaffected — it
 *   never routes through the keyboard layer.
 * - Escape closes (capture phase, claims the event); arrows navigate.
 *   Nothing is focused (focus/noFocusRule stands); keys bind at document.
 */

import { useEffect, useMemo, useState } from 'react';
import { findAnchor, visibleSteps } from './anchors';
import type { TourSection, TourStep } from './steps';
import './tour.css';

const SPOTLIGHT_PAD = 6;
const POPOVER_WIDTH = 320;
/** Rough popover height used for above/below placement — measuring after
 * render would be exact but placement only needs to avoid the viewport edge. */
const POPOVER_ESTIMATE = 190;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function measure(anchor: string): Rect | null {
  const el = findAnchor(anchor);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function TourOverlay({
  section,
  auto,
  onDone,
  onSkipAll,
}: {
  section: TourSection;
  /** True when the tour fired on first entry (shows "Skip all tours"). */
  auto: boolean;
  onDone: () => void;
  onSkipAll: () => void;
}) {
  const steps = useMemo(() => visibleSteps(section.steps), [section]);
  const [idx, setIdx] = useState(0);
  const step: TourStep | undefined = steps[idx];
  const [rect, setRect] = useState<Rect | null>(() => (step ? measure(step.anchor) : null));

  // Nothing on this screen to point at — close without ceremony.
  useEffect(() => {
    if (steps.length === 0) onDone();
  }, [steps, onDone]);

  const next = () => {
    if (idx + 1 >= steps.length) onDone();
    else setIdx(idx + 1);
  };
  const back = () => setIdx(Math.max(0, idx - 1));

  // Track the anchor: re-measure on an interval and on resize. If the
  // anchor disappears mid-step (view changed under us), advance past it.
  useEffect(() => {
    if (!step) return;
    const update = () => {
      const measured = measure(step.anchor);
      if (measured === null) {
        if (idx + 1 >= steps.length) onDone();
        else setIdx(idx + 1);
        return;
      }
      setRect((prev) =>
        prev &&
        prev.top === measured.top &&
        prev.left === measured.left &&
        prev.width === measured.width &&
        prev.height === measured.height
          ? prev
          : measured
      );
    };
    update();
    const timer = setInterval(update, 200);
    window.addEventListener('resize', update);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', update);
    };
  }, [step, idx, steps, onDone]);

  // Capture-phase keys: the tour claims Escape and arrows while open.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onDone();
      } else if (event.key === 'ArrowRight' || event.key === 'Enter') {
        event.preventDefault();
        event.stopImmediatePropagation();
        next();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopImmediatePropagation();
        back();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  });

  if (!step || !rect) return null;

  const spotlight = {
    top: rect.top - SPOTLIGHT_PAD,
    left: rect.left - SPOTLIGHT_PAD,
    width: rect.width + SPOTLIGHT_PAD * 2,
    height: rect.height + SPOTLIGHT_PAD * 2,
  };
  const below = spotlight.top + spotlight.height + POPOVER_ESTIMATE < window.innerHeight;
  const popLeft = Math.max(
    8,
    Math.min(spotlight.left, window.innerWidth - POPOVER_WIDTH - 8)
  );
  const popStyle: React.CSSProperties = below
    ? { left: popLeft, top: spotlight.top + spotlight.height + 8 }
    : { left: popLeft, top: Math.max(8, spotlight.top - 8), transform: 'translateY(-100%)' };

  return (
    <div
      className="tour-overlay"
      role="dialog"
      aria-label={`Tour: ${section.label}`}
      onClick={next}
    >
      <div className="tour-spotlight" style={spotlight} />
      <div className="tour-popover" style={popStyle} onClick={(e) => e.stopPropagation()}>
        <div className="tour-popover-head">
          <span className="tour-popover-title">{step.title}</span>
          <span className="tour-popover-count">
            {idx + 1} / {steps.length}
          </span>
        </div>
        <p className="tour-popover-body">{step.body}</p>
        <div className="tour-popover-actions">
          <button className="tour-skip" onClick={onDone}>
            Skip
          </button>
          {auto && (
            <button className="tour-skip" onClick={onSkipAll}>
              Skip all tours
            </button>
          )}
          <span className="tour-popover-spacer" />
          {idx > 0 && (
            <button className="btn btn-secondary" onClick={back}>
              Back
            </button>
          )}
          <button className="btn btn-primary" onClick={next}>
            {idx + 1 >= steps.length ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
