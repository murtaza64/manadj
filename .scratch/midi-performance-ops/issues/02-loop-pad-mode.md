# LOOP pad mode: size-ladder pads with engage/release/resize and lamps

Status: ready-for-agent

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
