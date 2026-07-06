# LOOP pad mode: size-ladder pads with engage/release/resize and lamps

Status: ready-for-human

## Parent

`.scratch/midi-performance-ops/PRD.md`

## What to build

Bind the Inpulse 300 MK2's LOOP pad mode to Active loop presets, end to end (vocabulary target → mapping bindings → loops gesture class → engine → lamp Feedback):

- Base page: pads 1–8 = 1, 2, 4, 8, 16, 32, 64, 128 beats. Shifted page: pads 1–4 = 1/2, 1/4, 1/8, 3/4; pads 5–8 unbound (silent, dark).
- Press semantics: no loop → engage at the playhead at that size (existing auto-loop path, Quantize-snapped) and set the Deck's pending loop size so the on-screen row agrees; same size active → release; different size active → resize in place.
- Routing: through the existing loops gesture class and the audible-surface arbiter, like the on-screen loop controls.
- Feedback: the pad whose value equals the active loop's length lights, per page; no loop or off-ladder length → all dark. Full-sync-on-connect covers the new lamps.
- Addresses per Mixxx's Inpulse 300 file (base notes 0x10–0x17, shifted 0x18–0x1F on the pad channels), carrying TODO(hardware-verify) comments until smoke-tested, matching the mapping file's discipline.

## Acceptance criteria

- [ ] Each mapped pad engages/releases/resizes per the semantics above, on both decks
- [ ] A pad press updates the pending loop size and the on-screen LOOP row reflects it
- [ ] Shifted page pads 5–8 and all other unbound messages stay silent
- [ ] Lamp state: lit iff active length equals that pad's value on its page; all dark otherwise
- [ ] Translator/mapping tests cover the new bindings; LED derivation tests cover the lamp rule
- [ ] Loop gestures from the Controller route via the audible surface (dropped where the surface doesn't register loops)

## Blocked by

- `01-dyadic-loop-domain.md` (64/128 and 3/4 must be legal; set-length resize)

## Comments

- 2026-07-06 (midiops lane, change `xvxqxxoz`): implemented end to end. New `loop-preset` vocabulary target (carries the pad's beats) → LOOP pad bindings ch 6/7 notes 0x10-0x17 base / 0x18-0x1B shifted, pads 5-8 shifted unbound (TODO(hardware-verify), per Mixxx) → loops gesture class (`SurfaceLoops.loopPreset`, dropped where unregistered) → `loop-preset` transport-reducer case (engage-at-playhead + pending update / same-size release / set-length resize) → lamps (`loopPads`/`loopPadsShifted` with per-pad `beats` in the mapping feedback; lit iff active length equals the pad's preset, else dark; bridge feeds `loop?.lengthBeats`; full-sync + all-off cover them). Verified: translator/mapping, dispatch, reducer, engine, LED derivation tests; full suite green.
- Verification walkthrough (lane app running): open http://localhost:5383 (or `npm --prefix /Users/murtaza/manadj/desktop start -- --port 5383`). 1) Load a gridded track onto deck A, play it. 2) On-screen LOOP row: press LOOP, then ×2 repeatedly — the loop now doubles past 32 up to 128 and stops (label shows 64, 128). 3) ½ down to 1/8 and no further; with the loop released, set pending to 3/4 via a MIDI LOOP pad (shifted pad 4) or check the row label after — 3/4 halves to 3/8, doubles to 3/2. 4) With the Inpulse attached: LOOP pad mode — pad presses engage/release/resize per the semantics, the matching pad lights per page, row and hardware agree. No device present: the translator/LED tests stand in for hardware; addresses remain TODO(hardware-verify).
