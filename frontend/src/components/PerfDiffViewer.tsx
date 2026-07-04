/**
 * Overlay diff viewer for performance data (PRD: performance-data-sync).
 *
 * One waveform — both sides describe the same audio — with two color-coded
 * overlay layers: Library vs Engine beatgrids (tick overlays computed from
 * the FULL tempo-change list), hot cue sets, and main cues. Zoomable to
 * beat level (wheel), pannable (drag). Read-only comparison plus
 * pick-a-side import actions; grid editing stays on the Deck panels.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { WaveformResponse } from '../types';
import {
  beatMarkersFromTempoChanges,
  markersInWindow,
  panWindow,
  zoomWindow,
} from '../utils/perfDiffOverlay';
import './PerfDiffViewer.css';

// bright, fully saturated (repo preference) — Library cyan, Engine orange
const LIBRARY_COLOR = '#00E5FF';
const ENGINE_COLOR = '#FF6D00';
// band colors matching WebGLWaveformRenderer's bandColors (low/mid/high)
const BAND_LOW_COLOR = 'rgb(242, 97, 97)';
const BAND_MID_COLOR = 'rgb(0, 255, 0)';
const BAND_HIGH_COLOR = 'rgb(135, 222, 237)';

export interface HotCueVal { slot: number; time: number; label: string | null; color: string | null }
export interface TempoChangeVal { start_time: number; bpm: number; bar_position: number }
export interface BeatgridVal { tempo_changes: TempoChangeVal[] }

export interface PerfDiffSides {
  libraryGrid: BeatgridVal | null;
  engineGrid: BeatgridVal | null;
  libraryCues: HotCueVal[];
  engineCues: HotCueVal[];
  libraryMaincue: number | null;
  engineMaincue: number | null;
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
  const { data: waveform, isLoading, error } = useQuery<WaveformResponse>({
    queryKey: ['waveform', trackId],
    queryFn: () => api.waveforms.get(trackId),
  });

  if (isLoading) return <div className="pdv-empty">Loading waveform…</div>;
  if (error || !waveform) return <div className="pdv-empty">No waveform available for this track yet</div>;
  return <Viewer waveform={waveform} sides={sides} onImport={onImport} />;
}

function Viewer({ waveform, sides, onImport }: {
  waveform: WaveformResponse;
  sides: PerfDiffSides;
  onImport: {
    hotcues?: (mode: 'fill-empty' | 'replace-all') => void;
    beatgrid?: () => void;
    maincue?: () => void;
  };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const duration = waveform.data.duration;
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
  const engineMarkers = useMemo(
    () => sides.engineGrid
      ? beatMarkersFromTempoChanges(sides.engineGrid.tempo_changes, duration)
      : [],
    [sides.engineGrid, duration],
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
    const xOf = (t: number) => ((t - windowStart) / windowSeconds) * width;

    // lanes: cue flags above and below the waveform band
    const waveTop = 28;
    const waveBottom = height - 28;
    const waveMid = (waveTop + waveBottom) / 2;
    const waveHalf = (waveBottom - waveTop) / 2;

    // ---- waveform: per-pixel-column band maxima, three bands overlaid
    // back to front, mirrored around the centerline — same technique and
    // colors as the deck renderer (WebGLWaveformRenderer bandColors)
    const { low, mid, high } = waveform.data.bands;
    const n = low.length;
    const peaksPerSecond = n / duration;
    const bands: [number[], string][] = [
      [low, BAND_LOW_COLOR],
      [mid, BAND_MID_COLOR],
      [high, BAND_HIGH_COLOR],
    ];
    for (const [peaks, color] of bands) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let px = 0; px < width; px++) {
        const t0 = windowStart + (px / width) * windowSeconds;
        const t1 = windowStart + ((px + 1) / width) * windowSeconds;
        const i0 = Math.max(0, Math.floor(t0 * peaksPerSecond));
        const i1 = Math.min(n, Math.max(i0 + 1, Math.ceil(t1 * peaksPerSecond)));
        let amp = 0;
        for (let i = i0; i < i1; i++) amp = Math.max(amp, peaks[i]);
        const h = Math.min(1, amp) * waveHalf;
        if (h > 0.5) ctx.rect(px, waveMid - h, 1, h * 2);
      }
      ctx.fill();
    }

    // ---- beatgrid overlays (Library from top, Engine from bottom — the
    // misalignment reads as a vernier at beat-level zoom)
    const drawGrid = (markers: typeof libraryMarkers, color: string, fromTop: boolean) => {
      const visible = markersInWindow(markers, windowStart, windowSeconds);
      if (visible.length > width * 2) return; // too dense to mean anything
      for (const m of visible) {
        const x = xOf(m.time);
        ctx.strokeStyle = color;
        ctx.globalAlpha = m.isDownbeat ? 0.95 : 0.45;
        ctx.lineWidth = m.isDownbeat ? 2 : 1;
        ctx.beginPath();
        const len = m.isDownbeat ? waveHalf * 2 : waveHalf * 1.2;
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
    drawGrid(engineMarkers, ENGINE_COLOR, false);

    // ---- hot cues (Library flags above, Engine flags below)
    const drawCue = (cue: HotCueVal, above: boolean, fallback: string) => {
      const x = xOf(cue.time);
      if (x < -20 || x > width + 20) return;
      const color = cue.color || fallback;
      const y = above ? waveTop - 4 : waveBottom + 4;
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
    sides.engineCues.forEach((c) => drawCue(c, false, ENGINE_COLOR));

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
    drawMain(sides.libraryMaincue ?? waveform.data.cue_point_time, true, LIBRARY_COLOR);
    drawMain(sides.engineMaincue, false, ENGINE_COLOR);
  }, [waveform, sides, libraryMarkers, engineMarkers, duration]);

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
      const anchor = windowStart + ((e.clientX - rect.left) / rect.width) * windowSeconds;
      const factor = e.deltaY > 0 ? 1.25 : 0.8;
      winRef.current = zoomWindow(windowStart, windowSeconds, anchor, factor, duration);
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

  const gridsDiffer = sides.engineGrid !== null;
  const variable = (sides.engineGrid?.tempo_changes.length ?? 0) > 1;

  return (
    <div className="pdv-root">
      <div className="pdv-toolbar">
        <span className="pdv-legend">
          <span className="pdv-swatch" style={{ background: LIBRARY_COLOR }} /> Library (top)
          <span className="pdv-swatch" style={{ background: ENGINE_COLOR }} /> Engine (bottom)
        </span>
        {variable && (
          <span className="pdv-variable" title="manadj rendering honors only the first tempo change for now; this viewer shows all of them">
            ⚠ variable grid — {sides.engineGrid!.tempo_changes.length} tempo changes
          </span>
        )}
        <span className="pdv-hint">wheel = zoom · drag = pan</span>
        <span className="pdv-actions">
          {onImport.hotcues && sides.engineCues.length > 0 && (
            sides.libraryCues.length === 0
              ? <button className="uts-microbtn" onClick={() => onImport.hotcues!('fill-empty')}>← import cues</button>
              : <>
                  <button className="uts-microbtn" onClick={() => onImport.hotcues!('fill-empty')}>← fill empty slots</button>
                  <button className="uts-microbtn" onClick={() => onImport.hotcues!('replace-all')}>← replace all cues</button>
                </>
          )}
          {onImport.beatgrid && gridsDiffer && (
            <button className="uts-microbtn" onClick={onImport.beatgrid}>
              {sides.libraryGrid ? '← replace grid' : '← import grid'}
            </button>
          )}
          {onImport.maincue && sides.engineMaincue !== null && (
            <button className="uts-microbtn" onClick={onImport.maincue}>
              {sides.libraryMaincue !== null ? '← replace main cue' : '← import main cue'}
            </button>
          )}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="pdv-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
    </div>
  );
}
