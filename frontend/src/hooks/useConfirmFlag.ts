/**
 * Two-step confirm ("del" → "sure?") that disarms itself on a timeout
 * (keyboard-focus 01, PRD decision 4). The old reset was onBlur — dead
 * under the global no-focus rule (clicks no longer move focus), and
 * strictly worse anyway: an armed confirm used to stick until something
 * else happened to take focus.
 */
import { useEffect, useState } from 'react';

export const CONFIRM_DISARM_MS = 3000;

export function useConfirmFlag(disarmMs: number = CONFIRM_DISARM_MS): {
  /** Render "sure?" state. */
  armed: boolean;
  /** One press: arms and returns false; a second within the window
   * disarms and returns true — the caller performs the action. */
  fire: () => boolean;
  /** External reset (e.g. navigation switched the subject). Safe to call
   * during render — plain state set, timer cleanup rides the effect. */
  disarm: () => void;
} {
  const [armed, setArmed] = useState(false);

  // Timer as an effect of the armed state: re-render-proof, and
  // StrictMode-safe (setup/cleanup are paired).
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), disarmMs);
    return () => clearTimeout(timer);
  }, [armed, disarmMs]);

  return {
    armed,
    fire: () => {
      setArmed(!armed);
      return armed;
    },
    disarm: () => setArmed(false),
  };
}
