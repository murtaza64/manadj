// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const routing = vi.hoisted(() => ({
  snapshot: {
    prefs: { master: null, cue: null },
    resolved: {
      masterSinkId: null, masterPair: null, masterMissing: false, masterNeedsPair: false,
      cueSinkId: null, cuePair: null, cueMissing: false, cueNeedsPair: false,
    },
    devices: [{ deviceId: 'inp', label: 'DJControl Inpulse 300 MK2', maxChannelCount: 4 }],
  },
  setMasterDevice: vi.fn(),
  setCueDevice: vi.fn(),
}));
vi.mock('../../playback/routingStore', () => ({
  getRoutingSnapshot: () => routing.snapshot,
  subscribeRouting: () => () => undefined,
  refreshRouting: vi.fn(async () => undefined),
  setMasterDevice: routing.setMasterDevice,
  setCueDevice: routing.setCueDevice,
}));
const tone = vi.hoisted(() => ({ playTestTone: vi.fn(async () => undefined) }));
vi.mock('./testTone', () => tone);

import ControllerCheckGuide from './ControllerCheckGuide';

class FakeInput extends EventTarget {
  state = 'connected';
  id: string;
  name: string;
  constructor(id: string, name: string) {
    super();
    this.id = id;
    this.name = name;
  }
  send(bytes: number[]) {
    const e = new Event('midimessage') as Event & { data: Uint8Array };
    e.data = new Uint8Array(bytes);
    this.dispatchEvent(e);
  }
}

let root: Root;
let host: HTMLDivElement;
let inputs: Map<string, FakeInput>;

beforeEach(() => {
  inputs = new Map();
  const access = Object.assign(new EventTarget(), { inputs });
  Object.defineProperty(navigator, 'requestMIDIAccess', {
    configurable: true,
    value: vi.fn(async () => access),
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

async function mount(props = { onDone: vi.fn(), onSkip: vi.fn() }) {
  await act(async () => root.render(<ControllerCheckGuide {...props} />));
  return props;
}

const text = () => host.textContent ?? '';

it('mounts standalone; Skip and Done call back', async () => {
  const props = await mount();
  const [skip, done] = [...host.querySelectorAll('.cc-actions button')] as HTMLButtonElement[];
  act(() => skip.click());
  act(() => done.click());
  expect(props.onSkip).toHaveBeenCalledOnce();
  expect(props.onDone).toHaveBeenCalledOnce();
});

it('offers output pairs, tests the master tone, and gates cue tone on a cue output', async () => {
  await mount();
  const master = host.querySelector<HTMLSelectElement>('[aria-label="Master output"]')!;
  expect([...master.options].map((o) => o.text)).toContain('DJControl Inpulse 300 MK2 (outs 3/4)');
  const cueButton = host.querySelector<HTMLButtonElement>('[data-testid="cc-output-cue"] button')!;
  expect(cueButton.disabled).toBe(true);
  expect(text()).toContain('Pick a Cue output');
  const masterButton = host.querySelector<HTMLButtonElement>('[data-testid="cc-output-master"] button')!;
  await act(async () => masterButton.click());
  expect(tone.playTestTone).toHaveBeenCalledWith(null, null, 440);
  expect(text()).toContain('Heard it?');
  act(() => {
    master.value = '1';
    master.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(routing.setMasterDevice).toHaveBeenCalledWith(
    expect.objectContaining({ deviceId: 'inp', pair: { left: 2, right: 3 } })
  );
});

it('says when no MIDI device is plugged in', async () => {
  await mount();
  expect(text()).toContain('No MIDI devices detected');
});

it('flags unsupported devices', async () => {
  inputs.set('x', new FakeInput('x', 'Launchpad X'));
  await mount();
  expect(text()).toContain('No Mapping');
  expect(text()).toContain("controls won't do anything");
});

it('highlights presses on a mapped device and offers GRV6 jog calibration', async () => {
  const grv6 = new FakeInput('g', 'AlphaTheta DDJ-GRV6');
  inputs.set('g', grv6);
  await mount();
  expect(text()).toContain('Mapping: AlphaTheta DDJ-GRV6');
  expect(text()).toContain('Press any button');
  expect(text()).toContain('Calibrate jog wheels');
  const { DDJ_GRV6 } = await import('../../midi/mappings/ddjGrv6');
  const play = DDJ_GRV6.bindings.find(
    (b) => b.controlType === 'button' && b.target.control === 'transport'
  )!;
  act(() => grv6.send([0x90 | play.match.channel, play.match.number, 0x7f]));
  const press = host.querySelector('.cc-press')!;
  expect(press.className).toContain('cc-press-hit');
  expect(press.textContent).toMatch(/^Deck [A-D] · transport$/);
  expect(text()).toMatch(/1 of \d+ mapped controls checked/);
  // The release does not overwrite the press.
  act(() => grv6.send([0x80 | play.match.channel, play.match.number, 0]));
  expect(press.textContent).toMatch(/transport/);
  act(() => grv6.send([0x9f, 0x7f, 0x7f]));
  expect(host.querySelector('.cc-press')!.className).toContain('cc-press-miss');
});
