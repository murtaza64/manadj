# 07 — Audible-surface arbiter: one owner for the one-clock invariant

Status: ready-for-human (implemented, changes mwwqynuz + nvkwunvl — verify
by eye: enter the editor mid-playback → shared decks go silent; leave →
deck play resumes on gesture only. Hardware PLAY-in-editor routing waits
on the MIDI cable, but the dispatch path is under test.)

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

- [x] Arbiter state machine under vitest (10 tests: claim/release/displace/
      idempotent/non-holder release/unregister-holder/subscribe), no Web
      Audio in tests
- [x] Simulated PLAY while the editor is claimed routes to the editor
      transport (both decks → one mix toggle) and never reaches the shared
      decks; CUE in the editor is dropped (dispatch tests). Hardware rerun
      pending the cable (midi/01's session).
- [x] PLAY/CUE in library/performance route to the shared transport with
      the exact old guards (moved verbatim into the 'shared' handle)
- [ ] Editor mount/unmount silences/restores the shared surface — BY EYE
- [x] `DeckEngine.play()`/`togglePlay()`/`cueDown()` with a false
      `mayStart()` are warned no-ops (port-seam tests); portless behavior
      unchanged
- [x] midi/06 closes with this issue (status updated); dispatch tests added
- [x] tsc, eslint on touched files, vitest 197 green

## Blocked by

None. Coordinate with MIDI slices 02–05 (this lands first).
