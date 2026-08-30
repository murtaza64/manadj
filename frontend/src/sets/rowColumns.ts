/**
 * Set-row column grid (sets 31) — THE shared geometry for SetTrackRow
 * and AdjacencyRow, plus the pure color/format rules the columns render.
 *
 * Columnar by constants, not per-row flex guesswork: before this module
 * the adjacency rows derived their 81px chip alignment by hand from the
 * track row's flex metrics (sets 20's `GUTTER_WIDTH = 58`), which
 * silently broke if either side changed. Both row components consume
 * these constants; issue 32's overlap-time column aligns to the same
 * grid.
 *
 * Track row (flex, `ROW_GAP` gaps, `ROW_PAD_X` padding, `ROW_ACCENT_W`
 * left border):
 *
 *   ▶ · # · in · key · BPM · energy · title/artist (flex) · [badges] · play · ✕
 *
 * Color rules (triage 2026-07-06):
 * - Key = IDENTITY, the Camelot-wheel hue (the app's existing key-color
 *   convention — `getKeyColor`); compatibility coloring shifts with
 *   reorders and stays in suggestions.
 * - BPM = DELTA semantics: vs the Set tempo under Fixed, vs the
 *   predecessor's BPM under Riding; the rendered text stays the absolute
 *   BPM. Deck cyan/magenta stay identity-only (CONTEXT.md: Deck color) —
 *   the delta scale is green→yellow→orange→red, no deck hues.
 */
import type { CSSProperties } from 'react';
import { TRIM_DB_PER_UNIT } from '../playback/mixerMath';
import {
  fmtSec,
  isNeverAudible,
  type PlannedAdjacency,
  type PlannedEntry,
} from './planner';

// ── Track-row geometry ───────────────────────────────────────────────────

/** Deck-parity accent (the 3px left border). */
export const ROW_ACCENT_W = 3;
/** Track-row horizontal padding. */
export const ROW_PAD_X = 12;
/** Track-row flex gap. Tight (review iteration 2026-07-06): six left
 * columns at the old 12px read as gulf, not grid — the app font is
 * monospace, so the widths below are sized to the widest value each
 * column actually holds (13px UbuntuMono ≈ 6.5px/char). */
export const ROW_GAP = 8;
/** ▶ play-from glyph column. */
export const PLAY_COL_W = 18;
/** Play-order index column. */
export const INDEX_COL_W = 24;
/** Key column (OpenKey text, identity-colored — "12m" is the widest). */
export const KEY_COL_W = 24;
/** BPM column (absolute value, delta-colored — "174.0"). */
export const BPM_COL_W = 40;
/** Energy column (the library's 20px energy circle). */
export const ENERGY_COL_W = 22;
/** "in" column — the mix-clock time the track enters ("92:15"). Sits
 * LEFT, right after the play-order index: # and in together read as the
 * running order against the mix clock (review iteration 2026-07-06). */
export const IN_TIME_COL_W = 40;
/** "play" column — the audible span as `play/total` ("12:34/12:34"). */
export const PLAY_TIME_COL_W = 76;
/** Trim column (sets #164) — the entry's trim offset in dB ("−12.0" is
 * the widest), drag-editable; sits in the right band before play-time. */
export const TRIM_COL_W = 52; // number + the dB unit label (#161)
/** ✕ remove glyph column. */
export const REMOVE_COL_W = 24;

/** Where track titles start (from the row's left edge) — the adjacency
 * rows align their chips to this x. Terms in column order:
 * ▶ · # · in · key · BPM · energy. */
export const TITLE_X =
  ROW_ACCENT_W +
  ROW_PAD_X +
  PLAY_COL_W +
  ROW_GAP +
  INDEX_COL_W +
  ROW_GAP +
  IN_TIME_COL_W +
  ROW_GAP +
  KEY_COL_W +
  ROW_GAP +
  BPM_COL_W +
  ROW_GAP +
  ENERGY_COL_W +
  ROW_GAP;

// ── Adjacency-row geometry ───────────────────────────────────────────────
// The adjacency row paints its 3px deck-gradient bar as a background
// layer, so its left padding covers accent + padding in one; its flex
// gap is tighter than the track row's.

/** Adjacency-row left padding (the 3px bar is a background layer). */
export const ADJ_PAD_LEFT = 15;
/** Adjacency-row flex gap. */
export const ADJ_ROW_GAP = 8;
/** The adjacency rows' left gutter (holds the [+] insert affordance):
 * sized so the first chip lands exactly at TITLE_X. */
export const ADJ_GUTTER_W = TITLE_X - ADJ_PAD_LEFT - ADJ_ROW_GAP;

/** Right-band spacer (sets 32): sits where the track rows' ✕ column
 * does, so an adjacency's overlap-time cell (PLAY_TIME_COL_W, right-
 * aligned) lands exactly under the track rows' play-time column —
 * compensating for the adjacency row's tighter gap. */
export const ADJ_TIME_SPACER_W = REMOVE_COL_W + ROW_GAP - ADJ_ROW_GAP;

// ── BPM delta (triage: delta semantics, absolute text) ──────────────────

/** The BPM the delta is measured against: the Set tempo under Fixed
 * (delta = the pitch the plan holds the track at), the predecessor's
 * BPM under Riding (delta = the ride the handover asks for). */
export interface BpmDeltaRef {
  kind: 'set-tempo' | 'predecessor';
  bpm: number;
}

/** Signed delta percent of `bpm` against the reference, null when either
 * side is missing (no reference track, no BPM — render neutral). */
export function bpmDeltaPercent(
  bpm: number | null | undefined,
  ref: BpmDeltaRef | null | undefined
): number | null {
  if (!bpm || !ref || !ref.bpm) return null;
  return (bpm / ref.bpm - 1) * 100;
}

/** Delta-magnitude color scale (bright, saturated; deck cyan/magenta
 * excluded — identity colors never say state): ≤2% green (comfortable),
 * ≤4% yellow (a noticeable ride), ≤8% orange (a hard ride), beyond red.
 * Null delta → null (the caller renders its neutral text color). */
export function bpmDeltaColor(deltaPercent: number | null): string | null {
  if (deltaPercent === null) return null;
  const mag = Math.abs(deltaPercent);
  if (mag <= 2) return 'var(--success)';
  if (mag <= 4) return 'var(--warning)';
  if (mag <= 8) return '#ff9500'; // --peach is scoped to .set-header; same value
  return 'var(--danger)';
}

/** The BPM cell's tooltip: absolute text stays in the cell, the delta
 * semantics ride the title. */
export function bpmDeltaTitle(
  bpm: number | null | undefined,
  ref: BpmDeltaRef | null | undefined
): string {
  if (!bpm) return 'no BPM';
  const delta = bpmDeltaPercent(bpm, ref);
  if (delta === null || !ref) return `${bpm.toFixed(1)} BPM`;
  const signed = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
  const against =
    ref.kind === 'set-tempo'
      ? `the Set tempo ${ref.bpm.toFixed(1)}`
      : `the previous track's ${ref.bpm.toFixed(1)}`;
  return `${bpm.toFixed(1)} BPM — ${signed} vs ${against}`;
}

// ── Cell style (sets 31) ─────────────────────────────────────────────────

/** The shared fixed-width cell style (index/key/BPM/time columns):
 * fixed width, no flex shrink, 13px text — the library track table's
 * scale (TrackRow.css .track-cell-text). Alignment and color vary per
 * column and ride on top. */
export function cellStyle(width: number): CSSProperties {
  return { width: `${width}px`, flexShrink: 0, fontSize: '13px' };
}

// ── Time columns (sets 31) ───────────────────────────────────────────────

/** "in" cell: the mix-clock time this track enters (entryMixSec). Blank
 * for a NEVER AUDIBLE entry — it never enters; the badge carries the
 * signal (sets 19). */
export function fmtInTime(planned: PlannedEntry | undefined): string {
  if (!planned || isNeverAudible(planned)) return '';
  return fmtSec(planned.entryMixSec);
}

/** "play" cell: the audible span over the track length, `play/total`.
 * Blank without a plan/duration or for a NEVER AUDIBLE entry. */
export function fmtPlayTime(
  planned: PlannedEntry | undefined,
  durationSec: number | null | undefined
): string {
  if (!planned || !durationSec || isNeverAudible(planned)) return '';
  return `${fmtSec(Math.max(planned.exitSec - planned.entrySec, 0))}/${fmtSec(durationSec)}`;
}

// ── Trim cell (sets #164) ────────────────────────────────────────────────

/** Trim offset (knob units, 0 = neutral) → its dB reading. */
export function trimOffsetDb(trim: number): number {
  return trim * TRIM_DB_PER_UNIT;
}

/** dB reading → trim offset in knob units (the drag writes dB). */
export function trimOffsetFromDb(db: number): number {
  return db / TRIM_DB_PER_UNIT;
}

/** Trim drag geometry (sets #183): pixels of vertical travel per dB.
 * 20 px/dB puts the full ±12 dB throw at ~480px and a typical ±3 dB
 * ride within a comfortable wrist move. */
export const TRIM_DRAG_PX_PER_DB = 20;
/** The drag's dB granularity (sets #183): values land on 0.1 dB ticks —
 * exactly the display resolution, so the readout advances one tick per
 * 2px and never wobbles between roundings. */
export const TRIM_DRAG_DB_STEP = 0.1;

/** Dragged trim value (knob units) from the TOTAL pointer delta since
 * pointer-down (sets #183): deterministic — the same pixel always reads
 * the same value within a drag; no per-event accumulation to drift.
 * `dyPx` is positive for upward travel (louder). Quantized to
 * TRIM_DRAG_DB_STEP ticks. */
export function trimDragValue(startTrim: number, dyPx: number): number {
  const db = trimOffsetDb(startTrim) + dyPx / TRIM_DRAG_PX_PER_DB;
  const stepped = Math.round(db / TRIM_DRAG_DB_STEP) * TRIM_DRAG_DB_STEP;
  return trimOffsetFromDb(stepped);
}

/** Trim cell text: the offset in dB, signed when non-neutral ("+2.4",
 * "−12.0"); neutral reads "0.0" (rendered dim by the cell). */
export function fmtTrimDb(trim: number): string {
  const db = trimOffsetDb(trim);
  const rounded = Math.round(db * 10) / 10;
  if (rounded === 0) return '0.0';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(1)}`;
}

/** Overlap cell (sets 32): how long the handover overlaps — the planned
 * window's span on the mix axis. Hard cuts render BLANK (triage: the
 * red hard-cut chip carries the message; 0:00 is noise); blank too
 * while the plan is loading. */
export function fmtOverlapTime(
  adjacency: Pick<PlannedAdjacency, 'kind' | 'mixStartSec' | 'mixEndSec'> | undefined
): string {
  if (!adjacency || adjacency.kind === 'hardcut') return '';
  return fmtSec(Math.max(adjacency.mixEndSec - adjacency.mixStartSec, 0));
}
