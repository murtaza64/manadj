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

/** Wheel delta that sweeps a control end to end (scroll-to-adjust). */
const WHEEL_RANGE = 1000;

/** Per-event wheel step, sign flipped so scroll-up increases. */
function wheelDelta(e: React.WheelEvent, min: number, max: number): number {
  return (-e.deltaY / WHEEL_RANGE) * (max - min);
}

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
        onWheel={(e) => set(value + wheelDelta(e, min, max))}
      >
        <div className="perf-knob-pointer" style={{ transform: `rotate(${angle}deg)` }} />
      </div>
      <span>{label}</span>
    </div>
  );
}

/**
 * Horizontal fader with the label ON the handle (no label column — the
 * label travels with the grab point). Pointer-driven; scroll adjusts;
 * double-click resets to `defaultValue`. `detent` draws a center tick
 * (pitch zero); `fill` paints the track up to the handle (level-style
 * controls like VOL — meaningless for bipolar ones like pitch).
 */
export function HFader({
  label,
  min,
  max,
  value,
  defaultValue,
  onChange,
  disabled = false,
  accent = false,
  detent = false,
  fill = false,
  title,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  defaultValue: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  accent?: boolean;
  detent?: boolean;
  fill?: boolean;
  title?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const setFromPointer = (clientX: number) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onChange(min + f * (max - min));
  };

  const fraction = (value - min) / (max - min);

  return (
    <div
      ref={ref}
      className={`perf-fader${accent ? ' accent' : ''}${disabled ? ' disabled' : ''}`}
      title={title}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        setFromPointer(e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging.current && !disabled) setFromPointer(e.clientX);
      }}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      onDoubleClick={() => !disabled && onChange(defaultValue)}
      onWheel={(e) => {
        if (disabled) return;
        onChange(Math.max(min, Math.min(max, value + wheelDelta(e, min, max))));
      }}
    >
      <div className="perf-fader-track" />
      {fill && (
        <div
          className="perf-fader-fill"
          style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }}
        />
      )}
      {detent && <div className="perf-fader-detent" />}
      {/* left: X% + translateX(-X%) keeps the handle fully inside the box
          at both extremes (slider-thumb idiom) instead of overflowing by
          half its label width. */}
      <div
        className="perf-fader-handle"
        style={{
          left: `${Math.max(0, Math.min(1, fraction)) * 100}%`,
          transform: `translate(-${Math.max(0, Math.min(1, fraction)) * 100}%, -50%)`,
        }}
      >
        {label}
      </div>
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
      <div className="perf-strip-slot wide">
        <HFader
          label="X-FADER"
          min={-1}
          max={1}
          value={crossfader}
          defaultValue={0}
          detent
          onChange={(v) => {
            setCrossfader(v);
            mixer.setCrossfader(v);
          }}
          title="Crossfader (double-click to center)"
        />
      </div>
      <div className="perf-strip-slot">
        <HFader
          label="MASTER"
          min={0}
          max={1}
          value={master}
          defaultValue={1}
          fill
          onChange={(v) => {
            setMaster(v);
            mixer.setMaster(v);
          }}
          title="Master volume"
        />
      </div>
    </div>
  );
}
