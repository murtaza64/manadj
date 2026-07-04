# 07 — Audible-surface arbiter: one owner for the one-clock invariant

Status: ready-for-agent (grilled 2026-07-04 — ADR 0013 is the spec; route
decision made: hardware transport follows the audible surface)

## Parent

Architecture review 2026-07-04, candidate #1 (top recommendation).
Decisions: `docs/adr/0013-audible-surface-arbiter.md`. Glossary: Audible
surface (CONTEXT.md). Fixes issue 06; blocks slices 02–05 from multiplying
view-blind dispatch paths.

## What to build

`frontend/src/playback/audibleSurface.ts` — a module-level single-holder
state machine (readable outside React):

- `register(id, { transport, silence, wake })` / `unregister(id)`;
  `claim(id)` silences the displaced holder, wakes the claimant;
  `release(id)` restores the `'shared'` default. Wake never auto-plays.
  Idempotent re-claim; claim-over-claim last-wins + warn; release by a
  non-holder warns and ignores. `isAudible(id)`, `audible()` (the
  current transport handle), `subscribe(fn)`.
- `'shared'` registered at app level (DeckProvider): transport = deck
  registry `togglePlay`/`cueDown`/`cueUp` (today's dispatch guards);
  silence = pause A+B + shared `mixer.suspend()`; wake = `mixer.resume()`.
- Transition editor: replace the suspend/pause mount effect with
  `register('editor', …) + claim('editor')` / cleanup `release` +
  `unregister`. Editor transport: `togglePlay` → `player.togglePlay()`
  (both decks map to the one mix transport — keyboard parity with Space);
  no cue handlers (hardware CUE drops in the editor, like keyboard F).
- MIDI dispatch (`midi/dispatch.ts`): `transport`/`cue` actions route via
  `audible()` instead of touching decks directly. Non-transport deck
  actions (future slices: pads/jog/mixer/pitch) keep going to the shared
  decks.
- Tripwire: `DeckAudioPort` gains optional `mayStart(): boolean`; each
  Mixer's ports answer from the arbiter for their surface;
  `DeckEngine.play()` no-ops + `console.warn` when `mayStart()` is false.

## Acceptance criteria

- [ ] Arbiter state machine under vitest (claim/release/displace/idempotent/
      non-holder release/subscribe), no Web Audio in tests
- [ ] Hardware/simulated PLAY while the editor is open toggles the
      editor's MixPlayer and cannot resume the shared context (midi/06's
      repro); CUE in the editor is dropped
- [ ] PLAY/CUE in library and performance views behave exactly as today
- [ ] Editor mount/unmount still silences/restores the shared surface
      (by eye: enter editor mid-playback → silence; leave → deck play
      resumes on gesture, not automatically)
- [ ] `DeckEngine.play()` with a false `mayStart()` is a warned no-op
      (unit test at the port seam)
- [ ] midi/06 closed by this issue; dispatch tests updated
- [ ] tsc, eslint on touched files, vitest green

## Blocked by

None. Coordinate with MIDI slices 02–05 (this lands first).
