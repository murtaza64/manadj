/**
 * Global minimap of the whole mix: A's waveform where only A is audible,
 * B's where only B is, vertically split (A top / B bottom) in the overlap.
 * Columns are transformed by the drawn envelopes — height scales with the
 * fader lane, band colors fade with their EQ lanes — so the minimap
 * previews the mix's energy shape. Overlays: transition tint, hot cue
 * triangles, viewport rectangle (drag to pan), playhead. Click = seek.
 */
import { useEffect, useRef } from 'react';
import { laneValuesAt } from './mixProtoModel';
import { MixProtoPlayer } from './MixProtoPlayer';
import type { ProtoMix } from './mixProtoModel';
import type { WaveformDataWebGL } from '../utils/WebGLWaveformRenderer';
import type { HotCue } from '../types';

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
  player: MixProtoPlayer;
  mix: ProtoMix;
  waveA: WaveformDataWebGL | null;
  waveB: WaveformDataWebGL | null;
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

  // ── Base layer: waveforms + transition frame (debounced redraw) ──
  useEffect(() => {
    const timer = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!baseRef.current) baseRef.current = document.createElement('canvas');
      const base = baseRef.current;
      base.width = w * dpr;
      base.height = h * dpr;
      const ctx = base.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0b0b12';
      ctx.fillRect(0, 0, w, h);

      const tr = mix.transition;
      const durA = waveA?.duration ?? 0;
      const durB = waveB?.duration ?? 0;
      const aEnd = durA > 0 ? Math.min(tr.startSec + tr.durationSec, durA) : 0;
      const eqScale = (v: number) => Math.min(v * 2, 1.15);
      const bands = [
        { key: 'low' as const, color: '242,97,97' },
        { key: 'mid' as const, color: '0,230,0' },
        { key: 'high' as const, color: '135,222,237' },
      ];

      for (let x = 0; x < w; x++) {
        const t = (x / w) * contentEnd;
        const v = laneValuesAt(tr, t);
        const bTrack = tr.bInSec + (t - tr.startSec) * rateB;
        const aOn = durA > 0 && t >= 0 && t < aEnd;
        const bOn = durB > 0 && t >= tr.startSec && bTrack >= 0 && bTrack < durB;

        const drawCol = (
          wave: WaveformDataWebGL,
          trackT: number,
          fader: number,
          eq: { low: number; mid: number; high: number },
          dir: 'down' | 'up'
        ) => {
          const idx = Math.max(0, Math.min(wave.low.length - 1, Math.floor((trackT / wave.duration) * wave.low.length)));
          for (const band of bands) {
            const amp = wave[band.key][idx] * fader * h * 0.95;
            if (amp <= 0.5) continue;
            ctx.fillStyle = `rgba(${band.color},${(0.6 * eqScale(eq[band.key])).toFixed(3)})`;
            ctx.fillRect(x, dir === 'down' ? 0 : h - amp, 1, amp);
          }
        };

        // A hangs from the top edge, B rises from the bottom; through the
        // transition the two interleave in the same space.
        if (aOn && waveA) {
          drawCol(waveA, t, v.faderA, { low: v.eqLowA, mid: v.eqMidA, high: v.eqHighA }, 'down');
        }
        if (bOn && waveB) {
          drawCol(waveB, bTrack, v.faderB, { low: v.eqLowB, mid: v.eqMidB, high: v.eqHighB }, 'up');
        }
      }

      // Transition window: a translucent tint, not a bordered box — the
      // border lines read as markers at minimap scale (issue 14).
      const fx = (tr.startSec / contentEnd) * w;
      const fw = Math.max((tr.durationSec / contentEnd) * w, 2);
      ctx.fillStyle = 'rgba(255,45,149,0.14)';
      ctx.fillRect(fx, 0, fw, h);

      // Hot cue triangles (issue 14): A's along the top edge, B's along the
      // bottom — same convention as the main rows' baseline triangles.
      const cueTri = (x: number, edge: 'top' | 'bottom', color: string) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        if (edge === 'top') {
          ctx.moveTo(x - 4, 0);
          ctx.lineTo(x + 4, 0);
          ctx.lineTo(x, 5);
        } else {
          ctx.moveTo(x - 4, h);
          ctx.lineTo(x + 4, h);
          ctx.lineTo(x, h - 5);
        }
        ctx.closePath();
        ctx.fill();
      };
      for (const c of hotCuesA) {
        if (c.time_seconds >= 0 && c.time_seconds <= contentEnd) {
          cueTri((c.time_seconds / contentEnd) * w, 'top', c.color || '#39ff14');
        }
      }
      for (const c of hotCuesB) {
        const mixT = tr.startSec + (c.time_seconds - tr.bInSec) / rateB;
        if (mixT >= 0 && mixT <= contentEnd) {
          cueTri((mixT / contentEnd) * w, 'bottom', c.color || '#39ff14');
        }
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [mix, waveA, waveB, rateB, contentEnd, hotCuesA, hotCuesB]);

  // ── Overlay layer: viewport rect + playhead (rAF) ──
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (baseRef.current) ctx.drawImage(baseRef.current, 0, 0, w, h);

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
      ctx.fillStyle = '#00e5ff';
      ctx.fillRect(px - 1, 0, 2, h);
    };
    tick();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, contentEnd, pxPerSec]);

  const secAt = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return ((e.clientX - rect.left) / rect.width) * contentEnd;
  };

  return (
    <canvas
      ref={canvasRef}
      className="mixproto-globalminimap"
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
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const sec = secAt(e);
        setScrollPx((sec - drag.current.grabOffsetSec) * pxPerSec);
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    />
  );
}
