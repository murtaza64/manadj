/**
 * The Mixer panel — the audible controls, wired straight to the Mixer
 * module via useMixer() (ADR 0009). Columnar per channel: TRIM/HI/MID/LOW/
 * FLT rotary knobs with the VOL fader on the channel's outer flank;
 * crossfader + master below.
 *
 * Mixer state is not React state: controls keep local UI positions (seeded
 * from the Mixer's getters, which survive view switches) and push changes
 * through the setters.
 */
import { useRef, useState } from 'react';
import { useMixer } from '../../hooks/useMixer';
import type { ChannelId } from '../../playback/mixer';
import type { EqBand } from '../../playback/graph';

/** Vertical drag distance (px) that sweeps a knob end to end. */
const KNOB_DRAG_RANGE_PX = 150;

function Knob({
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

function ChannelStrip({ channel }: { channel: ChannelId }) {
  const mixer = useMixer();
  const initial = mixer.getChannelState(channel);
  const [fader, setFader] = useState(initial.fader);

  const eqKnob = (band: EqBand, label: string) => (
    <Knob
      label={label}
      min={0}
      max={1}
      defaultValue={0.5}
      initial={initial.eq[band]}
      onChange={(v) => mixer.setEq(channel, band, v)}
    />
  );

  return (
    <div className={`perf-channel${channel === 'B' ? ' mirrored' : ''}`}>
      <label className="perf-vfader" title="Channel fader">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={fader}
          onChange={(e) => {
            const v = Number(e.target.value);
            setFader(v);
            mixer.setFader(channel, v);
          }}
          onDoubleClick={() => {
            setFader(1);
            mixer.setFader(channel, 1);
          }}
        />
        <span>VOL</span>
      </label>
      <div className="perf-knob-col">
        <span className="perf-channel-name">{channel}</span>
        <Knob
          label="TRIM"
          min={0}
          max={1}
          defaultValue={0.5}
          initial={initial.trim}
          onChange={(v) => mixer.setTrim(channel, v)}
        />
        {eqKnob('high', 'HI')}
        {eqKnob('mid', 'MID')}
        {eqKnob('low', 'LOW')}
        <Knob
          label="FLT"
          min={-1}
          max={1}
          defaultValue={0}
          initial={initial.filter}
          onChange={(v) => mixer.setFilter(channel, v)}
        />
      </div>
    </div>
  );
}

export function MixerPanel() {
  const mixer = useMixer();
  const [crossfader, setCrossfader] = useState(() => mixer.getCrossfader());
  const [master, setMaster] = useState(() => mixer.getMaster());

  return (
    <section className="perf-mixer">
      <div className="perf-mixer-channels">
        <ChannelStrip channel="A" />
        <ChannelStrip channel="B" />
      </div>
      <label className="perf-hfader wide" title="Crossfader (double-click to center)">
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
        <span>X-FADER</span>
      </label>
      <label className="perf-hfader" title="Master volume">
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
        <span>MASTER</span>
      </label>
    </section>
  );
}
