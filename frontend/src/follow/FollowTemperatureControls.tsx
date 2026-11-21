import { useEffect, useRef, useState } from 'react';
import { HFader } from '../components/performance/MixerStrip';
import '../components/performance/PerformanceView.css';
import { rerollFollow, setFollowTemperature, useFollowTemperature } from './paramsStore';

// Pip positions on a 3x3 grid (cells 0-8, row-major) for each die face.
const PIPS: Record<number, number[]> = {
  1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

type Landing = { face: number; x: number; y: number; tilt: number };

// A rotated 10px die, including stroke, fits inside an 8px radius.
// Two disjoint landing pockets keep the dice inside the 36x18 stage.
export function nextDiceLanding(previous: Landing[], random = Math.random): Landing[] {
  return [10, 26].map((center, i) => {
    const die = { face: 1 + Math.floor(random() * 6), x: center + (random() - .5) * 2,
      y: 9 + (random() - .5), tilt: (random() - .5) * 44 };
    if (previous[i] && Math.abs(previous[i].tilt - die.tilt) < 4) {
      die.tilt = die.tilt <= 0 ? die.tilt + 12 : die.tilt - 12;
    }
    return die;
  });
}

function Die({ face, x, y, tilt }: Landing) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt})`} className="reroll-landing">
      <g className="reroll-die">
        <rect x="-5" y="-5" width="10" height="10" rx="1.7" fill="none" stroke="currentColor" strokeWidth="1.3" />
        {PIPS[face].map((cell) => (
          <circle key={cell} cx={-3 + (cell % 3) * 3} cy={-3 + Math.floor(cell / 3) * 3} r="0.8" fill="currentColor" />
        ))}
      </g>
    </g>
  );
}

export function FollowTemperatureControls({ active }: { active: boolean }) {
  const temperature = useFollowTemperature();
  const faderRef = useRef<HTMLSpanElement>(null);
  const [pointerFocus, setPointerFocus] = useState(false);
  const [dice, setDice] = useState<Landing[]>([{ face: 2, x: 10, y: 9, tilt: -12 }, { face: 5, x: 26, y: 9, tilt: 10 }]);
  const [rolls, setRolls] = useState(0);
  const roll = () => {
    rerollFollow(); // the result changes immediately; the tumble is decoration
    setDice(previous => nextDiceLanding(previous));
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
          viewBox="0 0 36 18"
          width="36"
          height="18"
          aria-hidden="true"
        >
          {dice.map((die, i) => <Die key={i} {...die} />)}
        </svg>
      </button>
    </span>
  );
}
