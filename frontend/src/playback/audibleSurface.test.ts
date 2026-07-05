/**
 * Audible-surface arbiter (midi-controller 07 / ADR 0013): the single-
 * holder state machine, tested without any Web Audio — these tests ARE the
 * invariant's spec.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetAudibleSurfacesForTests,
  audibleTransport,
  claimAudible,
  isAudible,
  registerSurface,
  releaseAudible,
  subscribeAudible,
  unregisterSurface,
} from './audibleSurface';
import type { AudibleSurface } from './audibleSurface';

function fakeSurface(): AudibleSurface & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    transport: { togglePlay: () => calls.push('togglePlay') },
    silence: () => calls.push('silence'),
  };
}

let shared: ReturnType<typeof fakeSurface>;
let editor: ReturnType<typeof fakeSurface>;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  shared = fakeSurface();
  editor = fakeSurface();
  registerSurface('shared', shared);
  registerSurface('editor', editor);
});

afterEach(() => {
  _resetAudibleSurfacesForTests();
  vi.restoreAllMocks();
});

describe('defaults', () => {
  it("'shared' is audible without anyone claiming", () => {
    expect(isAudible('shared')).toBe(true);
    expect(isAudible('editor')).toBe(false);
    expect(audibleTransport()).toBe(shared.transport);
  });

  it('registering is not claiming', () => {
    expect(shared.calls).toEqual([]);
    expect(editor.calls).toEqual([]);
  });
});

describe('claim / release', () => {
  it('claim silences (pauses) the displaced holder — nothing else (ADR 0022)', () => {
    claimAudible('editor');
    expect(shared.calls).toEqual(['silence']);
    expect(editor.calls).toEqual([]);
    expect(isAudible('editor')).toBe(true);
    expect(audibleTransport()).toBe(editor.transport);
  });

  it('release silences the releaser and restores the default', () => {
    claimAudible('editor');
    releaseAudible('editor');
    expect(editor.calls).toEqual(['silence']);
    expect(shared.calls).toEqual(['silence']);
    expect(isAudible('shared')).toBe(true);
  });

  it('re-claim by the holder is a no-op', () => {
    claimAudible('editor');
    claimAudible('editor');
    expect(editor.calls).toEqual([]);
    expect(shared.calls).toEqual(['silence']);
  });

  it('claim by an unregistered surface is a warned no-op', () => {
    unregisterSurface('editor');
    claimAudible('editor');
    expect(isAudible('shared')).toBe(true);
    expect(console.warn).toHaveBeenCalled();
  });

  it('release by a non-holder is a warned no-op', () => {
    releaseAudible('editor'); // shared holds
    expect(isAudible('shared')).toBe(true);
    expect(shared.calls).toEqual([]);
    expect(console.warn).toHaveBeenCalled();
  });

  it("the default 'shared' never releases", () => {
    releaseAudible('shared');
    expect(isAudible('shared')).toBe(true);
  });

  it('unregistering the holder releases first', () => {
    claimAudible('editor');
    unregisterSurface('editor');
    expect(isAudible('shared')).toBe(true);
    expect(shared.calls).toEqual(['silence']);
  });
});

describe('subscription', () => {
  it('notifies on audibility changes only', () => {
    const seen: string[] = [];
    const unsub = subscribeAudible((id) => seen.push(id));
    claimAudible('editor');
    claimAudible('editor'); // idempotent — no event
    releaseAudible('editor');
    unsub();
    claimAudible('editor');
    expect(seen).toEqual(['editor', 'shared']);
  });
});
