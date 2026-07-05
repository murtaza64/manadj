# 04 — Conductor v1: play a Set end-to-end

Status: ready-for-agent

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
