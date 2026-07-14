# PRD: Four-Deck performance and full application support

Status: proposed

## Problem Statement

manadj owns only Decks A and B. Its audio graph, Performance view, Controller mappings, Follow mode, Play guides, Take capture, Transition editor, and Conductor all assume exactly two Decks. A DDJ-GRV6 cannot be used for the four-Deck dnb performances it was bought for: doubles, triples, fast handovers, and independent control of four mixer channels.

## Solution

Make Decks A, B, C, and D fixed app-owned playback units and deliver support in phases. Phase 1 is an end-to-end GRV6 performance instrument: four simultaneously visible and playable Decks, four mixer strips, layered deck-surface focus, GRV6 MIDI input and Feedback, browsing and Loading, PFL, and Master/Cue audio through the controller. Later phases generalize capture, pair selection in the Transition editor, and Conductor allocation without introducing n-ary Transitions or Cameos.

## User Stories

Phase 1 — Performance:

1. As a DJ, I want four independent Decks, so that I can perform doubles, triples, and fast handovers.
2. As a DJ, I want every Deck to keep its loaded Track and playback state across views, so that changing screens never dismantles a live mix.
3. As a DJ, I want all four waveforms visible in one stack, so that no sounding Deck becomes hidden behind a hardware layer.
4. As a DJ, I want four Deck-control panels in a 2×2 grid, so that every Deck remains inspectable and pointer-operable.
5. As a DJ, I want the two focused Decks highlighted prominently, so that I know which Deck each GRV6 deck surface and keyboard hand controls.
6. As a DJ, I want playing and audible state visually distinct from Control focus, so that focus never masquerades as sound state.
7. As a DJ, I want four Mixer channel strips, so that each Deck has independent trim, EQ, filter, fader, and PFL.
8. As a DJ, I want the phase-1 crossfader to place A+C on the left and B+D on the right, so that all Decks participate before crossfader assignment UI lands.
9. As a DJ, I want later left/thru/right crossfader assignment per channel, so that Deck identity does not dictate blending topology.
10. As a DJ, I want Loading and load-lock protection on every Deck, so that C/D are not second-class playback units.
11. As a DJ, I want Deck-scoped cues, loops, pitch, Key Lock, Nudge, Quantize, and beatjump on C/D, so that every existing performance action has A–D parity.
12. As a DJ, I want Play guides for every applicable playing→paused pair, so that overlapping pairwise Transitions remain usable in a four-Deck mix.
13. As a DJ, I want each Play guide labeled by both Decks and drawn only across their waveform rows, so that simultaneous guides remain attributable.
14. As a DJ, I want Follow to use all playing Decks as references once enabled, so that suggestions represent the live blend.
15. As a DJ, I want Follow to retain its last reference through full silence, so that a pause does not erase the browse context.
16. As a DJ, I want MATCH to use the other playing Deck with the nearest effective BPM, so that one-shot matching remains useful without a Tempo Master model.
17. As a DJ, I want MATCH to no-op when no other Deck is playing, so that its target is never guessed from an inaudible Track.
18. As a DJ, I want the standalone Library player to remain Deck A, so that curation and auditioning retain a stable player.

Phase 1 — GRV6:

19. As a DJ, I want the GRV6's left surface to focus A/C and its right surface B/D, so that hardware layering matches the controller.
20. As a DJ, I want hardware, keyboard, and pointer interactions to share Control focus, so that all inputs address the same left/right pair.
21. As a DJ, I want touching an on-screen Deck panel to focus it on its side, so that screen and controller never silently disagree.
22. As a DJ, I want deck-surface Feedback to repaint on focus changes, so that pads and transport lights represent the Deck under my hand.
23. As a DJ, I want unfocused Decks to remain visible on screen, so that layered hardware never hides their state.
24. As a DJ, I want shared GRV6 tempo faders to use soft takeover with a directional target hint, so that switching A↔C or B↔D cannot jump tempo.
25. As a DJ, I want the GRV6's four dedicated Mixer strips to address fixed Decks, so that changing Control focus never retargets the mixer.
26. As a DJ, I want GRV6 browse and Load controls to target the focused left/right Decks, so that I can prepare all four Decks without touching the computer.
27. As a DJ, I want Master audio on the GRV6 master outputs and Cue audio on its headphone output, so that the controller is usable end-to-end.
28. As a DJ, I want hot-plug and routing recovery to work with the GRV6, so that reconnecting it does not require restarting manadj.
29. As a DJ, I want clearly documented GRV6 controls with existing manadj counterparts mapped in phase 1, so that the core instrument is reliable.
30. As a DJ, I want ambiguous global, Groove Circuit, effects, and stems controls to remain inert until a controller-in-hand design session, so that speculative mappings cannot disrupt a set.
31. As a DJ, I want my existing two-Deck Controller to retain A/B behavior, so that four-Deck support does not require fabricated layer controls.

Phase 2 — Capture:

32. As a DJ, I want ordinary Take capture to continue when any two Decks are audible, so that C/D performances count like A/B performances.
33. As a DJ, I want capture temporarily suspended when a third Deck becomes audible before phase 2 lands, so that the old detector cannot emit misleading Takes.
34. As a DJ, I want one multi-Deck engagement to emit every ordered-pair Take or Cameo Take that meets its existing definition, so that capture remains deliberately liberal.
35. As a DJ, I want pairwise captures stamped with a shared capture-session clock and engagement identity, so that a triple can be reviewed as one move.
36. As a DJ, I want self-pairs captured when the same Track plays on two Decks, so that self-doubles remain valid evidence.
37. As a DJ, I want Transition history to expose the complete engagement group, so that related pairwise offspring are not reconstructed by timestamp guesses.

Phase 3 — Transition editor:

38. As a DJ, I want to open any selected physical Deck pair in the Transition editor, so that editing is not fixed to application Decks A/B.
39. As a DJ, I want editor A/B to remain visual shorthand for outgoing/incoming or host/guest roles, so that familiar editing language survives four physical Decks.
40. As a DJ, I want editor auditions to map those roles onto the selected physical pair, so that the artifact remains pairwise and role-addressed.
41. As a DJ, I want the other two Decks' state preserved but their playback paused when audition starts, so that the single Audible-surface rule remains predictable.
42. As a DJ, I want multi-Deck engagement groups reviewed pair by pair from one history group, so that no n-ary editor is required.

Phase 4 — Sets:

43. As a DJ, I want the Conductor to retain sounding roles on their current physical Decks, so that allocation never moves live audio gratuitously.
44. As a DJ, I want each new incoming or guest role allocated to the first free Deck in A→B→C→D preference, so that playback is deterministic without fixed ping-pong.
45. As a DJ, I want Grace fade only when all four Decks are occupied, so that available Deck capacity resolves overlaps before audio is truncated.
46. As a DJ, I want the Set plan and Overview ladder to show actual A–D allocation, so that playback visualization matches the performance surface.
47. As a DJ, I want Pickup and Live re-plan to understand all sounding allocated roles, so that manual takeover remains reversible in a four-Deck plan.

Follow-ups:

48. As a DJ, I want a controller-in-hand mapping grill, so that ambiguous GRV6 controls are assigned from observed behavior and actual workflow.
49. As a DJ, I want a later Tempo Master design, so that MATCH/SYNC can gain an explicit reference if nearest-tempo selection proves insufficient.
50. As a DJ, I want alternate displayed Deck labels to be possible later, so that presentation can change without changing canonical A–D identity.

## Implementation Decisions

- Four fixed Deck identities: A, B, C, and D. Configurable deck count is rejected; alternate labels are presentation only.
- The application owns all four Decks and four Mixer strips eagerly. Existing per-Deck state and persistence become exhaustive A–D records rather than dynamic collections.
- Performance shows four stacked, linked-zoom waveforms and a 2×2 Deck-control grid. All four remain visible regardless of Control focus.
- Control focus is one left-side Deck (A/C) and one right-side Deck (B/D), shared by GRV6, keyboard, and pointer. It affects deck-surface actions and Feedback, never dedicated Mixer strips or sound state.
- Layered absolute controls use existing soft-takeover semantics and directional hints. Dedicated GRV6 channel controls remain fixed to their Mixer channels.
- The Mixer has one channel strip and PFL tap per Deck. Its crossfader model supports left/thru/right assignment; phase 1 may ship fixed A+C left and B+D right before assignment controls.
- MATCH remains one-shot. Its phase-1 reference is the other playing Deck with minimum folded effective-BPM distance; ties use A→B→C→D order. No other playing Deck means no-op. Tempo Master is deferred.
- Follow references all playing Decks once engaged and unions their candidate sets. The last reference survives full silence.
- Play guides remain pairwise and quantify over every playing→paused Deck pair. No composite guide or governing Deck is introduced.
- The standalone Library player stays fixed to Deck A. Performance browse/load actions address all four Decks.
- The GRV6 Mapping covers unambiguous controls that already have manadj actions. Controls may be repurposed away from their printed labels when gesture shape and scope match (CONTEXT.md, Mapping entry); the 2026-07-14 pre-hardware design session resolved most ambiguous controls (`docs/research/ddj-grv6-mapping-design.md`). Groove Circuit, effects-section, and remaining global controls stay absent pending the controller-in-hand session.
- Phase 1 includes GRV6 Master/Cue audio routing and hardware verification, not MIDI-only support.
- Until phase 2, capture supports at most two audible Decks and suspends the engagement when a third becomes audible.
- Transitions and Cameos remain strictly pairwise. Their lanes address semantic roles, never physical Deck identity. Pairwise captures from a multi-Deck engagement share a capture-session clock and engagement identity.
- The Transition editor remains pairwise. Its UI may say A/B as role shorthand while internally addressing outgoing/incoming or host/guest. A selected physical pair carries those roles during audition.
- An editor audition claims the Audible surface and pauses non-selected Deck playback while preserving all Deck state.
- The Conductor allocates physical Decks dynamically. Sounding roles stay put; each new role uses the first free Deck in A→B→C→D preference. Grace fade is a pool-exhaustion resolution.
- Existing two-Deck Controller mappings remain fixed to A/B unless a device has real layer controls or a later Mapping explicitly adds them.

## Testing Decisions

- Tests assert observable behavior through existing module interfaces, following ADR 0002; no Web Audio or Web MIDI mocks.
- Pure Deck/Mixer seams cover exhaustive A–D state, four-channel gain/PFL behavior, fixed phase-1 crossfader grouping, and later assignment math.
- Existing MIDI translator and dispatch seams use synthetic GRV6 messages to cover A/C and B/D focus, action routing, focus Feedback repaint, soft takeover isolation per Deck, and unmapped-message silence.
- Existing Follow and Play-guide model seams cover multiple playing references, candidate union, silence retention, and all applicable pairwise guides.
- Existing routing seams cover GRV6 output-pair selection, missing-device fallback, hot-plug recovery, and independent Master/Cue failure.
- Existing capture seam covers any two physical Decks, suspension on a third Deck, 12 ordered pair machines, liberal pairwise verdicts, shared clock/group identity, and self-pairs.
- Existing planner/Conductor seam covers deterministic free-pool allocation, role stability, pool exhaustion, four-Deck Grace fade, seek, Pickup, and Live re-plan.
- UI/audio graph behavior remains hardware-verified: four concurrent Tracks without glitches, all four channel strips and PFL taps, layer switching, Feedback, load lock, Master/Cue routing, and reconnect.

## Out of Scope

- Configurable or unbounded Deck count
- N-ary Transitions, Cameos, automation lanes, or editor timelines
- Automatic composition of pairwise Transitions into a multi-Deck authored move
- Continuous beat sync or a Tempo Master in phase 1
- Groove Circuit, stems, sampler, and effects implementation
- Guessing mappings for ambiguous GRV6 controls before controller-in-hand verification
- Numeric Deck labels or a label preference UI
- Per-control Conductor takeover
- A separate four-Deck layout for the standalone Library

## Further Notes

- Phase order: (1) end-to-end GRV6 Performance, (2) multi-Deck Take capture, (3) arbitrary-pair Transition editing, (4) dynamic-pool Set playback, (5) controller-specific expansion.
- ADR 0032 records the fixed-four/pairwise-artifact boundary.
- Deck C/D colors and exact responsive spacing belong to the Performance layout prototype; colors must remain saturated and distinct from state colors.
- The GRV6 MIDI message list is the phase-1 Mapping source. The physical controller is the authority for undocumented or ambiguous behavior.
- Hardware reference and mapping-design records: `docs/research/ddj-grv6-hardware.md`, `docs/research/ddj-grv6-mapping-design.md`. The design doc carries the open questions and the hardware-verification list for the controller-in-hand session.
