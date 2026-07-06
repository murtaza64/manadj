# Grid-edit pad mode on the SAMPLER pads (tap layer) with lamps

Status: ready-for-human
Review: parked on lane midigrid (grid track stack, review lands the prefix); walkthrough in .lanes/midigrid.md and the requesting session; lane app http://localhost:5423

## Parent

`.scratch/midi-performance-ops/PRD.md`

## What to build

Repurpose the SAMPLER pad mode as Beatgrid editing (the label lies deliberately: manadj will never have a sampler, and a mode never pressed mid-performance protects stored data). Registry-direct targets — grid edits mean the same thing on every view:

- Pad 1 grid-nudge left (tap = one −10ms step), pad 2 anchor (set-downbeat at the playhead), pad 3 silent, pad 4 grid-nudge right (+10ms), pad 5 shrink, pad 6 grow, pad 7 BPM halve, pad 8 BPM double. Top row mirrors the on-screen grid-edit triple, bottom row the BPM cluster.
- Grow/Shrink = the existing fine BPM micro-adjustment (glossary term added 2026-07-05: grow widens beat spacing/BPM down, shrink tightens/BPM up). Rename the BPM-nudge code vocabulary toward grow/shrink to end the nudge collision.
- Gridless Track: presses do nothing.
- Feedback: all mapped pads lit steadily iff the deck's Track has a Beatgrid; pad 3 and unbound pads dark always.
- Addresses per Mixxx (base notes 0x30–0x37 on the pad channels), TODO(hardware-verify) until smoke-tested.
- Hold semantics (spin-to-nudge) are issue 06; this issue ships taps only — pad-down/up with no chord machinery.

## Acceptance criteria

- [ ] Each mapped pad performs its op on the correct deck's loaded Track; edits persist (visible after reload)
- [ ] Anchor sets the downbeat at the playhead via the existing set-downbeat path
- [ ] Grow/shrink apply the existing micro-adjust step; halve/double the existing BPM grid ops
- [ ] Gridless Track: presses no-op, pads dark; gridded Track: mapped pads lit
- [ ] Grid targets act identically regardless of the audible surface (registry-direct)
- [ ] Translator/mapping tests cover the bindings; LED derivation tests cover the gridded/gridless rule

## Blocked by

- `04-nudge-offset-param.md` (taps call the offset-parameterized nudge)

## Comments

**2026-07-06 (lane midigrid)**: Implemented as two stacked changes — the grow/shrink rename (its own change: `nudgeBpm` → `growShrinkBpm` with a `'grow' | 'shrink'` vocabulary in bpmCommit.ts, `BpmCompressIcon`/`BpmSpreadIcon` → `BpmShrinkIcon`/`BpmGrowIcon`, BpmControl titles) and the pad mode. New button targets appended to actions.ts (`grid-nudge`/`grid-anchor`/`grid-bpm`), registry-direct dispatch cases, SAMPLER bindings 0x30–0x37 ch 6/7 in inpulse300mk2.ts (`gridEditPads` helper, TODO(hardware-verify), pad 3 unbound), `gridPads` lamp addresses + `DeckFeedback.gridPads` + `DeckLedInput.hasBeatgrid` + `DeckLedStates.gridPads` in the Feedback seam. Glue: new hooks/useGridEditActions.ts (same mutations/commit chain as the on-screen controls; nudge POSTs serialized; optimistic BPM base mirrors BpmControl; gridless → no-op; variable grid → grid ops yes, BPM ops no-op like the readout-only screen rule; halve/double use the screen's whole-BPM octave rounding), registered in MidiControlRegistrar; MidiFeedbackBridge feeds `hasBeatgrid` from the same beatgrid query the handlers read. Tests: real-mapping binding coverage in translator.test.ts, registry-direct routing in dispatch.test.ts, gridded/gridless lamp rule in feedback.test.ts. `npx vitest run` 1169 green, tsc clean.
