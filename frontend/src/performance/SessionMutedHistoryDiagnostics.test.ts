import { expect, it } from 'vitest';
import { createStripHistory, type StripValues } from './stripHistory';

it('retains a recorded zero fader before a later rise in the desktop history values', () => {
  const history = createStripHistory();
  const strip = (fader: number): StripValues => ({ gain: 1, low: 1, mid: 1, high: 1, fader });
  history.record(0, true, strip(0));
  history.record(4, true, strip(0));
  history.record(5, true, strip(1));
  history.record(6, true, strip(1));
  expect(history.at(4.2, strip(1)).fader).toBe(0);
  expect(history.at(5.5, strip(1)).fader).toBe(1);
  history.record(6.5, true, strip(.4));
  history.record(6.6, true, strip(.4));
  expect(history.at(4.2, strip(.4)).fader).toBe(0);
  expect(history.at(5.5, strip(.4)).fader).toBe(1);
});
