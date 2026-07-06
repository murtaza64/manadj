# 29 — B enters and leaves entirely during A (doubles/teases) — unmodeled

Status: needs-triage

## Parent

.scratch/sets/PRD.md (filed 2026-07-05; expected outcome is a SEPARATE PRD + grill session, not implementation from this ticket)

## The gap

Neither the Transition model nor the Set model can express: bring B in for a double (or tease), then return to A — B's audibility begins *and ends* inside A's play, and A remains the current track.

Where the assumption is baked in:

- **Transition** (glossary): "the handover between an ordered pair" — directional, A ends. The editor's whole timeline is organized around one window after which B owns the mix; audio-wise its lanes could fake faderB-up-then-down, but the artifact still *means* "B is next", so a Set adjacency built on it advances the set — semantically wrong even when sonically right.
- **Handover / Take capture** (glossary): deliberately excludes this — "a tease where the outgoing survives is no Handover at all"; cross-cuts fold into one Handover. So performing a double yields no capturable artifact today, by definition.
- **Set model**: an adjacency consumes its pair and advances deck roles/ping-pong; there is no entry kind for "guest appearance inside the current track". Planner/ladder/Conductor all inherit this.

## Questions the future grill must settle (seed list)

- Is this a new first-class artifact (an *Interlude*? *Double*?) attached to a single host Track position in a Set, referencing a guest Track — or a generalization of Transition (windows with an exit ramp back to the origin)?
- Capture: does Handover detection grow a second detection target (engagements that resolve back to the outgoing), or is this editor-authored only at first?
- Editor: same timeline (mix time ≡ A track time actually survives this case — A never leaves!) with a two-edged window? What do templates mean here?
- Set semantics: does an interlude occupy the opposite deck (colliding with the next adjacency's load timing / grace-fade machinery)? Ladder rendering?
- Does the guest count as "played" for Follow/discovery/evidence purposes?

## Suggested handling

Run `/grilling` + `/domain-modeling` with the human; produce `.scratch/<new-feature>/PRD.md` (this is a Transition-model extension at least as much as a Sets feature); leave this ticket as the pointer from the sets tracker.

## Blocked by

- The grill itself (needs the human)
