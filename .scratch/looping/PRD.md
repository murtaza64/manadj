# PRD: Looping — Active loops and first-class Quantize

Status: ready-for-human (implemented, changes rtxmzxzs..wrmvrrkq, workspace looping — awaiting review; see Verification walkthrough below)

## Problem Statement

I can't loop. Holding an intro while I ride the fade in, extending an outro while I browse for the next track with Follow mode, rolling a build before a double drop — all of these are table-stakes DJ moves that manadj's Decks simply don't have. The controller's loop section does nothing, and there's no keyboard or on-screen equivalent. Meanwhile the grid-snapping that would make loops musical exists only as an ad-hoc fragment: hot-cue placement snaps unconditionally in the backend, performance gestures don't snap at all, and there's no way to turn any of it off.

## Solution

Two layered pieces, decided in a grilling session on 2026-07-05 and captured in CONTEXT.md (Quantize, Active loop, Saved loop, Jump event, Take).

**Quantize** becomes a first-class app-wide sticky toggle (default on) governing beat-relative gestures: cue and Hot Cue placement snap to the nearest beat, auto-loop regions snap to the nearest beat, and Hot Cue jumps while playing become phase-preserving — a whole-beat displacement landing at the cue plus the playhead's intra-beat phase, so the groove never stumbles. Snapping is evaluated at gesture time on the client; the backend stores what it's told, and imports never snap. Gridless Tracks degrade to unquantized behavior.

The **Active loop** is new per-Deck transport state: a beat-domain region the playhead wraps in. One button engages an auto-loop of the pending size (powers of two, 1/8–32 beats, default 4) anchored at the playhead and snapped per Quantize; the same button releases it. Halve/double resize it live, anchored at the start edge — a shrink that strands the playhead re-enters it at its phase modulo the new length. Beat jumps translate the region with the playhead; absolute relocation (Hot Cue trigger, cue return, seek) cancels it; Load clears it. The loop survives view switches and surface displacement, renders as a translucent green region on the waveforms, and during live capture a loop engagement survives promotion as a single repeated Jump event — a backward Jump with a repeat count, whose period is definitionally its displacement.

## User Stories

1. As a DJ, I want to press one button to loop N beats from where I am, so that I can hold a section without planning ahead.
2. As a DJ, I want the loop region snapped to the Beatgrid when Quantize is on, so that a sloppy press still produces a musically clean loop.
3. As a DJ, I want the playhead itself never to jump when I engage a loop, so that engaging is inaudible until the wrap.
4. As a DJ, I want the wrap to be sample-accurate and click-free, so that a held loop is indistinguishable from a produced loop.
5. As a DJ, I want to halve and double the active loop live, so that I can tighten a roll into a build-up.
6. As a DJ, I want halving to keep the loop's start edge and pull a stranded playhead back in at its phase modulo the new length, so that rapid halve-halve-halve stays in the groove.
7. As a DJ, I want to release the loop and have playback simply flow past the end edge, so that exiting is seamless.
8. As a DJ, I want the pending loop size remembered per Deck across engagements and views, so that my preferred size is one press away.
9. As a DJ, I want sub-beat loop lengths (1/2, 1/4, 1/8) even though starts snap to whole beats, so that I can do stab loops.
10. As a DJ, I want beat jumps to carry the active loop with the playhead, so that I can walk a loop through the track without dropping the roll.
11. As a DJ, I want a Hot Cue press or seek to cancel the loop and just take me there, so that jumping to the drop never traps me in a leftover loop.
12. As a DJ, I want loading a new Track to clear the loop, so that a region from the old Track can't haunt the new one.
13. As a DJ, I want the loop to keep wrapping while I switch between the Performance and library views, so that Deck continuity holds as it does for playback.
14. As a DJ, I want a paused Deck to keep its loop set, so that displacement by the Transition editor and coming back doesn't lose my place.
15. As a DJ, I want the active loop drawn as a shaded region with edge lines on the full waveform, so that I can see what's wrapping.
16. As a DJ, I want the loop visible as a band on the minimap, so that "the loop is holding me here while I browse" is legible at a glance.
17. As a DJ, I want the LOOP button lit while a loop is active, so that Deck state is readable without looking at the waveform.
18. As a DJ, I want loop controls next to the beatjump controls on each Deck panel, so that playhead-motion gestures live together.
19. As a DJ, I want the same loop controls on the library player, so that Deck A behaves identically everywhere.
20. As a DJ, I want keyboard loop toggles (`r` for Deck A, `u` for Deck B; `r` in the library view), so that looping works without the pointer.
21. As a DJ on a gridless Track, I want the loop button to do nothing rather than guess, so that auto-loop is always trustworthy.
22. As a DJ, I want an app-wide Quantize toggle in the top bar, lit when on, so that one glance tells me whether gestures will snap in either view.
23. As a DJ, I want Quantize on by default and persisted across sessions, so that the 99% case needs no setup.
24. As a DJ, I want Hot Cue jumps while playing to preserve my intra-beat phase, so that pad work never knocks the mix off the grid.
25. As a DJ, I want Hot Cue and Main cue placement snapped to the nearest beat when Quantize is on, so that cues I set live are clean.
26. As a DJ, I want Quantize off to give me exact, unsnapped placement and jumps, so that off-grid tricks and broken-grid tracks stay possible.
27. As a DJ, I want auto-loop with Quantize off to start exactly at the playhead, so that the toggle — not the loop feature — owns the snap.
28. As a DJ, I want a Hot Cue trigger while paused to land exactly on the cue regardless of Quantize, so that cueing up stays precise.
29. As a DJ, I want beat jump, cue return, and loop halve/double unaffected by the toggle, so that inherently beat-clean gestures never change behavior under me.
30. As a DJ whose Take gets promoted, I want a loop I held during the mix preserved in the Transition, so that the promoted artifact sounds like what I played.
31. As a DJ reviewing a promoted Transition, I want that loop represented as one repeated Jump event rather than k separate jumps, so that the artifact is legible and editable.
32. As a curator, I want cues imported from Engine DJ or Rekordbox stored exactly as-is, so that external data is never silently resnapped.
33. As a DJ in the Transition editor, I want loop gestures dropped like other unregistered gesture classes, so that editor semantics stay unambiguous.
34. As a developer, I want the loop's seconds derived from the Beatgrid at gesture time, so that beat-domain semantics hold on any constant grid.

## Implementation Decisions

- **Quantize is an app-wide sticky toggle, default on**, persisted client-side (localStorage, following the existing hints-toggle pattern), surfaced as a small lit `Q` button in the top bar beside the MIDI badge. Not per-Deck (gesture interpretation is a performer intent, not a Deck audio property). No keyboard binding in v1.
- **Quantize governs**: Hot Cue set, Main cue set, Hot Cue trigger while playing, auto-loop set. **It does not govern**: beat jump (already an exact whole-beat displacement), cue return (stops/previews — no groove to preserve), Hot Cue trigger while paused (a seek — lands exactly), loop halve/double (pure beat arithmetic), Transition-editor snapping (separate affordance, ADR 0010).
- **Quantized triggers are phase-preserving, never deferred**: the jump happens immediately; the landing position is cue + current intra-beat phase. Invariant: every quantized jump is a whole-beat displacement of the playhead. A quantized Hot Cue jump therefore does not land exactly on the cue unless the playhead was on a gridline — correct, per CDJ convention; do not "fix".
- **Snapping moves client-side, evaluated at gesture time.** The backend's unconditional nearest-beat snap on hot-cue writes is removed; the API stores what it's told. The Engine-import bypass ceases to be a special case — imports aren't gestures. Backward compatibility is a non-concern.
- **The Active loop is Deck transport state** (region + active flag + per-Deck pending size), living beside playhead/playing/pitch — in the transport reducer's state and the Deck snapshot. It survives view switches and audible-surface displacement; Load clears it.
- **Beat-domain representation**: region = start + length in beats; lengths are powers of two, 1/8–32, default 4. Seconds are a projection through the Beatgrid computed at gesture time (constant-tempo grids make this affine). No Beatgrid → auto-loop unavailable (control inert).
- **Engage semantics**: auto-loop anchors at the playhead; with Quantize on the start snaps to the nearest beat (not downbeat — bars would over-quantize), possibly slightly ahead of the playhead, which then plays into the region. The playhead never moves on engage. Release lets the playhead flow past the end edge — no relocation.
- **Resize semantics**: halve keeps the start edge; double extends the end edge; both derive from the region start, never the playhead. If a shrink strands the playhead outside, the playhead relocates to start + (its old offset mod new length) — phase-mod re-entry.
- **Motion classes**: relative displacement (beat jump) translates the region by the same displacement, preserving position-in-loop — you cannot beat-jump out of a loop. Absolute relocation (Hot Cue trigger, cue return, waveform seek — even to a point inside the region) cancels the loop. There is no "armed but playhead elsewhere" state.
- **Wrap is enforced in the audio path at sample accuracy**: the worklet's pure source kernel wraps the voice position when it crosses the loop end from inside, with declick handling, in both resample and time-stretch (Key Lock) modes. The engine's playhead anchor math must stay correct across wraps (ADR 0018 architecture; the kernel remains pure and testable).
- **"Loops" is a new gesture class** in the Controller routing vocabulary (ADR 0019). Registered by the Performance and library surfaces; the Transition editor does not register it — loop gestures there are dropped. (Actually mapping the hardware loop section is out of scope; the class exists so routing is ready.)
- **Repeatable Jump events**: a Jump event may carry a repeat count k ≥ 1; a count > 1 is only coherent on a backward Jump, whose repetition period is definitionally its displacement magnitude — no period field. Take promotion collapses a loop engagement into one repeated Jump event rather than k wraps (extends the ADR 0020 discrete-gesture rule).
- **UI**: per-Deck `LoopRow` `[½] [LOOP N] [×2]` — one stateful button showing the pending/active size, lit green while active (green = state, never Deck identity). Placed with the beatjump/pads column in the Performance Deck panels and appended to the library player's control overlay. Keyboard: `r`/`u` toggles in the Performance view (exact mirror pair), `r` in the library view; no size keys in v1.
- **Waveform rendering**: translucent bright green fill spanning the region plus solid green edge lines, on both full-width waveforms and as a thin band on the minimap; renders only while a loop is active; derived per-frame from the Deck snapshot so it translates with beat jumps. This is the renderer's first filled-region overlay primitive — build it as a general shaded-region capability (manual in/out and Saved loops will reuse it).

## Testing Decisions

Good tests here assert external behavior at pure seams — state in, state/effects out — never Web Audio internals, DOM, or rendering. All seams already exist; no new ones.

- **Primary seam: the transport reducer** (prior art: the existing transport reducer tests). Covers nearly everything: Quantize placement snapping, phase-preserving jump targets, gridless degradation, toggle-off exactness; loop engage/release, size clamps, halve/double with start-edge anchoring and phase-mod re-entry; translate-on-beat-jump, cancel-on-absolute-relocation, clear-on-Load.
- **Secondary seam: the worklet source kernel** (prior art: the existing kernel tests). The one behavior the reducer can't see: sample-accurate wrapping — rendering across the end edge wraps the voice position, declick applies, and both resample and time-stretch modes wrap identically; loop wrap takes precedence over end-of-track inside the region.
- **Piggyback: the deck engine tests** — playhead clock remains correct across wraps (anchor math), loop state appears in the Deck snapshot.
- **Piggyback: the capture vectorizer tests** — a loop engagement in a Take derives one repeated Jump event with the right displacement and count, not k separate jumps.
- **Piggyback: backend router/write-path tests** (prior art: existing hot-cue write-path and sync-performance tests) — hot-cue writes are stored verbatim (no server-side snap), Engine import path unchanged.
- UI components (LoopRow, waveform region, top-bar toggle) get no component tests, consistent with the codebase convention of testing pure models only.

## Out of Scope

- **Manual loop in/out** (press in, press out, gridless loops) — a later pass; it introduces a pending-loop transport state deliberately deferred.
- **Loop rolls** (slip-behind stutter loops) — a different feature with slip semantics.
- **Saved loops** — persisted per-Track loop slots, their UI, and Sync with Engine DJ's `loops` performance blob (import/export). Planned concept stubbed in CONTEXT.md; the shaded-region renderer and repeatable Jump events are the groundwork.
- **Controller loop-section Mapping and Feedback** — the gesture class exists, but mapping the hardware loop encoder/pads is follow-up work in the MIDI feature.
- **Keyboard halve/double** and a Quantize keyboard binding.
- **First-class loop concept in Transitions/templates** — repeated Jump events are the representation; a richer loop artifact is a future compaction if loop-heavy Transitions make Jump stacks unwieldy.
- **Quantized-trigger deferral modes** (Ableton-style launch quantization) — rejected, not deferred.

## Further Notes

- Glossary entries for Quantize, Active loop, Saved loop, the amended Jump event and Take, and the extended gesture-class list were written to CONTEXT.md during the grilling session (2026-07-05). No ADR — every decision is reversible and documented there.
- Multi-tempo (variable) Beatgrids: beat↔seconds projection should go through the Beatgrid rather than a single BPM constant where practical, but the library is Quantized tracks and the existing beatjump has the same constant-tempo assumption — matching it is acceptable for v1.
- Natural tracer order for slicing: Quantize toggle + gesture-time snapping (backend snap removal) → reducer loop state + kernel wrap (audible loop) → halve/double + motion classes → waveform region rendering → LoopRow + keys → repeatable Jump events in capture/promotion.

## Verification walkthrough (2026-07-05, workspace looping)

All 6 issues implemented (statuses + Done comments in `issues/`). Gate green on the rebased stack: 569 backend + 871 frontend tests, build, ruff, single alembic head.

Lane app: **http://localhost:5263** (desktop shell: `npm --prefix desktop start -- --port 5263`).

The 3–5 clicks:

1. **Quantize toggle**: top bar, `Q` beside MIDI — lit green (default on). Click it off/on; reload — it sticks.
2. **Placement snap**: load a gridded Track, play, hit a hot-cue pad on an empty slot mid-beat — the marker lands exactly on a beat line. Toggle `Q` off, set another — lands exactly where pressed.
3. **The loop**: in Performance, press `r` (Deck A) or the LOOP 4 button while playing — button lights green, translucent green region + edge lines on the waveform, thin green band on the minimap; the wrap is click-free (try Key Lock on and off). Press again to release — playback flows past the edge.
4. **Resize + motion**: while looping, hammer ½ a few times — the roll tightens, stays in the groove (phase-mod re-entry); ×2 doubles from the start edge. Beat jump (`a`/`s`) — the region travels with you. Hit a hot cue or seek on the waveform — loop cancels.
5. **Quantized triggers**: Q on, playing, hit a set hot cue slightly off the beat — the groove never stumbles (lands at cue + phase, not exactly on the cue: CDJ convention, correct).
6. **Take promotion** (optional deeper check): perform a handover holding a loop on the incoming deck, promote the Take — the editor shows ONE jump chip labeled `×k`, and audition replays the loop.

What correct looks like: engage never moves the playhead (snap can put the region start slightly ahead — you play into it); gridless Tracks leave LOOP inert; loading a new Track clears the loop but keeps the size.

**Review round 1 (2026-07-05)**: two findings fixed in `wrmvrrkq` — (a) loop row now has its own full-width row in the Performance pad column and the library overlay (it was jammed into the pads grid); (b) audible pops at wrap boundaries with Key Lock ON: the wrap spliced the stretch voice onto the resample path mid-voice — wraps now happen at the stretcher's READ layer (the fill window folds past the region end; no splice, no re-prime), so the stretcher's own overlap-add smooths the boundary. Key Lock OFF keeps the stab-grade declick splice. **Reload the page at :5263** (the worklet module needs a fresh load). Follow-up idea filed: `issues/07-overload-jump-and-loop-controls.md`.

**Review verdict (2026-07-05)**: the library player's on-screen loop controls are removed (deviation from issue 03's "library player's control overlay", sanctioned by the human) — in the library view the loop is `r` + the waveform's green region; the LoopRow lives in the Performance Deck panels only.
