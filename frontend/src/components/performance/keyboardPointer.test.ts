// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerKeyboardPointer, type KeyboardPointerFeedback } from './keyboardPointer';
import { knobAppearance } from './knobAppearance';
import { getSlot, resetSlots, setSlot } from '../../waveform/styleSlots';

vi.mock('../../settings/persistedSettings', () => ({ writeSetting: vi.fn(), removeSetting: vi.fn() }));

const request = vi.fn<(...args: unknown[]) => Promise<void> | void>();
const exit = vi.fn();
let lock: Element | null;
let now: number;
let frameId: number;
const frames = new Map<number, FrameRequestCallback>();
const registrations: ReturnType<typeof registerKeyboardPointer>[] = [];

function acquire(target = request.mock.contexts.at(-1) as Element) {
  lock = target;
  document.dispatchEvent(new Event('pointerlockchange'));
}

function mouse(x: number, y: number, dx = 0, dy = 0) {
  const event = new MouseEvent('mousemove', { clientX: x, clientY: y });
  Object.defineProperties(event, { movementX: { value: dx }, movementY: { value: dy } });
  document.dispatchEvent(event);
}

function client(feedback: KeyboardPointerFeedback[] = [
  { id: 'eq', kind: 'knob', control: 'eqHigh', label: 'A HIGH', value: 0.5, detail: '0 dB', color: '#00ffff' },
]) {
  const owner = { move: vi.fn(), cancel: vi.fn(), feedback: () => feedback };
  const registration = registerKeyboardPointer(owner);
  owner.cancel.mockImplementation(() => registration.stop());
  registrations.push(registration);
  return { ...registration, ...owner, values: feedback };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function tick() {
  const callbacks = [...frames.values()];
  frames.clear();
  for (const callback of callbacks) callback(now);
}

const overlay = () => document.querySelector<HTMLElement>('.keyboard-pointer-feedback');
const status = () => document.querySelector('[role="status"]')?.textContent;

beforeEach(() => {
  resetSlots();
  lock = null;
  now = 100;
  frameId = 0;
  frames.clear();
  request.mockReset();
  exit.mockReset();
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => lock });
  Object.defineProperty(document, 'exitPointerLock', { configurable: true, value: exit });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', { configurable: true, writable: true, value: request });
  request.mockImplementation(function (this: HTMLElement) { acquire(this); });
  exit.mockImplementation(() => { lock = null; document.dispatchEvent(new Event('pointerlockchange')); });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
});

afterEach(() => {
  for (const registration of registrations.splice(0)) registration.dispose();
  expect(overlay()).toBeNull();
  expect(frames.size).toBe(0);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('shared keyboard pointer lock', () => {
  it('requests synchronously once for two clients, retaining lock until the last release', () => {
    const a = client();
    const b = client();
    const keydown = () => {
      a.start();
      expect(request).toHaveBeenCalledTimes(1);
      b.start();
      a.start();
    };
    document.addEventListener('keydown', keydown, { once: true });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
    expect(request).toHaveBeenCalledExactlyOnceWith({ unadjustedMovement: true });
    expect(document.querySelectorAll('.keyboard-pointer-row')).toHaveLength(2);
    now += 16;
    mouse(0, 0, 2, -3);
    expect(a.move).toHaveBeenLastCalledWith(2, -3, 16);
    expect(b.move).toHaveBeenLastCalledWith(2, -3, 16);
    a.stop();
    expect(exit).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.keyboard-pointer-row')).toHaveLength(1);
    mouse(0, 0, 4, 5);
    expect(a.move).toHaveBeenCalledTimes(1);
    expect(b.move).toHaveBeenCalledTimes(2);
    b.stop();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(overlay()).toBeNull();
    expect(a.cancel).not.toHaveBeenCalled();
  });

  it('anchors at the last unlocked cursor, ignores locked absolute coordinates, and sanitizes deltas/time', () => {
    const a = client();
    mouse(130, 210);
    a.start();
    expect(overlay()?.style.left).toBe('130px');
    expect(overlay()?.style.top).toBe('210px');
    now += 1000;
    mouse(0, 0, -500, 700);
    expect(a.move).toHaveBeenLastCalledWith(-500, 700, 100);
    mouse(9999, 9999, 7, -9);
    expect(a.move).toHaveBeenLastCalledWith(7, -9, 1);
    mouse(9999, 9999, NaN, Infinity);
    expect(a.move).toHaveBeenCalledTimes(2);
    expect(overlay()?.style.left).toBe('130px');
    expect(overlay()?.style.top).toBe('210px');
    a.stop();
    a.start();
    expect(overlay()?.style.left).toBe('130px');
    now += 12;
    mouse(0, 0, 1, 2);
    expect(a.move).toHaveBeenLastCalledWith(1, 2, 12);
  });

  it('shares a pending request and still acquires if only one of two clients releases', async () => {
    const wait = deferred();
    request.mockReturnValue(wait.promise);
    const a = client();
    const b = client();
    mouse(120, 180);
    a.start();
    mouse(700, 600);
    b.start();
    a.stop();
    expect(request).toHaveBeenCalledTimes(1);
    expect(overlay()?.style.left).toBe('120px');
    acquire();
    wait.resolve();
    await wait.promise;
    mouse(0, 0, 1, 2);
    expect(a.move).not.toHaveBeenCalled();
    expect(b.move).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
  });

  it('uses the viewport center before any cursor observation', () => {
    client().start();
    expect(overlay()?.style.left).toBe(`${window.innerWidth / 2}px`);
    expect(overlay()?.style.top).toBe(`${window.innerHeight / 2}px`);
  });

  it('preserves the cursor anchor near viewport edges instead of shifting the control inward', () => {
    const a = client();
    mouse(window.innerWidth - 2, window.innerHeight - 2);
    a.start();
    expect(overlay()?.style.left).toBe(`${window.innerWidth - 2}px`);
    expect(overlay()?.style.top).toBe(`${window.innerHeight - 2}px`);
    a.stop();
    mouse(2, 2);
    a.start();
    expect(overlay()?.style.left).toBe('2px');
    expect(overlay()?.style.top).toBe('2px');
  });

  it.each(['Escape', 'loss', 'error', 'blur', 'hidden'])('cancels both clients on %s and allows fresh presses', (reason) => {
    const a = client();
    const b = client();
    a.start();
    b.start();
    if (reason === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    if (reason === 'loss') { lock = null; document.dispatchEvent(new Event('pointerlockchange')); }
    if (reason === 'error') document.dispatchEvent(new Event('pointerlockerror'));
    if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    if (reason === 'hidden') {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    }
    expect(a.cancel).toHaveBeenCalledTimes(1);
    expect(b.cancel).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.keyboard-pointer-row')).toHaveLength(0);
    mouse(20, 30, 9, 9);
    expect(a.move).not.toHaveBeenCalled();
    a.start();
    expect(request).toHaveBeenCalledTimes(2);
    now += 10;
    mouse(0, 0, 2, 3);
    expect(a.move).toHaveBeenLastCalledWith(2, 3, 10);
    expect(b.move).not.toHaveBeenCalled();
  });

  it.each(['stop', 'dispose', 'Escape'] as const)('unlocks late Promise acquisition after %s without stale rearming', async (action) => {
    const wait = deferred();
    request.mockReturnValue(wait.promise);
    const a = client();
    a.start();
    mouse(20, 30, 4, 5);
    expect(a.move).not.toHaveBeenCalled();
    const target = request.mock.contexts[0] as Element;
    if (action === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    else a[action]();
    expect(frames.size).toBe(0);
    acquire(target);
    expect(exit).toHaveBeenCalledTimes(1);
    wait.resolve();
    await wait.promise;
    expect(lock).toBeNull();
    expect(overlay()).toBeNull();
    mouse(0, 0, 9, 9);
    expect(a.move).not.toHaveBeenCalled();
    if (action !== 'dispose') {
      request.mockImplementation(function (this: HTMLElement) { acquire(this); });
      a.start();
      expect(request).toHaveBeenCalledTimes(2);
    }
  });

  it('retains void-API listeners through last dispose to unlock late acquisition', () => {
    request.mockReturnValue(undefined);
    const a = client();
    a.start();
    const target = request.mock.contexts[0] as Element;
    a.dispose();
    acquire(target);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(lock).toBeNull();
    expect(overlay()).toBeNull();
    const b = client();
    request.mockImplementation(function (this: HTMLElement) { acquire(this); });
    b.start();
    expect(request).toHaveBeenCalledTimes(2);
    mouse(0, 0, 1, 2);
    expect(b.move).toHaveBeenCalledTimes(1);
  });

  it.each(['stop', 'Escape'] as const)('unlocks late void-API acquisition after %s', (action) => {
    request.mockReturnValue(undefined);
    const a = client();
    a.start();
    if (action === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    else a.stop();
    acquire();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(lock).toBeNull();
    expect(overlay()).toBeNull();
    mouse(0, 0, 9, 9);
    expect(a.move).not.toHaveBeenCalled();
    request.mockImplementation(function (this: HTMLElement) { acquire(this); });
    a.start();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('keeps a surviving client active when another disposes and ignores stale handles', () => {
    const a = client();
    const b = client();
    a.start();
    b.start();
    a.dispose();
    a.dispose();
    a.start();
    expect(exit).not.toHaveBeenCalled();
    mouse(0, 0, 1, 2);
    expect(a.move).not.toHaveBeenCalled();
    expect(b.move).toHaveBeenCalledTimes(1);
    b.dispose();
    const c = client();
    a.dispose();
    const d = client();
    c.start();
    d.start();
    expect(request).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('.keyboard-pointer-row')).toHaveLength(2);
  });

  it('removes its event listeners after the final unregister', () => {
    const removeDocument = vi.spyOn(document, 'removeEventListener');
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const a = client();
    a.start();
    a.dispose();
    expect(removeDocument.mock.calls.map(([type]) => type)).toEqual([
      'mousemove', 'pointerlockchange', 'pointerlockerror', 'keydown', 'visibilitychange',
    ]);
    expect(removeWindow).toHaveBeenCalledWith('blur', expect.any(Function));
  });

  it('preserves a fresh press until a released pending request settles, without reusing it', async () => {
    const wait = deferred();
    request.mockReturnValueOnce(wait.promise);
    const a = client();
    a.start();
    a.stop();
    a.start();
    acquire();
    wait.resolve();
    await wait.promise;
    tick();
    expect(request).toHaveBeenCalledTimes(2);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(a.cancel).not.toHaveBeenCalled();
    expect(status()).toBe('');
    mouse(0, 0, 1, 2);
    expect(a.move).toHaveBeenCalledTimes(1);
  });

  it('preserves a key swap through asynchronous exit and requests as soon as it settles', () => {
    const a = client();
    const b = client();
    a.start();
    exit.mockImplementation(() => {});
    a.stop();
    b.start();
    expect(request).toHaveBeenCalledTimes(1);
    mouse(0, 0, 1, 2);
    lock = null;
    document.dispatchEvent(new Event('pointerlockchange'));
    exit.mockImplementation(() => { lock = null; document.dispatchEvent(new Event('pointerlockchange')); });
    expect(request).toHaveBeenCalledTimes(2);
    expect(b.cancel).not.toHaveBeenCalled();
    expect(a.move).not.toHaveBeenCalled();
    expect(b.move).not.toHaveBeenCalled();
    now += 12;
    mouse(0, 0, 1, 2);
    expect(b.move).toHaveBeenLastCalledWith(1, 2, 12);
  });

  it('relocks synchronously when the property is null before the queued unlock event arrives', () => {
    const a = client();
    a.start();
    exit.mockImplementation(() => { lock = null; });
    a.stop();
    expect(document.pointerLockElement).toBeNull();
    a.start();
    const synchronousRequests = request.mock.calls.length;
    // This old unlock notification now observes the newly acquired singleton target.
    document.dispatchEvent(new Event('pointerlockchange'));
    exit.mockImplementation(() => { lock = null; document.dispatchEvent(new Event('pointerlockchange')); });
    expect(synchronousRequests).toBe(2);
    expect(request).toHaveBeenCalledTimes(2);
    expect(a.cancel).not.toHaveBeenCalled();
    mouse(0, 0, 1, 2);
    expect(a.move).toHaveBeenCalledTimes(1);
  });

  it('finishes rapid Q-down/up/Q-down/up without phantom locks from queued exit events', () => {
    const a = client();
    exit.mockImplementation(() => { lock = null; });
    a.start();
    a.stop();
    a.start();
    a.stop();
    document.dispatchEvent(new Event('pointerlockchange'));
    document.dispatchEvent(new Event('pointerlockchange'));
    expect(request).toHaveBeenCalledTimes(2);
    expect(exit).toHaveBeenCalledTimes(2);
    expect(a.cancel).not.toHaveBeenCalled();
    expect(lock).toBeNull();
    expect(overlay()).toBeNull();
    expect(frames.size).toBe(0);
  });

  it.each(['void', 'promise'])('does not relock when both taps release before old %s acquisition', async (api) => {
    const wait = deferred();
    request.mockReturnValueOnce(api === 'promise' ? wait.promise : undefined);
    const a = client();
    a.start();
    a.stop();
    a.start();
    a.stop();
    acquire();
    wait.resolve();
    await wait.promise;
    expect(request).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(a.cancel).not.toHaveBeenCalled();
    expect(lock).toBeNull();
    expect(overlay()).toBeNull();
    expect(frames.size).toBe(0);
  });

  it('does not overwrite a fresh void request during reentrant old-request unlock', () => {
    request.mockReturnValue(undefined);
    const a = client();
    const b = client();
    a.start();
    a.stop();
    b.start();
    acquire();
    // The old acquisition synchronously exits and starts b's still-pending request.
    expect(request).toHaveBeenCalledTimes(2);
    expect(lock).toBeNull();
    document.dispatchEvent(new Event('pointerlockchange'));
    acquire();
    expect(b.cancel).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledTimes(1);
    mouse(0, 0, 3, 4);
    expect(a.move).not.toHaveBeenCalled();
    expect(b.move).toHaveBeenCalledTimes(1);
  });

  it('waits for an old Promise after observable exit, without losing a fresh key swap', async () => {
    const wait = deferred();
    request.mockReturnValueOnce(wait.promise);
    const a = client();
    const b = client();
    a.start();
    acquire();
    exit.mockImplementation(() => { lock = null; });
    a.stop();
    b.start();
    expect(request).toHaveBeenCalledTimes(1);
    wait.resolve();
    await wait.promise;
    document.dispatchEvent(new Event('pointerlockchange'));
    exit.mockImplementation(() => { lock = null; document.dispatchEvent(new Event('pointerlockchange')); });
    expect(request).toHaveBeenCalledTimes(2);
    expect(b.cancel).not.toHaveBeenCalled();
    mouse(0, 0, 3, 4);
    expect(a.move).not.toHaveBeenCalled();
    expect(b.move).toHaveBeenCalledTimes(1);
  });

  it.each(['Escape', 'error', 'blur', 'hidden'])('immediately cancels a queued key swap on %s', (reason) => {
    const a = client();
    const b = client();
    a.start();
    exit.mockImplementation(() => {});
    a.stop();
    b.start();
    if (reason === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    if (reason === 'error') document.dispatchEvent(new Event('pointerlockerror'));
    if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    if (reason === 'hidden') {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    }
    expect(b.cancel).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.keyboard-pointer-row')).toHaveLength(0);
    expect(frames.size).toBe(0);
    lock = null;
    document.dispatchEvent(new Event('pointerlockchange'));
    expect(request).toHaveBeenCalledTimes(1);
    expect(a.cancel).not.toHaveBeenCalled();
    mouse(0, 0, 3, 4);
    expect(b.move).not.toHaveBeenCalled();
  });

  it('immediately cancels queued clients on an old Promise error event, without waiting for rejection', async () => {
    const wait = deferred();
    request.mockReturnValueOnce(wait.promise);
    const a = client();
    a.start();
    a.stop();
    a.start();
    document.dispatchEvent(new Event('pointerlockerror'));
    const cancellations = a.cancel.mock.calls.length;
    wait.reject(new DOMException('Denied', 'NotAllowedError'));
    await Promise.resolve();
    expect(cancellations).toBe(1);
    expect(a.cancel).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(status()).toContain('Pointer lock unavailable');
  });

  it('preserves fresh clients after a released request rejects without an error event', async () => {
    const wait = deferred();
    request.mockReturnValueOnce(wait.promise);
    const a = client();
    a.start();
    a.stop();
    a.start();
    wait.reject(new DOMException('Released', 'AbortError'));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    expect(a.cancel).not.toHaveBeenCalled();
    mouse(0, 0, 3, 4);
    expect(a.move).toHaveBeenCalledTimes(1);
  });

  it('does not defer acquisition beyond the fresh keydown activation', () => {
    const activation = { isActive: true };
    vi.stubGlobal('navigator', { userActivation: activation });
    const a = client();
    a.start();
    exit.mockImplementation(() => {});
    a.stop();
    a.start();
    activation.isActive = false;
    lock = null;
    document.dispatchEvent(new Event('pointerlockchange'));
    expect(request).toHaveBeenCalledTimes(1);
    expect(a.cancel).toHaveBeenCalledTimes(1);
    expect(status()).toContain('activation expired');
    expect(frames.size).toBe(0);
    exit.mockImplementation(() => { lock = null; document.dispatchEvent(new Event('pointerlockchange')); });
    activation.isActive = true;
    a.start();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not resurrect disposed clients when their pending request is followed by a new registration', async () => {
    const wait = deferred();
    request.mockReturnValueOnce(wait.promise);
    const a = client();
    a.start();
    a.dispose();
    const b = client();
    b.start();
    acquire();
    wait.resolve();
    await wait.promise;
    expect(request).toHaveBeenCalledTimes(2);
    mouse(0, 0, 3, 4);
    expect(a.move).not.toHaveBeenCalled();
    expect(b.move).toHaveBeenCalledTimes(1);
    expect(b.cancel).not.toHaveBeenCalled();
  });

  it('handles denied Promise requests with a visible status, no fallback deltas, and a fresh retry', async () => {
    const wait = deferred();
    request.mockReturnValue(wait.promise);
    const a = client();
    a.start();
    document.dispatchEvent(new Event('pointerlockerror'));
    wait.reject(new DOMException('Denied', 'NotAllowedError'));
    await Promise.resolve();
    expect(a.cancel).toHaveBeenCalledTimes(1);
    expect(status()).toContain('Click the app');
    mouse(10, 20, 7, 8);
    expect(a.move).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    request.mockImplementation(function (this: HTMLElement) { acquire(this); });
    a.start();
    expect(status()).toBe('');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('silently handles rejection after disposal, without falling back', async () => {
    const wait = deferred();
    request.mockReturnValue(wait.promise);
    const a = client();
    a.start();
    a.dispose();
    wait.reject(new DOMException('Raw unavailable', 'NotSupportedError'));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    expect(a.cancel).not.toHaveBeenCalled();
    expect(overlay()).toBeNull();
  });

  it('handles legacy error events, including after disposal', () => {
    request.mockReturnValue(undefined);
    const a = client();
    a.start();
    document.dispatchEvent(new Event('pointerlockerror'));
    expect(a.cancel).toHaveBeenCalledTimes(1);
    expect(status()).toContain('Pointer lock unavailable');
    a.start();
    a.dispose();
    document.dispatchEvent(new Event('pointerlockerror'));
    expect(overlay()).toBeNull();
  });

  it('explains unsupported APIs without a finite-cursor fallback', () => {
    Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', { configurable: true, value: undefined });
    const a = client();
    a.start();
    expect(a.cancel).toHaveBeenCalledTimes(1);
    expect(status()).toContain('Pointer lock unavailable');
    mouse(1, 2, 3, 4);
    expect(a.move).not.toHaveBeenCalled();
  });

  it('does not steal or exit an external lock', () => {
    lock = document.body;
    const a = client();
    a.start();
    expect(request).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(a.cancel).toHaveBeenCalledTimes(1);
    expect(lock).toBe(document.body);
    mouse(0, 0, 3, 4);
    expect(a.move).not.toHaveBeenCalled();
  });

  it.each(['promise', 'throw'])('falls back from raw input once on NotSupportedError (%s)', async (api) => {
    const error = new DOMException('Raw unavailable', 'NotSupportedError');
    request.mockImplementationOnce(() => {
      if (api === 'throw') throw error;
      return Promise.reject(error);
    });
    const a = client();
    a.start();
    if (api === 'promise') document.dispatchEvent(new Event('pointerlockerror'));
    await Promise.resolve();
    expect(request.mock.calls).toEqual([[{ unadjustedMovement: true }], []]);
    expect(a.cancel).not.toHaveBeenCalled();
    mouse(0, 0, 3, 4);
    expect(a.move).toHaveBeenCalledTimes(1);
  });

  it('does not retry ordinary-lock failure', async () => {
    request.mockImplementation(() => Promise.reject(new DOMException('Unavailable', 'NotSupportedError')));
    const a = client();
    a.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    expect(a.cancel).toHaveBeenCalledTimes(1);
    expect(status()).toContain('Pointer lock unavailable');
  });

  it.each(['promise', 'throw'])('shows the browser rejection reason and permission-prompt guidance (%s)', async (api) => {
    const error = new DOMException('The browser failed to lock the pointer.', 'NotSupportedError');
    request.mockImplementation(() => {
      if (api === 'throw') throw error;
      return Promise.reject(error);
    });
    const a = client();
    a.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    expect(a.cancel).toHaveBeenCalledTimes(1);
    expect(status()).toContain('NotSupportedError: The browser failed to lock the pointer.');
    expect(status()).toContain('Dismiss any browser permission prompts');
    expect(status()).toContain('release and press the control key');
  });

  it('accepts Promise acquisition without relying on event ordering', async () => {
    request.mockImplementation(() => { lock = request.mock.contexts.at(-1) as Element; return Promise.resolve(); });
    const a = client();
    a.start();
    await Promise.resolve();
    mouse(0, 0, 1, 2);
    expect(a.move).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('pointerlockchange'));
    expect(a.cancel).not.toHaveBeenCalled();
  });
});

it('updates shared knobs, SVG glyphs and plain text on movement and animation frames', () => {
  const a = client([
    { id: 'eq', kind: 'knob', control: 'eqHigh', label: '<b>A HIGH</b>', detail: '0 dB', value: 0.5, color: '#00ffff' },
    { id: 'fader', kind: 'fader', label: 'A LEVEL', detail: '50%', value: 0.5, color: '#00ffff' },
    { id: 'jog', kind: 'jog', label: 'B JOG', detail: '+2%', value: 30, color: '#ff3300' },
  ]);
  mouse(100, 200);
  a.start();
  const knob = document.querySelector<HTMLElement>('.keyboard-pointer-knob .perf-knob-pointer:not(.perf-knob-ghost)');
  const fader = document.querySelector('.keyboard-pointer-fader .keyboard-pointer-indicator');
  const jog = document.querySelector('.keyboard-pointer-jog .keyboard-pointer-indicator');
  expect(knob?.style.transform).toBe('rotate(0deg)');
  expect(fader?.getAttribute('transform')).toBe('translate(0 24)');
  expect(jog?.getAttribute('transform')).toBe('rotate(30 24 24)');
  expect(overlay()?.querySelector('b')).toBeNull();
  expect(overlay()?.textContent).toContain('<b>A HIGH</b>');
  expect(overlay()?.querySelector('[aria-live]')).toBeNull();
  a.move.mockImplementation(() => { a.values[0].value = 1; a.values[1].value = 0; a.values[2].value = 75; });
  mouse(9999, 0, 1, 2);
  expect(knob?.style.transform).toBe('rotate(135deg)');
  expect(fader?.getAttribute('transform')).toBe('translate(0 42)');
  expect(jog?.getAttribute('transform')).toBe('rotate(75 24 24)');
  a.values[2].detail = '0%';
  a.values[2].value = 90;
  tick();
  expect(jog?.getAttribute('transform')).toBe('rotate(90 24 24)');
  expect(overlay()?.textContent).toContain('0%');
  expect(overlay()?.style.left).toBe('100px');
  expect(overlay()?.style.top).toBe('200px');
  a.values.splice(0, 2);
  a.start();
  expect(document.querySelectorAll('.keyboard-pointer-row')).toHaveLength(1);
  expect(request).toHaveBeenCalledTimes(1);
  a.stop();
  tick();
  expect(overlay()).toBeNull();
  expect(frames.size).toBe(0);
});

it('matches deck knob colors, boost glow, automation and the filter double ring', () => {
  const feedback: KeyboardPointerFeedback = {
    id: 'eq', kind: 'knob', control: 'eqLow', label: 'A LOW', value: 0.5, detail: '50%', color: '#00ffff',
  };
  const a = client([feedback]);
  a.start();
  const knob = document.querySelector<HTMLElement>('.keyboard-pointer-knob')!;
  const fill = knob.querySelector<HTMLElement>('.perf-knob-ring-fill')!;
  const ghost = knob.querySelector<HTMLElement>('.perf-knob-ghost')!;
  const check = () => {
    const appearance = knobAppearance(feedback.control, feedback.value, feedback.ghost ?? null, getSlot('full'));
    for (const [property, value] of Object.entries(appearance.style)) expect(knob.style.getPropertyValue(property)).toBe(value);
    expect(fill.style.background).toBe(appearance.arcBackground);
  };
  check();
  expect(ghost.hidden).toBe(true);
  feedback.ghost = 0.75;
  tick();
  check();
  expect(ghost.hidden).toBe(false);
  expect(ghost.style.transform).toBe('rotate(67.5deg)');
  expect(knob.querySelector<HTMLElement>('.perf-base-dim')!.style.transform).toBe('rotate(0deg)');
  feedback.control = 'filter';
  feedback.value = 0.25;
  feedback.ghost = null;
  tick();
  check();
  expect(knob.classList.contains('perf-knob-filter')).toBe(true);
  expect(knob.style.getPropertyValue('--knob-glow')).toBe('none');
  expect(ghost.hidden).toBe(true);
  expect(knob.querySelector('.perf-base-dim')).toBeNull();
});

it('recolors a stationary keyboard tooltip when waveform preferences change', () => {
  const a = client();
  a.start();
  const knob = document.querySelector<HTMLElement>('.keyboard-pointer-knob')!;
  const label = document.querySelector<HTMLElement>('.keyboard-pointer-row strong')!;
  expect(knob.style.getPropertyValue('--knob-color')).toBe('#3373ff');
  setSlot('full', { params: { colors: [[1, 0, 0], [0, 1, 0], [1, 0.5, 0]] } });
  tick();
  expect(knob.style.getPropertyValue('--knob-color')).toBe('#ff8000');
  expect(label.style.color).toBe('rgb(255, 128, 0)');
  expect(a.move).not.toHaveBeenCalled();
  resetSlots();
  tick();
  expect(knob.style.getPropertyValue('--knob-color')).toBe('#3373ff');
});
