/**
 * Global minimap of the whole mix: A's waveform where only A is audible,
 * B's where only B is, vertically split (A top / B bottom) in the overlap.
 * Columns render through the persisted 'minimap' style slot (gh#201: the
 * shared CPU style interpreter — no rogue band palette), transformed by the
 * drawn envelopes: height scales with the fader lane, band groups fade with
 * their EQ lanes — so the minimap previews the mix's energy shape.
 * Overlays: transition tint, hot cue flags, viewport rectangle (drag to
 * pan), playhead. Click = seek.
 */
import { useEffect, useRef } from 'react';
import { useViewActive } from '../contexts/viewActive';
import { DECK_COLORS, hexToRgbTriplet } from '../theme/deckColors';
import { cueCssColor } from '../hotcues/palette';
import {
  drawCueFlag,
  MINIMAP_BRIGHTNESS,
  PLAYHEAD_TRANSPORT,
  WAVE_BG_COLOR,
} from '../theme/markers';
import { createStyledColumnRenderer } from '../sets/ladderWaveStyle';
import type { ColumnModulation } from '../sets/ladderWaveStyle';
import { useStyleSlot } from '../waveform/styleSlots';
import {
  aContentSegments,
  aEndMixTime,
  aTrackTimeAt,
  bContentSegments,
  laneValuesAt,
} from './mixModel';
import { MixPlayer } from './MixPlayer';
import type { EditorMix } from './mixModel';
import type { DecodedWaveform } from '../waveform/blob';
import type { HotCue } from '../types';

/** Idle-poll cadence when the mix is paused and nothing changed
 * (performance-hardening 01) — the shared motion-clock idiom. */
const IDLE_TICK_MS = 250;

/**
 * Global minimap of the whole mix: A's waveform where only A is audible,
 * B's where only B is, vertically split (A top / B bottom) in the overlap.
 * Columns are transformed by the drawn envelopes — height scales with the
 * fader lane, band colors fade with their EQ lanes — so the minimap previews
 * the mix's energy shape, not just the source material. Overlays: transition
 * frame, viewport rectangle (drag to pan), playhead. Click outside the
 * viewport = seek.
 */
export function GlobalMinimap({
  player,
  mix,
  waveA,
  waveB,
  rateB,
  contentEnd,
  pxPerSec,
  hotCuesA,
  hotCuesB,
  getScrollPx,
  setScrollPx,
  getViewPx,
}: {
  player: MixPlayer;
  mix: EditorMix;
  waveA: DecodedWaveform | null;
  waveB: DecodedWaveform | null;
  rateB: number;
  contentEnd: number;
  pxPerSec: number;
  hotCuesA: HotCue[];
  hotCuesB: HotCue[];
  getScrollPx: () => number;
  setScrollPx: (px: number) => void;
  getViewPx: () => number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<{ grabOffsetSec: number } | null>(null);
  const viewActive = useViewActive();
  // The persisted overview style (waveform/styleSlots): the same slot the
  // deck minimaps and the Set ladder render — one waveform language.
  const slot = useStyleSlot('minimap');
  // The base canvas is redrawn IN PLACE (same element), so the overlay's
  // dirty key tracks a version counter, not the canvas identity.
  const baseVersionRef = useRef(0);
  // Pointer interactions (seek, viewport drag) pull an idle-parked loop
  // forward so the first response frame is immediate, not a poll later.
  const wakeRef = useRef<() => void>(() => {});

  // ── Base layer: waveforms + transition frame (debounced redraw) ──
  useEffect(() => {
    if (!viewActive) return; // hidden (KeepAliveView): clientWidth is 0 — a
    // redraw would resize the base to 0×0 and the overlay's drawImage on
    // re-activation throws InvalidStateError, unmounting the whole app
    // (#188 blank screen). viewActive is a dep, so re-activation repaints.
    const timer = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return; // mid-layout / hidden — never a 0-size base
      if (!baseRef.current) baseRef.current = document.createElement('canvas');
      const base = baseRef.current;
      base.width = w * dpr;
      base.height = h * dpr;
      const ctx = base.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = WAVE_BG_COLOR;
      ctx.fillRect(0, 0, w, h);

      const tr = mix.transition;
      const durA = waveA?.duration ?? 0;
      const durB = waveB?.duration ?? 0;
      // Jump-aware A end (issue 177): first durA crossing on the jumped
      // path, capped at the window end.
      const aEnd = durA > 0 ? aEndMixTime(tr, durA) : 0;
      // EQ lane value → per-group visual gain: the GL editor rows' eqVis
      // idiom (DawTimeline modLuts) — kills fade the group, boosts push it.
      const eqVis = (v: number) => Math.min(v * 2, 1.15);

      // One audible content segment (mix-axis, linear in track time),
      // rendered through the persisted 'minimap' style slot: the shared
      // CPU interpreter of the GL style system (sets/ladderWaveStyle).
      // Splice discontinuities arrive as segment boundaries for free
      // (issue 177 / transition-takes 06). 'down' hangs from the top edge
      // (deck A), 'up' rises from the bottom (deck B); through the
      // transition the two interleave in the same space.
      const drawSegment = (
        renderer: ReturnType<typeof createStyledColumnRenderer>,
        seg: { mixStartSec: number; mixEndSec: number; bStartSec: number },
        rate: number,
        dir: 'down' | 'up',
        eqOf: (v: ReturnType<typeof laneValuesAt>) => [number, number, number],
        faderOf: (v: ReturnType<typeof laneValuesAt>) => number,
      ) => {
        const x0 = Math.max(0, Math.round((seg.mixStartSec / contentEnd) * w));
        const x1 = Math.min(w, Math.round((seg.mixEndSec / contentEnd) * w));
        const cols = x1 - x0;
        if (cols <= 0) return;
        const mixAt = (x: number) => (x / w) * contentEnd;
        const t0 = seg.bStartSec + (mixAt(x0) - seg.mixStartSec) * rate;
        const t1 = seg.bStartSec + (mixAt(x1) - seg.mixStartSec) * rate;
        const modulate = (x: number): ColumnModulation => {
          const v = laneValuesAt(tr, mixAt(x0 + x + 0.5));
          return { eq: eqOf(v), scale: faderOf(v) };
        };
        const columns = renderer.render(t0, t1, cols, MINIMAP_BRIGHTNESS, modulate);
        for (let x = 0; x < cols; x++) {
          const col = columns[x];
          if (col.outOfTrack) continue;
          for (const s of col.segments) {
            ctx.fillStyle = s.css;
            const hgt = (s.y1 - s.y0) * h;
            ctx.fillRect(x0 + x, dir === 'down' ? s.y0 * h : h - s.y1 * h, 1, hgt);
          }
        }
      };

      if (waveA && durA > 0) {
        const rendA = createStyledColumnRenderer(waveA, slot.styleId, slot.params);
        for (const seg of aContentSegments(tr, durA)) {
          // Clamp to the audible end (walkA caps segments at aEnd already;
          // guard against a zero-length tail).
          if (seg.mixStartSec >= aEnd) continue;
          drawSegment(
            rendA,
            { ...seg, mixEndSec: Math.min(seg.mixEndSec, aEnd) },
            1,
            'down',
            (v) => [eqVis(v.eqLowA), eqVis(v.eqMidA), eqVis(v.eqHighA)],
            (v) => v.faderA,
          );
        }
      }
      if (waveB && durB > 0) {
        const rendB = createStyledColumnRenderer(waveB, slot.styleId, slot.params);
        for (const seg of bContentSegments(tr, durB, rateB)) {
          drawSegment(
            rendB,
            seg,
            rateB,
            'up',
            (v) => [eqVis(v.eqLowB), eqVis(v.eqMidB), eqVis(v.eqHighB)],
            (v) => v.faderB,
          );
        }
      }

      // Transition window: a translucent tint, not a bordered box — the
      // border lines read as markers at minimap scale (issue 14).
      const fx = (tr.startSec / contentEnd) * w;
      const fw = Math.max((tr.durationSec / contentEnd) * w, 2);
      ctx.fillStyle = `rgba(${hexToRgbTriplet(DECK_COLORS.B)}, 0.14)`;
      ctx.fillRect(fx, 0, fw, h);

      // Hot cue marks: the global zoned-mark idiom (mix-editor 32,
      // hotcue-colors 01) — the shared 'mini' cue flag (theme/markers),
      // matching the performance minimap. A's flags fly along the top edge,
      // B's along the bottom (the deck zones), stored-color-wins via
      // cueCssColor.
      const cueFlag = (x: number, edge: 'top' | 'bottom', color: string) =>
        drawCueFlag(ctx, x, { color, variant: 'mini', height: h, edge });
      // A cues map through A's spliced segments (issue 177) plus the
      // silent tail after the window — a cue in replayed content marks
      // every landing. Without jumpsA this degenerates to the legacy
      // track-position flags.
      const aExitTrack =
        durA > 0 ? Math.min(durA, Math.max(0, aTrackTimeAt(tr, aEnd))) : 0;
      const aCueSegs =
        durA > 0
          ? [
              ...aContentSegments(tr, durA),
              ...(durA > aExitTrack
                ? [{ mixStartSec: aEnd, mixEndSec: aEnd + (durA - aExitTrack), bStartSec: aExitTrack }]
                : []),
            ]
          : [];
      for (const c of hotCuesA) {
        for (const g of aCueSegs) {
          if (c.time_seconds < g.bStartSec) continue;
          const mixT = g.mixStartSec + (c.time_seconds - g.bStartSec);
          if (mixT >= g.mixEndSec || mixT < 0 || mixT > contentEnd) continue;
          cueFlag((mixT / contentEnd) * w, 'top', cueCssColor(c.slot_number, c.color));
        }
      }
      // B cues map through the spliced segments (transition-takes 06) —
      // a cue in replayed content marks every landing, like the main row.
      for (const c of hotCuesB) {
        for (const g of bContentSegments(tr, durB, rateB)) {
          if (c.time_seconds < g.bStartSec) continue;
          const mixT = g.mixStartSec + (c.time_seconds - g.bStartSec) / rateB;
          if (mixT >= g.mixEndSec || mixT < 0 || mixT > contentEnd) continue;
          cueFlag((mixT / contentEnd) * w, 'bottom', cueCssColor(c.slot_number, c.color));
        }
      }
      // New base pixels: bump the version and pull the idle overlay loop
      // forward so they composite this frame (performance-hardening 01).
      baseVersionRef.current++;
      wakeRef.current();
    }, 100);
    return () => clearTimeout(timer);
  }, [mix, waveA, waveB, rateB, contentEnd, hotCuesA, hotCuesB, viewActive, slot]);

  // ── Overlay layer: viewport rect + playhead (dirty-keyed motion clock,
  // performance-hardening 01): redraw only when the composited inputs
  // changed (base version, viewport rect, playhead, canvas size); rAF while
  // the mix plays or a drag pans, else a 250ms idle poll. Sleeps entirely
  // while the editor view is hidden (the effect gates on viewActive and
  // repaints immediately on re-activation). ──
  useEffect(() => {
    if (!viewActive) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;
    let idleTimer = 0;
    let lastDrawKey = '';
    const schedule = (active: boolean) => {
      if (active) raf = requestAnimationFrame(tick);
      else idleTimer = window.setTimeout(tick, IDLE_TICK_MS);
    };
    const tick = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const drawKey =
        `${baseVersionRef.current}:${getScrollPx()}:${getViewPx()}:` +
        `${player.getMixTime()}:${w}x${h}:${dpr}`;
      const didDraw = drawKey !== lastDrawKey;
      if (didDraw) {
        lastDrawKey = drawKey;
        if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
          canvas.width = w * dpr;
          canvas.height = h * dpr;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        // 0-size sources throw InvalidStateError (#188) — belt and braces
        // alongside the base effect's own size gate.
        if (baseRef.current && baseRef.current.width > 0 && baseRef.current.height > 0) {
          ctx.drawImage(baseRef.current, 0, 0, w, h);
        }

        const viewStart = getScrollPx() / pxPerSec;
        const viewSec = getViewPx() / pxPerSec;
        const vx = (viewStart / contentEnd) * w;
        const vw = Math.min((viewSec / contentEnd) * w, w);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1;
        ctx.strokeRect(vx + 0.5, 0.5, vw - 1, h - 1);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(vx, 0, vw, h);

        const px = (player.getMixTime() / contentEnd) * w;
        // Transport playhead (D6 registry): the audible mix position —
        // never a deck color (deck colors mean decks).
        ctx.fillStyle = PLAYHEAD_TRANSPORT;
        ctx.fillRect(px - 1, 0, 2, h);
      }
      schedule(player.isPlaying() || drag.current !== null || didDraw);
    };
    wakeRef.current = () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(idleTimer);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      wakeRef.current = () => {};
      cancelAnimationFrame(raf);
      window.clearTimeout(idleTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, contentEnd, pxPerSec, viewActive]);

  const secAt = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return ((e.clientX - rect.left) / rect.width) * contentEnd;
  };

  return (
    <canvas
      ref={canvasRef}
      className="editor-globalminimap"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const sec = secAt(e);
        const viewStart = getScrollPx() / pxPerSec;
        const viewSec = getViewPx() / pxPerSec;
        if (sec >= viewStart && sec <= viewStart + viewSec) {
          drag.current = { grabOffsetSec: sec - viewStart };
        } else {
          drag.current = null;
          player.seek(sec);
        }
        wakeRef.current();
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const sec = secAt(e);
        setScrollPx((sec - drag.current.grabOffsetSec) * pxPerSec);
        wakeRef.current();
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    />
  );
}
