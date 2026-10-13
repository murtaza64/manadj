import './keyboardPointer.css';
import { knobAppearance, type KnobControl } from './knobAppearance';
import { getSlot } from '../../waveform/styleSlots';

export type KeyboardPointerFeedback = {
  id: string;
  label: string;
  value: number;
  detail: string;
  color: string;
} & ({ kind: 'knob'; control: KnobControl; ghost?: number | null } | { kind: 'fader' | 'jog' });

interface Owner {
  move: (dx: number, dy: number, elapsedMs: number) => void;
  cancel: () => void;
  feedback: () => KeyboardPointerFeedback[];
}

interface Client extends Owner {
  id: number;
  active: boolean;
}

interface Request {
  wanted: boolean;
  api: 'unknown' | 'promise' | 'void';
  errorEvent: boolean;
}

const unavailable = 'Pointer lock unavailable. Dismiss any browser permission prompts. Click the app, then release and press the control key to retry.';
let shared: ReturnType<typeof createPointer> | undefined;

function svgElement<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string>) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function createRow(kind: KeyboardPointerFeedback['kind']) {
  const node = document.createElement('div');
  node.className = 'keyboard-pointer-row';
  const knob = kind === 'knob' ? document.createElement('div') : null;
  const glyph = knob ?? svgElement('svg', { viewBox: '0 0 48 48', 'aria-hidden': 'true', class: `keyboard-pointer-${kind}` });
  const indicator = knob ? document.createElement('div') : kind === 'fader'
    ? svgElement('rect', { x: '12', y: '-3', width: '24', height: '6', rx: '2', class: 'keyboard-pointer-indicator' })
    : svgElement('line', { x1: '24', y1: '24', x2: '24', y2: '7', class: 'keyboard-pointer-indicator' });
  let fill: HTMLDivElement | undefined;
  let ghost: HTMLDivElement | undefined;
  if (knob) {
    knob.setAttribute('aria-hidden', 'true');
    const dial = document.createElement('div');
    dial.className = 'perf-knob-dial';
    const track = document.createElement('div');
    track.className = 'perf-knob-ring perf-knob-ring-track';
    fill = document.createElement('div');
    fill.className = 'perf-knob-ring perf-knob-ring-fill';
    const detent = document.createElement('div');
    detent.className = 'perf-knob-detent';
    ghost = document.createElement('div');
    ghost.className = 'perf-knob-pointer perf-knob-ghost';
    dial.append(track, fill, detent, ghost, indicator);
    knob.append(dial);
  } else if (kind === 'fader') {
    glyph.append(svgElement('rect', { x: '21', y: '6', width: '6', height: '36', rx: '3', class: 'keyboard-pointer-track' }));
  } else {
    glyph.append(svgElement('circle', { cx: '24', cy: '24', r: '21', class: 'keyboard-pointer-track' }));
    if (kind === 'jog') glyph.append(svgElement('circle', { cx: '24', cy: '24', r: '14', class: 'keyboard-pointer-groove' }));
  }
  if (!knob) glyph.append(indicator);
  const text = document.createElement('div');
  const label = document.createElement('strong');
  const detail = document.createElement('span');
  text.append(label, detail);
  node.append(glyph, text);
  return { node, indicator, label, detail, kind, knob, fill, ghost };
}

function createPointer() {
  const clients = new Set<Client>();
  const rows = new Map<string, ReturnType<typeof createRow>>();
  const target = document.createElement('div');
  target.className = 'keyboard-pointer-feedback';
  const controls = document.createElement('div');
  const status = document.createElement('div');
  status.className = 'keyboard-pointer-status';
  status.setAttribute('role', 'status');
  target.append(controls, status);
  let nextId = 0;
  let cursor: { x: number; y: number } | undefined;
  let pending: Request | undefined;
  let locked = false;
  let exiting = false;
  let frame = 0;
  let lastMove = 0;

  const active = () => [...clients].some(client => client.active);

  function cleanup() {
    if (pending || exiting || document.pointerLockElement === target) return;
    if (!active() && !status.textContent) target.remove();
    if (clients.size) return;
    target.remove();
    document.removeEventListener('mousemove', mousemove);
    document.removeEventListener('pointerlockchange', lockchange);
    document.removeEventListener('pointerlockerror', lockerror);
    document.removeEventListener('keydown', keydown, true);
    document.removeEventListener('visibilitychange', visibilitychange);
    window.removeEventListener('blur', cancel);
    shared = undefined;
  }

  function unlock() {
    locked = false;
    if (document.pointerLockElement === target && !exiting) {
      exiting = true;
      document.exitPointerLock();
    }
  }

  function stopGesture() {
    if (active()) return;
    if (pending) pending.wanted = false;
    cancelAnimationFrame(frame);
    frame = 0;
    controls.replaceChildren();
    rows.clear();
    status.textContent = '';
    unlock();
    cleanup();
  }

  function cancel() {
    const held = [...clients].filter(client => client.active);
    for (const client of held) client.active = false;
    stopGesture();
    for (const client of held) client.cancel();
  }

  function fail(message = unavailable) {
    cancel();
    if (clients.size) {
      document.body.append(target);
      status.textContent = message;
    }
  }

  function render() {
    const waveform = getSlot('full');
    const seen = new Set<string>();
    let index = 0;
    for (const client of clients) {
      if (!client.active) continue;
      for (const feedback of client.feedback()) {
        const key = `${client.id}:${feedback.id}`;
        seen.add(key);
        let row = rows.get(key);
        if (!row || row.kind !== feedback.kind) {
          row?.node.remove();
          row = createRow(feedback.kind);
          rows.set(key, row);
        }
        row.node.style.setProperty('--keyboard-pointer-color', feedback.color);
        row.label.textContent = feedback.label;
        row.detail.textContent = feedback.detail;
        const value = Number.isFinite(feedback.value) ? feedback.value : 0;
        const fraction = Math.max(0, Math.min(1, value));
        if (row.knob && feedback.kind === 'knob') {
          const appearance = knobAppearance(feedback.control, value, feedback.ghost ?? null, waveform);
          row.label.style.color = appearance.style['--knob-value-color'];
          row.knob.className = `keyboard-pointer-knob perf-knob perf-knob-colored${feedback.control === 'filter' ? ' perf-knob-filter' : ''}`;
          for (const [property, value] of Object.entries(appearance.style)) row.knob.style.setProperty(property, value);
          row.fill!.style.background = appearance.arcBackground;
          row.indicator.setAttribute('class', `perf-knob-pointer${appearance.ghostAngle !== null ? ' perf-base-dim' : ''}`);
          row.indicator.style.transform = `rotate(${appearance.angle}deg)`;
          row.ghost!.hidden = appearance.ghostAngle === null;
          row.ghost!.style.transform = `rotate(${appearance.ghostAngle ?? 0}deg)`;
        } else {
          row.indicator.setAttribute('transform', feedback.kind === 'fader'
            ? `translate(0 ${42 - fraction * 36})` : `rotate(${value} 24 24)`);
        }
        if (controls.children[index] !== row.node) controls.insertBefore(row.node, controls.children[index] ?? null);
        index++;
      }
    }
    for (const [key, row] of rows) {
      if (!seen.has(key)) {
        row.node.remove();
        rows.delete(key);
      }
    }
  }

  function animate() {
    frame = 0;
    if (!active()) return;
    render();
    frame = requestAnimationFrame(animate);
  }

  function relock(fromKeydown = false) {
    if (!active() || locked) return;
    // The observable state can settle before its queued pointerlockchange event.
    if (document.pointerLockElement !== target) exiting = false;
    if (pending || exiting) return;
    if (document.pointerLockElement || typeof target.requestPointerLock !== 'function'
      || typeof document.exitPointerLock !== 'function') {
      fail();
      return;
    }
    if (!fromKeydown && navigator.userActivation?.isActive === false) {
      fail('Pointer lock activation expired. Release and press the control key to retry.');
      return;
    }
    pending = { wanted: true, api: 'unknown', errorEvent: false };
    request(pending, true);
  }

  function lockchange() {
    if (document.pointerLockElement === target) {
      const token = pending;
      // Retire this request before unlock can synchronously trigger a fresh one.
      if (token?.api === 'void') pending = undefined;
      if (active() && !exiting && (token ? token.wanted : locked)) {
        if (!locked) lastMove = performance.now();
        locked = true;
      } else {
        unlock();
      }
    } else {
      const lost = locked;
      locked = false;
      exiting = false;
      if (lost) cancel();
    }
    relock();
    cleanup();
  }

  function lockerror() {
    if (pending) {
      // Promise rejection carries NotSupportedError; its event does not.
      if (pending.api !== 'void') {
        pending.errorEvent = true;
        if (!pending.wanted && active()) fail();
        return;
      }
      pending = undefined;
      if (active()) fail();
    } else if (active()) {
      fail();
    }
    cleanup();
  }

  function request(token: Request, raw: boolean) {
    function rejected(error: unknown) {
      if (pending !== token) return;
      if (raw && typeof error === 'object' && error !== null && 'name' in error && error.name === 'NotSupportedError'
        && token.wanted && active() && !document.pointerLockElement && !exiting) {
        request(token, false);
        return;
      }
      pending = undefined;
      if (token.wanted) fail(error instanceof Error || error instanceof DOMException
        ? `${unavailable} ${error.name}: ${error.message}` : unavailable);
      else unlock();
      relock();
      cleanup();
    }

    token.api = 'unknown';
    token.errorEvent = false;
    try {
      // Start synchronously unless an older request/exit still needs to settle.
      const result = (target.requestPointerLock as (options?: { unadjustedMovement: boolean }) => Promise<void> | void)
        .call(target, ...(raw ? [{ unadjustedMovement: true }] : []));
      if (result && typeof result.then === 'function') {
        token.api = 'promise';
        void result.then(() => {
          if (pending !== token) return;
          lockchange();
          pending = undefined;
          if (token.wanted && active() && document.pointerLockElement !== target) fail();
          relock();
          cleanup();
        }, rejected);
      } else {
        token.api = 'void';
        if (token.errorEvent) lockerror();
        else if (document.pointerLockElement === target) lockchange();
      }
    } catch (error) {
      rejected(error);
    }
  }

  function mousemove(event: MouseEvent) {
    if (!document.pointerLockElement) {
      if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) cursor = { x: event.clientX, y: event.clientY };
      return;
    }
    if (!locked || document.pointerLockElement !== target || !active()) return;
    const dx = event.movementX;
    const dy = event.movementY;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const now = performance.now();
    const elapsed = Math.max(1, Math.min(100, now - lastMove));
    lastMove = now;
    for (const client of clients) if (client.active) client.move(dx, dy, elapsed);
    render();
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') cancel();
  }

  function visibilitychange() {
    if (document.visibilityState === 'hidden') cancel();
  }

  document.addEventListener('mousemove', mousemove);
  document.addEventListener('pointerlockchange', lockchange);
  document.addEventListener('pointerlockerror', lockerror);
  document.addEventListener('keydown', keydown, true);
  document.addEventListener('visibilitychange', visibilitychange);
  window.addEventListener('blur', cancel);

  return {
    register(owner: Owner) {
      const client: Client = { ...owner, id: nextId++, active: false };
      clients.add(client);
      const stop = () => {
        if (!clients.has(client)) return;
        client.active = false;
        stopGesture();
        if (active()) render();
      };
      return {
        start() {
          if (!clients.has(client)) return;
          if (active()) {
            client.active = true;
            render();
            relock(true);
            return;
          }
          client.active = true;
          status.textContent = '';
          const { x, y } = cursor ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
          target.style.left = `${x}px`;
          target.style.top = `${y}px`;
          document.body.append(target);
          lastMove = performance.now();
          animate();
          relock(true);
        },
        stop,
        dispose() {
          if (!clients.has(client)) return;
          stop();
          clients.delete(client);
          cleanup();
        },
      };
    },
  };
}

export function registerKeyboardPointer(owner: {
  move: (dx: number, dy: number, elapsedMs: number) => void;
  cancel: () => void;
  feedback: () => KeyboardPointerFeedback[];
}): { start: () => void; stop: () => void; dispose: () => void } {
  shared ??= createPointer();
  return shared.register(owner);
}
