import { useEffect, useRef, useState } from 'react';
import { HFader } from '../components/performance/MixerStrip';
import '../components/performance/PerformanceView.css';
import { rerollFollow, setFollowTemperature, useFollowTemperature } from './paramsStore';

export function FollowTemperatureControls({ active }: { active: boolean }) {
  const temperature = useFollowTemperature();
  const faderRef = useRef<HTMLSpanElement>(null);
  const [pointerFocus, setPointerFocus] = useState(false);
  const setTemperature = (value: number) => setFollowTemperature(Math.round(value * 100) / 100);

  useEffect(() => {
    const fader = faderRef.current;
    if (!fader) return;
    // React's wheel listener is passive. Cancel native scrolling here while
    // leaving the event available to HFader's ordinary wheel adjustment.
    const preventScroll = (event: WheelEvent) => event.preventDefault();
    fader.addEventListener('wheel', preventScroll, { passive: false });
    return () => fader.removeEventListener('wheel', preventScroll);
  }, []);

  return (
    <span
      className="follow-temperature-controls"
      title={active
        ? '0 = Match score order; 1 = adventurous. Known stays pinned.'
        : 'Column sort active. Click the Match score header to enable temperature.'}
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <span
        ref={faderRef}
        className="follow-temperature-fader"
        role="slider"
        aria-label="Compatible temperature"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={temperature}
        aria-disabled={!active}
        tabIndex={active ? 0 : -1}
        data-pointer-focus={pointerFocus}
        onPointerDown={() => setPointerFocus(true)}
        onBlur={() => setPointerFocus(false)}
        onKeyDown={(e) => {
          setPointerFocus(false);
          if (!active) return;
          if (!['Home', 'End', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
          e.preventDefault();
          setTemperature(e.key === 'Home' ? 0 : e.key === 'End' ? 1
            : temperature + (e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.05 : -0.05));
        }}
      >
        <HFader
          label="TEMP"
          min={0}
          max={1}
          defaultValue={0}
          value={temperature}
          onChange={setTemperature}
          disabled={!active}
          fill
          title="Compatible temperature: drag or scroll to adjust; double-click resets"
        />
      </span>
      <output>{temperature.toFixed(2)}</output>
      <button
        onClick={rerollFollow}
        disabled={!active || temperature === 0}
        aria-label="Reroll Compatible"
      >
        Reroll
      </button>
    </span>
  );
}
