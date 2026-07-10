/**
 * Overlay diff viewer for performance data (PRD: performance-data-sync).
 *
 * One waveform — all sides describe the same audio — with color-coded
 * overlay layers per surface: beatgrids (tick overlays computed from the
 * FULL tempo-change list), hot cue sets, and main cues. The waveform BODY
 * is the deck renderer itself (WaveformRendererV2, driven mode, 'full'
 * style slot) so look and styling match the decks exactly; the diff
 * markers live on a transparent 2D canvas above it (the renderer's own
 * overlay pass is single-surface and can't draw the vernier comparison).
 * Zoomable to beat level (wheel, deck step), pannable (drag or horizontal
 * scroll — no playback here). Read-only comparison plus pick-a-side
 * import actions; grid editing stays on the Deck panels.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Track } from '../types';
import type { DecodedWaveform } from '../waveform/blob';
import { useWaveformBlob } from '../waveform/useWaveformBlob';
import { useWaveformRendererV2 } from '../waveform/useWaveformRendererV2';
import {
  beatMarkersFromTempoChanges,
  markersInWindow,
  panWindow,
  zoomWindow,
} from '../utils/perfDiffOverlay';
import { STEP_RATIO } from '../utils/waveformZoom';
import './PerfDiffViewer.css';

// bright, fully saturated (repo preference) — Library cyan; external
// sides carry their own colors (Engine orange, Rekordbox red)
const LIBRARY_COLOR = '#00E5FF';

export interface HotCueVal { slot: number; time: number; label: string | null; color: string | null }
export interface TempoChangeVal { start_time: number; bpm: number; bar_position: number }
export interface BeatgridVal { tempo_changes: TempoChangeVal[] }

export interface ExternalSide {
  sid: 'engine' | 'rekordbox';
  label: string;
  color: string;
  grid: BeatgridVal | null;
  cues: HotCueVal[];
  maincue: number | null;
}

export interface PerfDiffSides {
  libraryGrid: BeatgridVal | null;
  libraryCues: HotCueVal[];
  libraryMaincue: number | null;
  /** Diverging external surfaces, all drawn below the waveform (Engine
   * first). A three-way divergence shows Library + both. */
  externals: ExternalSide[];
}

export function PerfDiffViewer({ trackId, sides, onImport }: {
  trackId: number;
  sides: PerfDiffSides;
  /** Pick-a-side hooks; the parent owns the confirmation rule. */
  onImport: {
    hotcues?: (mode: 'fill-empty' | 'replace-all') => void;
    beatgrid?: () => void;
    maincue?: () => void;
  };
}) {
  const { data: blob, isLoading, error } = useWaveformBlob(trackId);
  const { data: track } = useQuery<Track>({
    queryKey: ['track', trackId],
    queryFn: () => api.tracks.getById(trackId),
  });
  if (isLoading) return <div className="pdv-empty">Loading waveform…</div>;
  if (error || !blob) return <div className="pdv-empty">No waveform available for this track yet</div>;
  return (
    <Viewer
      blob={blob}
      savedMaincue={track?.cue_point_time ?? null}
      sides={sides}
      onImport={onImport}
    />
  );
}

function Viewer({ blob, savedMaincue, sides, onImport }: {
  blob: DecodedWaveform;
  savedMaincue: number | null;
  sides: PerfDiffSides;
  onImport: {
    hotcues?: (mode: 'fill-empty' | 'replace-all') => void;
    beatgrid?: () => void;
    maincue?: () => void;
  };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const duration = blob.duration;
  const extRows = Math.max(0, sides.externals.length - 1);
  // deck renderer underneath: driven (we call draw), window pushed from
  // winRef each frame, constant off-window clock = no playhead line
  const staticClock = useMemo(() => ({ getPlayhead: () => -1e9 }), []);
  const {
    canvasRef: glCanvasRef,
    rendererRef,
    draw: drawBody,
    initError,
  } = useWaveformRendererV2({
    clock: staticClock,
    waveformData: blob,
    config: { playMarkerPosition: 0, showTimeReadout: false },
    driven: true,
    slot: 'full',
  });
  // The window lives in a ref and drawing goes straight to the canvas on
  // rAF — zoom/pan never re-renders React, which is what keeps it smooth.
  const winRef = useRef({ windowStart: 0, windowSeconds: duration });
  const rafRef = useRef<number | null>(null);
  const dragState = useRef<{ startX: number; startWindow: number } | null>(null);

  const libraryMarkers = useMemo(
    () => sides.libraryGrid
      ? beatMarkersFromTempoChanges(sides.libraryGrid.tempo_changes, duration)
      : [],
    [sides.libraryGrid, duration],
  );
  const externalMarkers = useMemo(
    () => sides.externals.map((ext) =>
      ext.grid ? beatMarkersFromTempoChanges(ext.grid.tempo_changes, duration) : []),
    [sides.externals, duration],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const { windowStart, windowSeconds } = winRef.current;
    // the deck renderer paints the body for the same window underneath
    rendererRef.current?.setDisplayWindow(
      windowStart / duration,
      (windowStart + windowSeconds) / duration,
    );
    drawBody();
    const xOf = (t: number) => ((t - windowStart) / windowSeconds) * width;

    // lanes: cue flags above and below the waveform band
    const waveTop = 28;
    const waveBottom = height - 28 - Math.max(0, sides.externals.length - 1) * 18;
    const waveHalf = (waveBottom - waveTop) / 2;

    // ---- beatgrid overlays (Library from top, external surface from bottom — the
    // misalignment reads as a vernier at beat-level zoom)
    const drawGrid = (markers: typeof libraryMarkers, color: string, fromTop: boolean, scale = 1) => {
      const visible = markersInWindow(markers, windowStart, windowSeconds);
      if (visible.length > width * 2) return; // too dense to mean anything
      for (const m of visible) {
        const x = xOf(m.time);
        ctx.strokeStyle = color;
        ctx.globalAlpha = m.isDownbeat ? 0.95 : 0.45;
        ctx.lineWidth = m.isDownbeat ? 2 : 1;
        ctx.beginPath();
        const len = (m.isDownbeat ? waveHalf * 2 : waveHalf * 1.2) * scale;
        if (fromTop) {
          ctx.moveTo(x, waveTop);
          ctx.lineTo(x, waveTop + len);
        } else {
          ctx.moveTo(x, waveBottom);
          ctx.lineTo(x, waveBottom - len);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    drawGrid(libraryMarkers, LIBRARY_COLOR, true);
    sides.externals.forEach((ext, i) =>
      drawGrid(externalMarkers[i], ext.color, false, 1 - 0.35 * i));

    // ---- hot cues (Library flags above, external flags below)
    const drawCue = (cue: HotCueVal, above: boolean, fallback: string, row = 0) => {
      const x = xOf(cue.time);
      if (x < -20 || x > width + 20) return;
      const color = cue.color || fallback;
      const y = above ? waveTop - 4 : waveBottom + 4 + row * 18;
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, above ? waveTop : waveBottom);
      ctx.lineTo(x, y + (above ? -12 : 12));
      ctx.stroke();
      ctx.fillRect(x, above ? y - 16 : y, 14, 12);
      ctx.fillStyle = '#000';
      ctx.font = 'bold 9px monospace';
      ctx.fillText(String(cue.slot), x + 4, above ? y - 7 : y + 9);
      if (cue.label) {
        ctx.fillStyle = color;
        ctx.font = '9px monospace';
        ctx.fillText(cue.label.slice(0, 24), x + 17, above ? y - 7 : y + 9);
      }
    };
    sides.libraryCues.forEach((c) => drawCue(c, true, LIBRARY_COLOR));
    sides.externals.forEach((ext, i) =>
      ext.cues.forEach((c) => drawCue(c, false, ext.color, i)));

    // ---- main cues (labeled triangles)
    const drawMain = (time: number | null, above: boolean, color: string) => {
      if (time === null) return;
      const x = xOf(time);
      if (x < -20 || x > width + 20) return;
      ctx.fillStyle = color;
      ctx.beginPath();
      if (above) {
        ctx.moveTo(x - 6, 2); ctx.lineTo(x + 6, 2); ctx.lineTo(x, 12);
      } else {
        ctx.moveTo(x - 6, height - 2); ctx.lineTo(x + 6, height - 2); ctx.lineTo(x, height - 12);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(x, above ? 12 : height - 12);
      ctx.lineTo(x, above ? waveBottom : waveTop);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    // when the main cue isn't diverged, the Library's saved cue still gives
    // useful context — the waveform response carries it
    drawMain(sides.libraryMaincue ?? savedMaincue, true, LIBRARY_COLOR);
    sides.externals.forEach((ext) => drawMain(ext.maincue, false, ext.color));
  }, [sides, libraryMarkers, externalMarkers, duration, drawBody, rendererRef, savedMaincue]);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      draw();
    });
  }, [draw]);

  useEffect(() => {
    draw();
    const onResize = () => scheduleDraw();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [draw, scheduleDraw]);

  // Wheel zoom needs preventDefault (the sync view must not scroll under
  // the viewer) — React's synthetic wheel handlers are passive, so attach
  // a native non-passive listener.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const { windowStart, windowSeconds } = winRef.current;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.width : 1;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // horizontal scroll pans — there's no playback to follow here
        const dt = ((e.deltaX * unit) / rect.width) * windowSeconds;
        winRef.current = {
          windowSeconds,
          windowStart: panWindow(windowStart, windowSeconds, dt, duration),
        };
      } else {
        const anchor = windowStart + ((e.clientX - rect.left) / rect.width) * windowSeconds;
        const factor = e.deltaY > 0 ? STEP_RATIO : 1 / STEP_RATIO; // shared zoom sensitivity
        winRef.current = zoomWindow(windowStart, windowSeconds, anchor, factor, duration);
      }
      scheduleDraw();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [duration, scheduleDraw]);

  const onPointerDown = (e: React.PointerEvent) => {
    dragState.current = { startX: e.clientX, startWindow: winRef.current.windowStart };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragState.current) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const { windowSeconds } = winRef.current;
    const dt = ((dragState.current.startX - e.clientX) / rect.width) * windowSeconds;
    winRef.current = {
      windowSeconds,
      windowStart: panWindow(dragState.current.startWindow, windowSeconds, dt, duration),
    };
    scheduleDraw();
  };
  const onPointerUp = () => { dragState.current = null; };

  const engineSide = sides.externals.find((e) => e.sid === 'engine');
  const variableExt = sides.externals.find((e) => (e.grid?.tempo_changes.length ?? 0) > 1);

  return (
    <div className="pdv-root">
      <div className="pdv-toolbar">
        <span className="pdv-legend">
          <span className="pdv-swatch" style={{ background: LIBRARY_COLOR }} /> Library (top)
          {sides.externals.map((ext) => (
            <span key={ext.sid}>
              <span className="pdv-swatch" style={{ background: ext.color }} /> {ext.label} (bottom)
            </span>
          ))}
        </span>
        {variableExt && (
          <span className="pdv-variable" title="manadj rendering honors only the first tempo change for now; this viewer shows all of them">
            ⚠ variable grid — {variableExt.grid!.tempo_changes.length} tempo changes ({variableExt.label})
          </span>
        )}
        <span className="pdv-hint">wheel = zoom · horizontal scroll / drag = pan</span>
        <span className="pdv-actions">
          {onImport.hotcues && (engineSide?.cues.length ?? 0) > 0 && (
            sides.libraryCues.length === 0
              ? <button className="uts-microbtn" onClick={() => onImport.hotcues!('fill-empty')}>← import cues</button>
              : <>
                  <button className="uts-microbtn" onClick={() => onImport.hotcues!('fill-empty')}>← fill empty slots</button>
                  <button className="uts-microbtn" onClick={() => onImport.hotcues!('replace-all')}>← replace all cues</button>
                </>
          )}
          {onImport.beatgrid && engineSide?.grid != null && (
            <button className="uts-microbtn" onClick={onImport.beatgrid}>
              {sides.libraryGrid ? '← replace grid' : '← import grid'}
            </button>
          )}
          {onImport.maincue && engineSide?.maincue != null && (
            <button className="uts-microbtn" onClick={onImport.maincue}>
              {sides.libraryMaincue !== null ? '← replace main cue' : '← import main cue'}
            </button>
          )}
        </span>
      </div>
      {/* layout is inlined and uses EXPLICIT width+height: canvas is a
          replaced element, so top+bottom anchoring resolves height from the
          intrinsic (attribute) size — which the deck renderer rewrites at
          clientSize×dpr every frame, inflating the box. Explicit height
          breaks that loop. */}
      <div className="pdv-stack" style={{ position: 'relative', height: 220 }}>
        {initError && <div className="pdv-empty">{initError}</div>}
        <canvas
          ref={glCanvasRef}
          style={{
            position: 'absolute',
            left: 0,
            top: 28,
            width: '100%',
            height: 220 - 28 - (28 + extRows * 18),
            zIndex: 0,
          }}
        />
        <canvas
          ref={canvasRef}
          className="pdv-canvas"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 2 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      </div>
    </div>
  );
}
