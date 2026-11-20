import { useEffect, useRef, useState } from 'react';
import { HFader } from '../components/performance/MixerStrip';
import '../components/performance/PerformanceView.css';
import { rerollFollow, setFollowTemperature, useFollowTemperature } from './paramsStore';

// Pip positions on a 3x3 grid (cells 0-8, row-major) for each die face.
const PIPS: Record<number, number[]> = {
  1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

function Die({ face, x, y, tilt }: { face: number; x: number; y: number; tilt: number }) {
  return (
    <g transform={`rotate(${tilt} ${x + 6} ${y + 6})`} className="reroll-die">
      <rect x={x} y={y} width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {PIPS[face].map((cell) => (
        <circle key={cell} cx={x + 2.5 + (cell % 3) * 3.5} cy={y + 2.5 + Math.floor(cell / 3) * 3.5} r="0.9" fill="currentColor" />
      ))}
    </g>
  );
}

const randomFace = () => 1 + Math.floor(Math.random() * 6);

export function FollowTemperatureControls({ active }: { active: boolean }) {
  const temperature = useFollowTemperature();
  const faderRef = useRef<HTMLSpanElement>(null);
  const [pointerFocus, setPointerFocus] = useState(false);
  const [faces, setFaces] = useState<[number, number]>([2, 5]);
  const [rolls, setRolls] = useState(0);
  const roll = () => {
    rerollFollow(); // the result changes immediately; the tumble is decoration
    setFaces([randomFace(), randomFace()]);
    setRolls((n) => n + 1);
  };
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
        className="follow-reroll"
        onClick={roll}
        disabled={!active || temperature === 0}
        aria-label="Reroll Compatible"
      >
        <svg
          // Remounting on each click restarts the CSS tumble, even mid-roll.
          key={rolls}
          className="follow-reroll-dice"
          data-rolling={rolls > 0}
          viewBox="0 0 30 18"
          width="30"
          height="18"
          aria-hidden="true"
        >
          <Die face={faces[0]} x={2} y={3} tilt={-12} />
          <Die face={faces[1]} x={16} y={3} tilt={10} />
        </svg>
      </button>
    </span>
  );
}
