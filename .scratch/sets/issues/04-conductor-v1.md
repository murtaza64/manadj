# 04 — Conductor v1: play a Set end-to-end

Status: ready-for-human

## Parent

.scratch/sets/PRD.md

## What to build

The Conductor: a thin runtime driver that schedules the planner's output onto the shared Decks and Mixer (in the mold of the existing two-track mix player). Not a new Audible surface — the performance surface plays; any view showing the Decks visualizes the set. Tracks ping-pong A/B; Transition lanes address outgoing/incoming ROLES, so the Conductor swaps channel assignments on odd adjacencies. Hard cuts per plan. Row play buttons: seek to that track's planned entry and play. Any manual deck or mixer gesture stops the Conductor entirely (Decks keep playing as they are — the user is live). Conductor-driven playback is invisible to Take capture; capture resumes at takeover. Tempo v1: tempo-match during windows, snap to native after (Riding ramps and Fixed policy arrive in issue 06).

Write the ADR "Set playback is a Conductor, not an Audible surface" (a reader who knows ADR 0013 expects a third surface; takeover + capture-invisibility rules are the rationale).

## Acceptance criteria

- [ ] A Set with pinned Transitions plays end-to-end through the shared Decks/Mixer, audibly correct at each handover
- [ ] Role→deck parity: a Transition authored A→B plays correctly when its outgoing track sits on Deck B
- [ ] Unresolved adjacency hard-cuts without stalling; playback stops after the last track
- [ ] Row play button starts from that track's planned entry
- [ ] Touching any deck/mixer control stops the Conductor; audio continues uninterrupted
- [ ] No Takes are captured from Conductor playback; a post-takeover manual mix does capture
- [ ] ADR committed under docs/adr/

## Blocked by

- 03-planner-overview-ladder

## Comments

**2026-07-05 — Implemented (change rtqkwmot, parked for review on top of 03).**
Planner grew the evaluation half (still pure, tested): `planStateAt(plan, t)`
→ per-deck occupant/track-time/playing/pitch + role→deck-mapped mixer
automation (odd-adjacency swap lives HERE, not in the driver), and
`jumpCrossed` for hard-sync instants; `PlannedAdjacency` is a discriminated
union. `sets/Conductor.ts` is the thin driver in MixPlayer's mold: rAF loop
on the Mixer's audio clock, reconciles the shared DeckEngines (drift
tolerance 0.12s), loads upcoming tracks through the deck provider's one Load
path, and freezes the mix clock if a deck that must sound is still loading.
Borrow lifecycle: registerSurface('conductor') → claimAudible →
engageAutomation; capture invisibility is the existing holder-gate for free;
takeover = any mixer base-state diff (field-level), deck snapshot diff
(play/pitch/bend/preview/keylock), or seek/beatjump/hotcue via a new
ADDITIVE `DeckEngine.addTransportEventListener` — all behind a self-op
guard. At takeover the last automation values are written into base mixer
state (sparing the user's own gesture) so the disengage is inaudible; decks
keep playing; capture re-seeds. Editor claim displaces the Conductor (stands
down without releasing). `conductorStore` owns the one running instance
(module-level — playback survives view switches); SetDetailPane grew the
toolbar transport, per-row hover ▶ (planned-entry start), and the active-row
highlight. ADR 0024 written. Known edges (documented): MIDI pitch moves are
DROPPED (not takeover) while a non-shared surface holds audibility (existing
dispatch rule); plan is snapshotted at start (re-pin → next start); planner
`warnings` are computed but not yet surfaced (issue 06 will want them).

**2026-07-05 — Review walkthrough (ready-for-human).** Lane app at
**http://localhost:5253** (backend 8080, sandbox DB; "test set" = 8 tracks,
2 Transition pins, 3 Take pins, 2 hard cuts). Audible end-to-end script:

1. Library → Sets → "test set" → toolbar **▶ Play set**. First track starts
   at its Main cue; watch the ladder/list and the active-row highlight walk.
2. Handover 1+2 (Transition pins) and 3–5 (Take pins) play through the
   shared decks — flip to **Performance mode mid-playback**: decks/waveforms
   visualize the set, playback uninterrupted (row 2's outgoing sits on deck
   B — role swap audibly correct if the transition mixes as authored).
3. Hard cuts after "Stutter" and "Calling For A Sign": outgoing to its end,
   incoming from its Main cue, no stall. After the last track, playback
   stops and the toolbar returns to ▶.
4. Row play: hover a middle row → ▶ starts at that track's planned entry.
5. Takeover: while playing, move any mixer fader/EQ (or press a deck
   play/pause, or nudge pitch) — the Conductor stops (toolbar shows ▶),
   audio KEEPS PLAYING exactly as it sounded; you are live.
6. Capture: while conducting, no Takes appear in History (machine playback
   is invisible); after a takeover, perform a manual handover — that one
   DOES capture. Conductor transport itself (pause/resume, row ▶) never
   stops the Conductor.
