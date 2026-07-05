/**
 * The mixer strip (perf-layout 01): X-FADER + MASTER in a slim horizontal
 * row between the waveforms and the decks. Per-channel controls (TRIM/EQ/
 * FLT/VOL) live on their deck's MIX zone — the strip is all that remains of
 * the central mixer column.
 *
 * Wired straight to the Mixer module via useMixer() (ADR 0009): mixer state
 * is not React state — controls keep local UI positions (seeded from the
 * Mixer's getters, which survive view switches) and push changes through
 * the setters. The shared rotary Knob lives here too (used by the deck MIX
 * zones).
 */
import { useRef, useState } from 'react';
import { useMixer } from '../../hooks/useMixer';

/** Vertical drag distance (px) that sweeps a knob end to end. */
const KNOB_DRAG_RANGE_PX = 150;

export function Knob({
  label,
  min,
  max,
  defaultValue,
  initial,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  /** Double-click reset position. */
  defaultValue: number;
  initial: number;
  onChange: (value: number) => void;
}) {
  const [value, setValue] = useState(initial);
  const drag = useRef<{ startY: number; startValue: number } | null>(null);

  const set = (v: number) => {
    const clamped = Math.max(min, Math.min(max, v));
    setValue(clamped);
    onChange(clamped);
  };

  const fraction = (value - min) / (max - min);
  const angle = -135 + fraction * 270;

  return (
    <div className="perf-knob">
      <div
        className="perf-knob-dial"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { startY: e.clientY, startValue: value };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const deltaPx = drag.current.startY - e.clientY;
          set(drag.current.startValue + (deltaPx / KNOB_DRAG_RANGE_PX) * (max - min));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={() => set(defaultValue)}
      >
        <div className="perf-knob-pointer" style={{ transform: `rotate(${angle}deg)` }} />
      </div>
      <span>{label}</span>
    </div>
  );
}

export function MixerStrip() {
  const mixer = useMixer();
  const [crossfader, setCrossfader] = useState(() => mixer.getCrossfader());
  const [master, setMaster] = useState(() => mixer.getMaster());

  return (
    <div className="perf-strip">
      <div />
      <label className="perf-strip-fader wide" title="Crossfader (double-click to center)">
        <span>X-FADER</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={crossfader}
          onChange={(e) => {
            const v = Number(e.target.value);
            setCrossfader(v);
            mixer.setCrossfader(v);
          }}
          onDoubleClick={() => {
            setCrossfader(0);
            mixer.setCrossfader(0);
          }}
        />
      </label>
      <label className="perf-strip-fader" title="Master volume">
        <span>MASTER</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={master}
          onChange={(e) => {
            const v = Number(e.target.value);
            setMaster(v);
            mixer.setMaster(v);
          }}
          onDoubleClick={() => {
            setMaster(1);
            mixer.setMaster(1);
          }}
        />
      </label>
    </div>
  );
}
