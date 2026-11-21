// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { _resetTrailForTests, captureDiagnostics, recordTrail, trailEntries } from './diagnostics';

afterEach(() => _resetTrailForTests());

describe('recent trail', () => {
  it('records bounded, redacted entries with defensive copies', () => {
    recordTrail('view', 'library');
    recordTrail('play', 'deck A token=abc123');
    const entries = trailEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ event: 'view', detail: 'library' });
    expect(entries[1].detail).not.toContain('abc123');
    expect(typeof entries[0].at).toBe('string');
    entries[0].event = 'mutated';
    expect(trailEntries()[0].event).toBe('view');
  });

  it('keeps only the most recent 20 events', () => {
    for (let i = 0; i < 30; i++) recordTrail('tick', i);
    const entries = trailEntries();
    expect(entries).toHaveLength(20);
    expect(entries[0].detail).toBe('10');
    expect(entries.at(-1)!.detail).toBe('29');
  });

  it('joins the diagnostics snapshot as the trail field', () => {
    recordTrail('browse', 'playlist playlist 7');
    const { snapshot } = captureDiagnostics();
    expect(Array.isArray(snapshot.trail)).toBe(true);
    const trail = snapshot.trail as { event: string; detail: string }[];
    expect(trail[0]).toMatchObject({ event: 'browse', detail: 'playlist playlist 7' });
    expect(JSON.stringify(snapshot)).not.toContain('token=');
  });
});
