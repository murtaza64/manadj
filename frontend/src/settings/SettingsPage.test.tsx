// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MixerContext } from '../hooks/useMixer';
import { Mixer } from '../playback/mixer';
import SettingsPage from './SettingsPage';
import { describeSweepFilter } from '../playback/sweepFilter';
import { DEFAULT_FILTER_SETTINGS, FILTER_PARAMETER_RANGES } from '../playback/filterSettings';
import { defaultSlots, getSlot, getSlots, resetSlots } from '../waveform/styleSlots';
import { GRV6_JOG_CALIBRATION } from '../midi/jogCalibration';
import { getJogCalibration, resetGrv6JogCalibration } from '../midi/jogCalibrationStore';
import { BEAT_FX_PARAMETER_RANGES, DEFAULT_BEAT_FX_SETTINGS } from '../playback/beatFxSettings';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// Settings renders Controller check too; device discovery belongs to its own tests.
vi.mock('../playback/audioDevices', async (importOriginal) => ({
  ...await importOriginal<typeof import('../playback/audioDevices')>(),
  listAudioOutputs: vi.fn(async () => []),
}));
vi.hoisted(() => {
  const values = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (i: number) => [...values.keys()][i] ?? null,
    get length() {
      return values.size;
    },
  };
});
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('AudioContext', class {
    constructor() { throw new Error('Settings must not construct audio'); }
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
  resetSlots();
  resetGrv6JogCalibration();
});

let root: Root | undefined;

function press(slider: HTMLElement, key: string) {
  act(() => {
    slider.focus();
    slider.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

function drag(slider: HTMLElement, fraction: number) {
  slider.setPointerCapture = vi.fn();
  slider.releasePointerCapture = vi.fn();
  vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 1000 } as DOMRect);
  act(() => slider.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, bubbles: true })));
  act(() => slider.dispatchEvent(new MouseEvent('pointermove', { clientX: fraction * 1000, bubbles: true })));
  act(() => slider.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })));
}

function expectFaders(host: HTMLElement, count: number) {
  expect(host.querySelector('input[type="range"]')).toBeNull();
  const sliders = [...host.querySelectorAll<HTMLElement>('[role="slider"]')];
  expect(sliders).toHaveLength(count);
  expect(new Set(sliders.map((slider) => slider.id)).size).toBe(count);
  for (const slider of sliders) {
    expect(slider.id).not.toBe('');
    expect(slider.getAttribute('aria-label')).toBeTruthy();
    expect(slider.classList.contains('perf-fader')).toBe(true);
    expect(slider.classList.contains('accent')).toBe(true);
    expect(slider.querySelector('.perf-fader-track')).not.toBeNull();
    const fill = slider.querySelector<HTMLElement>('.perf-fader-fill')!;
    expect(fill).not.toBeNull();
    expect(fill.style.background).toBe('var(--accent)');
    const min = Number(slider.getAttribute('aria-valuemin'));
    const max = Number(slider.getAttribute('aria-valuemax'));
    const value = Number(slider.getAttribute('aria-valuenow'));
    expect(parseFloat(fill.style.width)).toBeCloseTo(Math.max(0, Math.min(1, (value - min) / (max - min))) * 100, 3);
    expect(slider.querySelector('.perf-fader-handle')?.textContent).toBe(
      Number(Number(slider.getAttribute('aria-valuenow')).toPrecision(6)).toString(),
    );
  }
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  document.body.innerHTML = '';
  localStorage.clear();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

it('edits typed values only on commit, supports cancel/reset and does not create audio', async () => {
  const mixer = new Mixer();
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <MixerContext.Provider value={mixer}>
        <SettingsPage />
      </MixerContext.Provider>,
    ),
  );
  expect(mixer.getFilterSettings()).toMatchObject({
    model: 'res24',
    resonance: 17,
    compensation: 0.85,
  });
  let input = host.querySelector<HTMLInputElement>(
    '[aria-label="High-pass endpoint value"]',
  )!;
  const type = (text: string) =>
    act(() => {
      input.focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  type('8');
  expect(mixer.getFilterSettings().hpMax).toBe(16000);
  type('8000');
  act(() =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    ),
  );
  expect(mixer.getFilterSettings().hpMax).toBe(8000);
  type('20000');
  act(() =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  expect(mixer.getFilterSettings().hpMax).toBe(8000);
  const reset = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'Reset filter defaults',
  )!;
  type('9000');
  act(() => reset.click());
  expect(mixer.getFilterSettings().hpMax).toBe(16000);
  input = host.querySelector<HTMLInputElement>('[aria-label="High-pass endpoint value"]')!;
  expect(input.value).toBe('16000');
  type('7000'); // reset must discard a draft even if persisted values are already defaults
  act(() => reset.click());
  input = host.querySelector<HTMLInputElement>('[aria-label="High-pass endpoint value"]')!;
  expect(input.value).toBe('16000');
  act(() => { input.focus(); input.blur(); });
  expect(mixer.getFilterSettings().hpMax).toBe(16000);
  expect(host.querySelectorAll('.settings-nav button')).toHaveLength(7);
  expect(host.querySelector('[aria-label="Filter frequency response"] polyline')?.getAttribute('points')?.split(' ')).toHaveLength(180);
  expect(host.querySelector('input[type="search"], canvas')).toBeNull();
  expect(host.textContent).toContain('Target response at 48 kHz');
  expectFaders(host.querySelector<HTMLElement>('#settings-section-filters')!, 11);
});

it('edits and resets persisted Beat FX sound parameters without creating audio', async () => {
  const mixer = new Mixer();
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<MixerContext value={mixer}><SettingsPage /></MixerContext>));
  const effects = [...host.querySelectorAll<HTMLButtonElement>('.settings-nav button')]
    .find((button) => button.textContent?.startsWith('Performance'))!;
  act(() => effects.click());
  expect([...host.querySelectorAll('.settings-effect-card h3')].map((node) => node.textContent))
    .toEqual(['Echo', 'Reverb', 'Flanger']);
  expectFaders(host.querySelector<HTMLElement>('#settings-section-effects')!, Object.keys(BEAT_FX_PARAMETER_RANGES).length);

  const feedback = host.querySelector<HTMLElement>('#beat-fx-flangerFeedback')!;
  press(feedback, 'End');
  expect(mixer.getBeatFxSettings().flangerFeedback).toBe(0.9);
  const decay = host.querySelector<HTMLElement>('#beat-fx-reverbDecay')!;
  press(decay, 'Home');
  expect(mixer.getBeatFxSettings().reverbDecay).toBe(0.5);

  const unit = host.querySelector('[aria-label="Flanger length unit"]')!;
  const bars = [...unit.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Bars')!;
  const beats = [...unit.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Beats')!;
  expect(bars.getAttribute('aria-pressed')).toBe('true');
  act(() => beats.click());
  expect(mixer.getBeatFxSettings().flangerLengthUnit).toBe('beats');
  expect(beats.getAttribute('aria-pressed')).toBe('true');

  const reset = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent === 'Reset effect defaults')!;
  act(() => reset.click());
  expect(mixer.getBeatFxSettings()).toEqual(DEFAULT_BEAT_FX_SETTINGS);
});

it('binds every filter fader to its scaled parameter and keeps model-disabled fields inert', async () => {
  const mixer = new Mixer();
  mixer.setFilterSettings({ model: 'dual' });
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<MixerContext value={mixer}><SettingsPage /></MixerContext>));
  for (const key of Object.keys(FILTER_PARAMETER_RANGES) as (keyof typeof FILTER_PARAMETER_RANGES)[]) {
    const slider = host.querySelector<HTMLElement>(`[role="slider"]#filter-${key}`)!;
    const [min, max, step] = FILTER_PARAMETER_RANGES[key];
    const scale = key === 'compensation' || key === 'deadzone' ? 100 : 1;
    expect(slider.getAttribute('aria-valuemin')).toBe(String(min * scale));
    expect(slider.getAttribute('aria-valuemax')).toBe(String(max * scale));
    press(slider, 'End');
    expect(mixer.getFilterSettings()[key]).toBeCloseTo(max);
    press(slider, 'Home');
    expect(mixer.getFilterSettings()[key]).toBeCloseTo(min);
    press(slider, 'ArrowRight');
    expect(mixer.getFilterSettings()[key]).toBeCloseTo(min + step);
  }
  const resonance = host.querySelector<HTMLElement>('[role="slider"][aria-label="Resonance"]')!;
  drag(resonance, 0.5);
  expect(mixer.getFilterSettings().resonance).toBe(12);
  act(() => resonance.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(mixer.getFilterSettings().resonance).toBe(DEFAULT_FILTER_SETTINGS.resonance);

  act(() => mixer.setFilterSettings({ model: 'current' }));
  const unchanged = mixer.getFilterSettings();
  const disabled = [...host.querySelectorAll<HTMLElement>('.settings-fields [role="slider"][aria-disabled="true"]')];
  expect(disabled).toHaveLength(9);
  for (const slider of disabled) {
    expect(slider.tabIndex).toBe(-1);
    press(slider, 'End');
    drag(slider, 1);
    act(() => slider.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true })));
    act(() => slider.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  }
  expect(mixer.getFilterSettings()).toBe(unchanged);
  press(host.querySelector<HTMLElement>('[role="slider"][aria-label="Filter output trim"]')!, 'End');
  expect(mixer.getFilterSettings().trim).toBe(12);
  act(() => mixer.setFilterSettings({ model: 'res24' }));
  expect(host.querySelector('#filter-spread')?.getAttribute('aria-disabled')).toBe('true');
  expect(host.querySelector('#filter-resonance')?.getAttribute('aria-disabled')).not.toBe('true');
});

it('selects filter diagnostics without loading decks and follows automation with live write guards', async () => {
  const mixer = new Mixer();
  const setFilter = vi.spyOn(mixer, 'setFilter').mockImplementation(() => {});
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<MixerContext value={mixer}><SettingsPage /></MixerContext>));
  const select = host.querySelector<HTMLSelectElement>('[aria-label="Filter response deck"]')!;
  act(() => {
    select.value = 'C';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(setFilter).not.toHaveBeenCalled();
  const sweep = host.querySelector<HTMLElement>('[role="slider"][aria-label="Deck filter"]')!;
  drag(sweep, 0.3);
  expect(setFilter).toHaveBeenLastCalledWith('C', -0.4);
  press(sweep, 'ArrowRight');
  expect(setFilter).toHaveBeenLastCalledWith('C', 0.001);
  press(sweep, 'Home');
  expect(setFilter).toHaveBeenLastCalledWith('C', -1);
  press(sweep, 'End');
  expect(setFilter).toHaveBeenLastCalledWith('C', 1);
  const center = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Center')!;
  act(() => center.click());
  expect(setFilter).toHaveBeenLastCalledWith('C', 0);
  setFilter.mockClear();
  // Automation can engage between render and the next pointer event.
  mixer.engageAutomation();
  drag(sweep, 0.65);
  act(() => center.click());
  expect(setFilter).not.toHaveBeenCalled();
  mixer.setAutomation('C', { filter: 0.6, fader: 1, eq: { low: 0.5, mid: 0.5, high: 0.5 } });
  const frame = vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0];
  act(() => frame(0));
  expect(sweep.getAttribute('aria-valuenow')).toBe('0.6');
  expect(sweep.getAttribute('aria-disabled')).toBe('true');
  press(sweep, 'Home');
  drag(sweep, 0);
  expect(center.disabled).toBe(true);
  const target = describeSweepFilter(mixer.getFilterSettings(), 0.6, 48000);
  expect(host.querySelector('.settings-filter-sweep output')?.textContent).toBe(`HP ${Math.round(target.frequency)} Hz`);
  expect(host.querySelector<HTMLInputElement>('[aria-label="Resonance value"]')!.disabled).toBe(false);
  act(() => root!.render(null));
  expect(mixer.isAutomationEngaged()).toBe(true);
  expect(mixer.getAutomation('C')?.filter).toBe(0.6);
  expect(setFilter).not.toHaveBeenCalled();
});

it('shows waveform style controls without a player, track queries or deck provider', async () => {
  history.replaceState(null, '', '/?view=performance&settings=1&section=waveforms');
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<SettingsPage />));
  await act(async () => { await vi.dynamicImportSettled(); });
  expect(host.querySelector('.settings-content')?.getAttribute('aria-label')).toBe('Display');
  expect(host.querySelector('#settings-section-waveforms')).not.toBeNull();
  expect(host.querySelector('[aria-label="Waveform color style"]')).not.toBeNull();
  expect(host.textContent).toContain('The waveforms above are the live preview');
  expect(host.querySelector('canvas, input[type="search"]')).toBeNull();
  expect(host.textContent).not.toContain('Load on');
  expectFaders(host, 9);
});

it('edits all full/minimap waveform faders, keeps band colors and resets both slots', async () => {
  history.replaceState(null, '', '/?section=waveforms');
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<SettingsPage />));
  await act(async () => { await vi.dynamicImportSettled(); });
  const fields = [
    ['display gamma', 'displayGamma', 0.25, 2.5, 0.05],
    ['master', 'master', 0.2, 3, 0.02],
    ['low gain', 0, 0, 3, 0.05],
    ['mid gain', 1, 0, 3, 0.05],
    ['high gain', 2, 0, 3, 0.05],
    ['low/mid boundary (band)', 'b1', 1, 7, 1],
    ['mid/high boundary (band)', 'b2', 2, 8, 1],
    ['core whiteness', 'coreWhite', 0, 1, 0.02],
    ['core bloom', 'coreBloom', 0, 1, 0.02],
  ] as const;
  for (const slot of ['full', 'minimap'] as const) {
    act(() => [...host.querySelectorAll<HTMLLabelElement>('.tune-slot-row label')]
      .find((label) => label.textContent === slot)!.querySelector('input')!.click());
    const other = slot === 'full' ? 'minimap' : 'full';
    const untouched = getSlot(other);
    expectFaders(host, 9);
    for (const [label, key, min, max, step] of fields) {
      const slider = host.querySelector<HTMLElement>(`[role="slider"][aria-label="${label}"]`)!;
      const value = () => typeof key === 'number' ? getSlot(slot).params.gains[key] : getSlot(slot).params[key];
      press(slider, 'End');
      expect(value()).toBe(max);
      press(slider, 'Home');
      expect(value()).toBe(min);
      press(slider, 'ArrowRight');
      expect(value()).toBeCloseTo(min + step);
    }
    const gain = host.querySelector<HTMLElement>('[role="slider"][aria-label="low gain"]')!;
    expect(gain.parentElement!.style.getPropertyValue('--waveform-band')).toMatch(/^#[0-9a-f]{6}$/);
    drag(gain, 0.5);
    expect(getSlot(slot).params.gains[0]).toBe(1.5);
    expect(getSlot(other)).toBe(untouched);
  }
  act(() => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Reset waveform defaults')!.click());
  expect(getSlots()).toEqual(defaultSlots());
});

it('edits all hardware calibration faders without audio and preserves numeric entry and group reset', async () => {
  history.replaceState(null, '', '/?section=jog');
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<SettingsPage />));
  await act(async () => { await vi.dynamicImportSettled(); });
  expectFaders(host, 8);
  const fields = [
    ['bendPercentPerTick', 0.1, 10, 0.1],
    ['bendMaxPercent', 0.5, 50, 0.5],
    ['bendFilterWindow', 1, 40, 1],
    ['rimSeekSecondsPerTick', 0.00005, 0.01, 0.00005],
    ['touchSeekSecondsPerTick', 0.00005, 0.01, 0.00005],
    ['fastSeekSecondsPerTick', 0.00005, 0.1, 0.00005],
    ['fastSeekAccelTicksPerSecond', 10, 500, 5],
    ['fastSeekAccelMax', 1, 100, 1],
  ] as const;
  for (const [key, min, max, step] of fields) {
    const slider = host.querySelector<HTMLElement>(`[role="slider"]#jog-tune-${key}`)!;
    press(slider, 'End');
    expect(getJogCalibration('grv6')[key]).toBe(max);
    press(slider, 'Home');
    expect(getJogCalibration('grv6')[key]).toBe(min);
    press(slider, 'ArrowRight');
    expect(getJogCalibration('grv6')[key]).toBeCloseTo(min + step, 8);
  }
  const slider = host.querySelector<HTMLElement>('[role="slider"][aria-label="Playback bend gain"]')!;
  drag(slider, 0.6);
  expect(getJogCalibration('grv6').bendPercentPerTick).toBe(6);
  const input = host.querySelector<HTMLInputElement>('[aria-label="Playback bend gain value"]')!;
  act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '2.7');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(getJogCalibration('grv6').bendPercentPerTick).toBe(6);
  press(input, 'Enter');
  expect(getJogCalibration('grv6').bendPercentPerTick).toBe(2.7);
  expect(slider.querySelector('.perf-fader-handle')?.textContent).toBe('2.7');
  const reset = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Reset jog defaults')!;
  for (let i = 0; i < 2; i++) {
    const draft = host.querySelector<HTMLInputElement>('[aria-label="Playback bend gain value"]')!;
    act(() => {
      draft.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(draft, '9');
      draft.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => reset.click());
    expect(getJogCalibration('grv6')).toEqual(GRV6_JOG_CALIBRATION);
    expect(host.querySelector<HTMLInputElement>('[aria-label="Playback bend gain value"]')!.value).toBe('0.1');
  }
});

// ── #328 groups ───────────────────────────────────────────────────────────

it('groups sections, hides empty groups and maps old section deep links to their group', async () => {
  history.replaceState(null, '', '/?section=jog');
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<SettingsPage />));
  await act(async () => { await vi.dynamicImportSettled(); });
  const nav = [...host.querySelectorAll('.settings-nav button strong')].map((n) => n.textContent);
  expect(nav).toEqual(['Library', 'Performance', 'Display', 'Controllers', 'Keyboard + mouse', 'Accounts', 'Help']);
  expect(host.querySelector('.settings-content')?.getAttribute('aria-label')).toBe('Controllers');
  expect(host.querySelector('#settings-section-jog')).not.toBeNull();
  // Jog calibration is GRV6-only; the other known controllers say so.
  const rows = [...host.querySelectorAll('.settings-controller-row')].map((n) => n.textContent);
  expect(rows).toHaveLength(3);
  expect(rows[0]).toContain('DDJ-GRV6');
  expect(rows[1]).toContain('Fixed factory calibration');
  expect(rows[2]).toContain('No jog calibration needed');
  expect(host.textContent).toContain('Applies to the DDJ-GRV6 only');
});

it('opens a group by id and the Performance group stacks Filters and Beat FX', async () => {
  history.replaceState(null, '', '/?section=performance');
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<MixerContext value={new Mixer()}><SettingsPage /></MixerContext>));
  const blocks = [...host.querySelectorAll('.settings-subsection')].map((n) => n.id);
  expect(blocks).toEqual(['settings-section-filters', 'settings-section-effects']);
});
