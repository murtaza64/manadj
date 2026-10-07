/**
 * BeatFxKeys — the Beat FX LEVEL/DEPTH knob on a held key + mouse (#285
 * review), the same paradigm as the deck EQ/filter keys (DeckKeys): hold
 * the key, move the mouse; a double-tap resets to the center (0 = balance).
 * Null-rendering; mounted once by PerformanceKeyboard.
 */
import { useEffect } from 'react';
import { useViewActive } from '../../contexts/viewActive';
import { useMixer } from '../../hooks/useMixer';
import { isGuardedKeyEvent, isQuantizeShortcut, isTextEntryTarget } from './performanceKeys';
import { registerKeyboardPointer } from './keyboardPointer';
import { MIXER_DRAG_RANGE_PX, moveKnob, type KnobGesture } from './mouseControl';
import { PERFORMANCE_FX_KEYS } from './performanceFxKeys';

export function BeatFxKeys({ enabled = true }: { enabled?: boolean }) {
  const active = useViewActive() && enabled;
  const mixer = useMixer();

  useEffect(() => {
    if (!active) return;
    const key = PERFORMANCE_FX_KEYS.depth;
    let press: { started: number; travel: number; secondTap: boolean; knob?: KnobGesture } | null = null;
    let lastTap = -Infinity;
    const release = () => {
      press = null;
      lastTap = -Infinity;
      pointer.stop();
    };
    const pointer = registerKeyboardPointer({
      cancel: release,
      move: (dx, dy) => {
        if (!press) return;
        press.travel += Math.hypot(dx, dy);
        const delta = (Math.abs(dx) >= Math.abs(dy) ? dx : -dy) / MIXER_DRAG_RANGE_PX;
        if (delta === 0) return;
        press.knob = moveKnob(press.knob, mixer.getBeatFxSection().depth, delta, performance.now(), true);
        mixer.setBeatFxDepth(press.knob.value);
      },
      feedback: () => {
        if (!press) return [];
        const depth = mixer.getBeatFxSection().depth;
        return [{
          id: key, kind: 'knob', control: 'trim', label: 'FX DEPTH', value: (depth + 1) / 2,
          color: 'var(--accent)',
          detail: depth === 0 ? 'BAL' : depth < 0 ? `DRY ${Math.round(-depth * 100)}%` : `WET ${Math.round(depth * 100)}%`,
        }];
      },
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (isQuantizeShortcut(event)) return;
      if (isGuardedKeyEvent(event)) { release(); return; }
      if (event.key !== key || event.shiftKey) return;
      event.preventDefault();
      if (event.repeat || press) return;
      const now = performance.now();
      press = { started: now, travel: 0, secondTap: now - lastTap <= 300 };
      lastTap = -Infinity;
      pointer.start();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== key || !press) return;
      event.preventDefault();
      const now = performance.now();
      const tap = press.travel <= 3 && now - press.started <= 250;
      if (tap && press.secondTap && !isGuardedKeyEvent(event)) mixer.setBeatFxDepth(0);
      else if (tap) lastTap = now;
      press = null;
      pointer.stop();
    };
    const onFocus = () => { if (isTextEntryTarget(document.activeElement)) release(); };
    const onVisibility = () => { if (document.hidden) release(); };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', release);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', release);
      release();
      pointer.dispose();
    };
  }, [active, mixer]);

  return null;
}
