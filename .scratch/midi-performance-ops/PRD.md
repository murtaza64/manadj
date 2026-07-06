# PRD: MIDI mappings for looping, grid editing, quantize, key lock, and Follow

Status: ready-for-agent

## Problem Statement

As a DJ, the operations I've gained since the Controller Mapping shipped — Active loops, Beatgrid editing, the Quantize toggle, per-Deck Key Lock, and Follow mode — all live on screen and keyboard only. Mid-set my hands are on the Inpulse 300 MK2: cutting a loop, halving it into a build, correcting a drifting grid, or pulling up next-track candidates all force a reach for the mouse. The hardware has a LOOP pad mode, a SAMPLER pad mode, per-deck Q buttons, and an assistant button that currently do nothing.

## Solution

Extend the Inpulse 300 MK2 Mapping (and the closed action vocabulary behind it) to cover the new operations, honoring "a Controller adds no new capabilities":

- **LOOP pad mode**: two shift-separated pages of loop-size presets; a pad engages an Active loop of that size at the playhead, the lit pad releases it, another pad resizes in place. SHIFT+IN/OUT becomes loop halve/double while a loop runs (staying beatjump-size when idle); IN/OUT stay beatjump.
- **SAMPLER pad mode, repurposed as grid editing**: anchor, grid nudge taps, grow/shrink, BPM halve/double — plus hold-a-nudge-pad-and-spin for fine grid nudging by jog.
- **Q buttons**: toggle the app-wide Quantize; **SHIFT+Q**: per-Deck Key Lock.
- **Assistant button**: a macro over per-Deck Follow — all on (playing Decks, or both when nothing plays) or all off.
- **Feedback** for all of it on the device's lamps.

One small domain widening ships with it (already reflected in CONTEXT.md): Active loop lengths become dyadic beat counts within 1/8–128; preset ladders are entry points, not the domain.

## User Stories

1. As a DJ, I want pressing a LOOP-mode pad to engage an Active loop of that pad's size anchored at the playhead (Quantize-snapped), so that cutting a loop is one finger.
2. As a DJ, I want the base pad page to offer 1, 2, 4, 8, 16, 32, 64, and 128 beats, so that everything from a bar to a 32-bar phrase hold is direct-access.
3. As a DJ, I want the shifted pad page to offer 1/2, 1/4, 1/8, and 3/4 beats, so that stutter and dotted-feel loops are there when I want them.
4. As a DJ, I want pressing the pad matching the active loop's size to release the loop, so that engage/release is one location.
5. As a DJ, I want pressing a different size pad while looping to resize the loop in place (start edge fixed, phase-mod re-entry), so that the ladder is random-access resize like my old software.
6. As a DJ, I want a loop pad press to also set the Deck's pending loop size, so that the on-screen LOOP row and the hardware always agree.
7. As a DJ, I want 64- and 128-beat loops to actually be legal (today the cap is 32), so that phrase-length holds work.
8. As a DJ, I want halve/double from any length — including 3/4 — to just multiply and divide (3/4 → 3/8; 3/4 → 3/2), clamped to 1/8–128, so that resize is predictable from anywhere.
9. As a DJ, I want SHIFT+IN/OUT to halve/double the running loop while one is active, so that riding a loop down into a build is eyes-free.
10. As a DJ, I want SHIFT+IN/OUT to keep meaning beatjump-size halve/double when no loop is active, so that nothing I already use changes.
11. As a DJ, I want IN/OUT to stay beatjump back/forward, so that my jump muscle memory is untouched.
12. As a DJ, I want the LOOP-mode pad whose size matches the active loop to light (per page), and all pads dark when nothing loops or the length is off-ladder, so that the lamps never lie.
13. As a DJ, I want the SAMPLER pad mode to become grid editing — pad 1 grid-nudge left, pad 2 anchor, pad 4 grid-nudge right, pad 5 shrink, pad 6 grow, pad 7 BPM halve, pad 8 BPM double, pad 3 silent — so that grid repair happens on hardware while the track plays.
14. As a DJ, I want tapping a grid-nudge pad to translate the grid one fixed step (±10ms), so that coarse phase correction is a tap.
15. As a DJ, I want to hold a grid-nudge pad and spin the jog for fine grid nudging (~1ms per tick, spin direction gives the sign), so that I can walk the grid onto the transient by ear and eye.
16. As a DJ, I want spin-nudging to apply to the local grid immediately but persist as a single accumulated commit when I release the pad, so that I hear every tick live without hammering the backend.
17. As a DJ, I want a quick pad tap (no jog ticks received) to mean the discrete step, with no timers or thresholds, so that tap vs hold never misfires.
18. As a DJ, I want the jog to stop meaning Nudge/seek while a grid-nudge pad is held and revert the instant I release, so that chording can't bend a playing Deck's tempo.
19. As a DJ, I want the anchor pad to set the downbeat at the playhead (the existing set-downbeat op), so that anchoring is one press at the moment I hear beat one.
20. As a DJ, I want grow/shrink pads to make the fine BPM micro-adjustment (spacing wider/tighter), so that tempo drift is correctable without the mouse.
21. As a DJ, I want the mapped grid pads lit steadily while the Deck's Track has a Beatgrid and dark otherwise, so that the mode shows where it applies (gridless Tracks: pads dark, presses do nothing).
22. As a DJ, I want either deck's Q button to toggle the single app-wide Quantize, with both Q lamps mirroring the one state, so that snapping is togglable from wherever my hand is.
23. As a DJ, I want SHIFT+Q to toggle that Deck's Key Lock, so that time (Q) and pitch (SHIFT+Q) guards share one physical home.
24. As a DJ, I want the shifted-Q lamp to show Key Lock state while SHIFT is held, if the hardware supports addressing it, so that the toggle is verifiable without looking at the screen.
25. As a DJ, I want the assistant button to enable Follow on all playing Decks (both Decks when nothing plays) when no Deck follows, so that "help me find the next track" is one press.
26. As a DJ, I want the assistant button to turn all Follow off when any Deck follows, so that the same button dismisses the assistance.
27. As a DJ, I want the assistant lamp lit exactly when any Deck follows, so that the button shows its own state.
28. As a DJ, I want the existing per-Deck follow toggles, spread/revoke playback rules, and "known only" filter untouched, so that the button is a shortcut, not a new model.
29. As a DJ, I want loop gestures from the Controller to route through the audible-surface arbiter like the on-screen loop controls, so that the Transition editor can give them its own meaning or drop them.
30. As a DJ, I want grid edits, quantize, key lock, and the follow macro to act registry-direct regardless of the audible surface, so that stored-data edits and sticky toggles mean the same thing everywhere.
31. As a DJ, I want unmapped pads (shifted loop page 5–8, grid pad 3) to stay silent and dark, so that stray presses are harmless.
32. As the developer, I want the new controls as new members of the closed action vocabulary bound in the Inpulse mapping data file, so that the second device someday is still just data.
33. As the developer, I want the hold-and-spin chording isolated in one pure, tested reducer (actions in, grid-edit commands out), so that the only new stateful logic is regression-guarded without hardware.
34. As the developer, I want the backend grid-nudge endpoint to accept an explicit millisecond offset, so that taps (±10ms) and accumulated spin commits (±n ms) share one API.

## Implementation Decisions

- **Loop length domain** (glossary already updated): lengths are dyadic beat counts within 1/8–128; halve/double are pure ×2/÷2 with clamping; preset ladders (pads, on-screen row) are entry points over the domain, not the domain. The loop-math module's max constant rises 32 → 128; resize generalizes from halve/double to set-length (one code path serving pads and ×2/÷2).
- **Loop pad semantics**: no loop → engage at playhead with the pad's size (existing auto-loop path, Quantize-snapped) and set the pending size; same size → release; different size → resize in place (existing resize semantics: start edge fixed, phase-mod re-entry).
- **Hardware layout, LOOP mode**: pads emit notes 0x10–0x17 base / 0x18–0x1F shifted on the pad channels (per Mixxx's Inpulse 300 file; hardware-verify while learning). Shifted page pads 5–8 unbound.
- **SHIFT+IN/OUT overload**: state-disambiguated — loop active → loop resize halve/double; idle → beatjump-size, unchanged. This decides the MIDI half of the looping follow-up issue on overloading jump/loop controls (issue annotated); the on-screen overload remains open but must match these semantics if taken.
- **Grid editing on SAMPLER pads** (notes 0x30–0x37 base, per Mixxx; label lies deliberately — manadj will never have a sampler, and a mode never pressed mid-performance is protection for stored data): pad 1 nudge-left, 2 anchor (set-downbeat), 3 silent, 4 nudge-right, 5 shrink, 6 grow, 7 BPM halve, 8 BPM double — top row mirrors the on-screen grid-edit triple, bottom row the BPM cluster.
- **Grow/Shrink** (glossary term added): the fine re-tempo micro-adjustment (existing ±0.03 BPM affordance); grow widens beat spacing (BPM down), shrink tightens (BPM up). The code's BPM-nudge naming should migrate toward grow/shrink to end the nudge collision.
- **Spin-to-nudge chord**: holding either nudge pad arms grid-nudge on that deck; while armed, jog ticks (rim and touch streams both) mean fine grid nudge, ~1ms per tick, sign from spin direction; ticks apply optimistically to the local grid, and the accumulated net offset persists in one API call on pad release; tap = release with zero ticks received → one ±10ms step. No timers. While armed, jog ticks never reach their normal meanings; release restores plain jog.
- **Backend**: the grid-nudge endpoint takes an explicit offset in milliseconds instead of the fixed constant.
- **Quantize**: both Q buttons bind to one target toggling the app-wide state (no per-deck quantize — the hardware's placement is two handles on one switch). Both Q lamps mirror it.
- **Key Lock**: SHIFT+Q per deck (shifted controls emit on channel+3; learn and verify). Lamp: probe whether the shifted-Q address (channel+3, same note) drives the Q lamp under SHIFT — Mixxx drives no such output but does drive other shifted-layer lamps, so it's plausible; if real, it shows Key Lock while SHIFT is held; if not, screen-only.
- **Assistant = Follow macro**: one button over the untouched per-Deck model — no Deck follows → enable on all playing Decks, or both Decks if none plays (legal: paused Decks may follow while nothing plays); any Deck follows → all off. Asymmetric on purpose: adding a second following Deck is a screen action. The press satisfies "turning Follow on from nothing is the user's act". Lamp lit iff any Deck follows.
- **Routing (per the gesture-class ADR)**: loop pads and the SHIFT+IN/OUT resize travel the existing loops gesture class through the audible-surface arbiter; grid-edit, quantize, key-lock, and follow targets are registry-direct. The chord's jog interception is a deliberate carve-out from "jog routes to the audible surface" — documented as an amendment note on that ADR during implementation.
- **Feedback**: loop pad lit iff the active loop's length equals that pad's value on its page, else all dark (off-ladder lengths show nothing; the screen stays the truth). Grid pads lit steadily iff the deck's Track has a Beatgrid. Q lamps mirror Quantize; assistant mirrors "any Deck follows". Existing full-sync-on-connect behavior extends to the new lamps.
- **Hardware-learn list** (inspector page, TODO(hardware-verify) comments as the existing mapping does): LOOP and SAMPLER pad notes both pages, Q and SHIFT+Q messages, assistant button, shifted-Q lamp probe, loop/grid pad lamp addresses.

## Testing Decisions

- House style: vitest on pure modules; no Web MIDI/Web Audio mocking; assert observable outputs, never internal state. Hardware learning stays hands-on-device.
- **Translator/mapping** (existing seam): new bindings covered by the existing synthetic-messages-in/actions-out suite; new vocabulary members exercised there.
- **Loop math** (existing pure seam): set-length resize, dyadic clamping at 1/8 and 128, 3/4-ladder arithmetic, pending-size behavior.
- **One new seam — the grid-edit chord reducer**: action stream in (nudge-pad down/up, jog ticks) → commands out (arm, per-tick local nudge, tap step, commit with net offset, disarm). Covers tap-vs-hold (zero-ticks discriminator), sign from spin direction, suppression of normal jog meanings, mid-gesture deck isolation. Prior art: the transport reducer tests.
- **Follow macro** (existing seam beside the follow reducer): pure decision function — follow states + playing states in, per-deck toggles out.
- **LED derivation** (existing seam from the pad-LEDs feature): pure state-to-lamp derivations for loop pages, grid pads, Q, assistant.
- **Backend** (existing router tests): offset-parameterized nudge, including accumulated offsets.

## Out of Scope

- Manual loop in/out and slip-behind loop rolls (still deferred, per the Active loop glossary)
- Saved loops (planned concept, unchanged)
- The on-screen overload of the beatjump/loop rows (the looping follow-up issue stays open for the UI half)
- Per-deck Quantize (rejected: hardware-layout accident, not a workflow)
- Assistant adding a second following Deck when one already follows (screen action)
- A real slicer, sampler, or FX implementation for the remaining pad modes
- Soft takeover / pickup for absolute controls
- Any device other than the Inpulse 300 MK2

## Further Notes

- Design session 2026-07-05 (grilling + domain modeling): CONTEXT.md updated — Active loop entry rewritten for the dyadic domain; Grow/Shrink added. The looping follow-up issue on overloading jump/loop controls was annotated with the SHIFT+IN/OUT decision.
- Mixxx's Inpulse 300 mapping remains the pre-verification ground truth for message and lamp addresses; every address inferred from it carries TODO(hardware-verify) until smoke-tested, matching the existing mapping file's discipline.
- Deliverable staging note: tap-nudge pads work before the chord reducer lands; the spin-to-nudge gesture is separable.
