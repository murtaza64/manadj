/**
 * Cameo planning (#140) — the planner seam's ornament rules: guest deck
 * borrowing (first free A→B→C→D), parity indifference (ornaments never
 * advance the spine), the adjacency-wins Grace fade, host-window
 * mapping (mix time ≡ the host's elapsed play), deck exhaustion, and
 * planStateAt's guest deck states/lanes.
 */
import { describe, expect, it } from 'vitest';
import { CAMEO_LOAD_LEAD_SEC, planSet, planStateAt, type PlanInput } from './planner';
import type { CameoPlanSource } from './cameoPlan';
import { cameoSourceFromData, cameoSourceFromTake } from './cameoPlan';
import type { Transition } from '../editor/mixModel';

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    entries: [],
    tracks: {},
    transitionsByUuid: {},
    takesByUuid: {},
    ...over,
  };
}

const facts = (durationSec: number, hotCue1Sec: number | null = null, bpm: number | null = 120) => ({
  durationSec,
  bpm,
  hotCue1Sec,
});

const tr = (over: Partial<Transition> = {}): Transition => ({
  startSec: 160,
  durationSec: 20,
  bInSec: 8,
  tempoMatch: false,
  lanes: {},
  ...over,
});

const source = (over: Partial<CameoPlanSource> = {}): CameoPlanSource => ({
  guestTrackId: 9,
  entryHostSec: 60,
  exitHostSec: 90,
  guestStartSec: 30,
  pitchPercent: 0,
  fadeInSec: 0.5,
  fadeOutSec: 1,
  ...over,
});

/** Two-track set (A hosts at entry 0), one cameo pin on the first entry. */
function cameoInput(src: CameoPlanSource, pinUuid = 'c1'): PlanInput {
  return input({
    entries: [
      { trackId: 1, pin: { kind: 'transition', uuid: 't1' }, cameoPins: [{ kind: 'cameo', uuid: pinUuid }] },
      { trackId: 2, pin: null },
    ],
    tracks: { 1: facts(200), 2: facts(200), 9: facts(300) },
    transitionsByUuid: { t1: tr() },
    cameoSourcesByUuid: { [pinUuid]: src },
  });
}

describe('cameo planning (#140)', () => {
  it('maps the two-edged window onto the mix axis via the host anchor', () => {
    const plan = planSet(cameoInput(source()));
    expect(plan.cameos).toHaveLength(1);
    const c = plan.cameos[0];
    // Host solo rate 1, mixOffset 0: host track time IS mix time.
    expect(c.mixStartSec).toBeCloseTo(60);
    expect(c.mixEndSec).toBeCloseTo(90);
    expect(c.guestTrackId).toBe(9);
    expect(c.guestStartSec).toBe(30);
    expect(c.graceFaded).toBe(false);
  });

  it('borrows the first FREE deck (host on A, incoming parked on B → C)', () => {
    // The incoming entry occupies deck B from within the load headroom of
    // the guest window's tail? No — B's audible span starts at the window
    // (160). The guest window 60..90 + lead 5 does not overlap B's
    // entry-load span (155..200), so B is free and is borrowed.
    const plan = planSet(cameoInput(source()));
    expect(plan.cameos[0].deck).toBe('B');
  });

  it('skips to C when the guest window runs into the incoming deck load', () => {
    // Window 130..158: B's load lead (window start 160 − 5) overlaps.
    const plan = planSet(cameoInput(source({ entryHostSec: 130, exitHostSec: 158 })));
    expect(plan.cameos[0].deck).toBe('C');
  });

  it('never advances the spine: parity and adjacency count are cameo-blind', () => {
    const plan = planSet(cameoInput(source()));
    expect(plan.entries.map((e) => e.deck)).toEqual(['A', 'B']);
    expect(plan.adjacencies).toHaveLength(1);
    expect(plan.entries).toHaveLength(2);
  });

  it('Grace rule: a guest colliding with the next window fades out early — the adjacency wins', () => {
    // Authored exit 175 sits inside the host's outgoing window (160..180):
    // clamp to the window start.
    const plan = planSet(cameoInput(source({ entryHostSec: 140, exitHostSec: 175 })));
    const c = plan.cameos[0];
    expect(c.graceFaded).toBe(true);
    expect(c.mixEndSec).toBeCloseTo(160);
    expect(c.authoredMixEndSec).toBeCloseTo(175);
    expect(plan.warnings.some((w) => w.kind === 'cameo-grace-fade')).toBe(true);
  });

  it('a window entirely past the handover is skipped (plays nothing)', () => {
    const plan = planSet(cameoInput(source({ entryHostSec: 165, exitHostSec: 190 })));
    expect(plan.cameos).toHaveLength(0);
    expect(plan.warnings.some((w) => w.kind === 'cameo-grace-fade')).toBe(true);
  });

  it('deck exhaustion skips the ornament with a warning', () => {
    // Four concurrent guest windows over one host: A hosts, B/C/D absorb
    // three; the fourth finds nothing (connective tissue outranks
    // ornament — here, ornaments outrank later ornaments).
    const src = source();
    const plan = planSet(
      input({
        entries: [
          {
            trackId: 1,
            pin: null,
            cameoPins: [
              { kind: 'cameo', uuid: 'c1' },
              { kind: 'cameo', uuid: 'c2' },
              { kind: 'cameo', uuid: 'c3' },
              { kind: 'cameo', uuid: 'c4' },
            ],
          },
        ],
        tracks: { 1: facts(200), 9: facts(300) },
        cameoSourcesByUuid: { c1: src, c2: src, c3: src, c4: src },
      })
    );
    expect(plan.cameos.map((c) => c.deck)).toEqual(['B', 'C', 'D']);
    expect(plan.warnings.some((w) => w.kind === 'cameo-deck-overflow')).toBe(true);
  });

  it('a dangling pin (no source) plays nothing, silently', () => {
    const plan = planSet(cameoInput(source(), 'c1'));
    const dangling = planSet({
      ...cameoInput(source(), 'c1'),
      cameoSourcesByUuid: {},
    });
    expect(plan.cameos).toHaveLength(1);
    expect(dangling.cameos).toHaveLength(0);
  });

  it('planStateAt: the guest deck parks through the load lead, plays inside the window', () => {
    const plan = planSet(cameoInput(source()));
    const deck = plan.cameos[0].deck;

    // Inside the load lead: parked at the guest start, loaded, silent.
    const lead = planStateAt(plan, 60 - CAMEO_LOAD_LEAD_SEC + 1);
    expect(lead.decks[deck].trackId).toBe(9);
    expect(lead.decks[deck].playing).toBe(false);
    expect(lead.decks[deck].trackTime).toBeCloseTo(30);
    expect(lead.lanes[deck].fader).toBe(0);

    // Mid-window: playing, advanced, full fader.
    const mid = planStateAt(plan, 75);
    expect(mid.decks[deck].playing).toBe(true);
    expect(mid.decks[deck].trackTime).toBeCloseTo(45);
    expect(mid.lanes[deck].fader).toBe(1);

    // Fade edges: ramping in at entry, silent at the exit instant.
    expect(planStateAt(plan, 60.25).lanes[deck].fader).toBeCloseTo(0.5);
    expect(planStateAt(plan, 89.9).lanes[deck].fader).toBeCloseTo(0.1, 5);

    // Past the exit: the deck reverts to the spine's occupancy.
    const after = planStateAt(plan, 95);
    expect(after.decks[deck].trackId).not.toBe(9);
  });

  it('a host inside a Routine span refuses the ornament with a warning', () => {
    const plan = planSet(
      input({
        entries: [
          { trackId: 1, pin: null },
          { trackId: 2, pin: null, cameoPins: [{ kind: 'cameo', uuid: 'c1' }] },
          { trackId: 3, pin: null },
          { trackId: 4, pin: null },
        ],
        tracks: { 1: facts(200), 2: facts(200), 3: facts(200), 4: facts(200), 9: facts(300) },
        cameoSourcesByUuid: { c1: source() },
        routines: [
          {
            startEntryIndex: 1,
            routine: {
              cast: [2, 3, 4],
              entryOffsetsBeats: [0, 16, 32],
              entryPositions: [60, 0, 0],
              durationBeats: 128,
              events: [],
            },
          },
        ],
      })
    );
    expect(plan.cameos).toHaveLength(0);
    expect(
      plan.warnings.some((w) => w.kind === 'cameo-invalid' && /Routine span/.test(w.message))
    ).toBe(true);
  });
});

describe('cameo sources (cameoPlan.ts)', () => {
  it('parses a saved payload and rejects garbage', () => {
    expect(
      cameoSourceFromData(9, { entryHostSec: 10, exitHostSec: 40, guestStartSec: 5 })
    ).toMatchObject({ guestTrackId: 9, entryHostSec: 10, exitHostSec: 40, guestStartSec: 5 });
    expect(cameoSourceFromData(9, { entryHostSec: 40, exitHostSec: 10 })).toBeNull();
    expect(cameoSourceFromData(9, {})).toBeNull();
  });

  it('reduces a Cameo Take slice: host anchor from role-A playhead, elapsed window', () => {
    const src = cameoSourceFromTake({
      guestTrackId: 9,
      windowStartS: 100,
      windowEndS: 130,
      events: [
        { t: 99, kind: 'tick', playheads: { A: 61.5, B: 29 } },
        { t: 101, kind: 'tick', playheads: { A: 63.5, B: 31 } },
      ],
    });
    expect(src).not.toBeNull();
    // Nearest sample at/before 100 is t=99 (A 61.5), advanced 1s → 62.5.
    expect(src!.entryHostSec).toBeCloseTo(62.5);
    expect(src!.exitHostSec).toBeCloseTo(92.5); // + elapsed 30
    expect(src!.guestStartSec).toBeCloseTo(30);
  });

  it('returns null when the slice never saw a playhead', () => {
    expect(
      cameoSourceFromTake({ guestTrackId: 9, windowStartS: 0, windowEndS: 10, events: [] })
    ).toBeNull();
  });
});
