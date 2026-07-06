# Overload the beatjump and loop controls into one cluster

Status: needs-triage

## Parent

`.scratch/looping/PRD.md` (follow-up idea from review, 2026-07-05)

## Idea

The Deck panel now carries two stacked rows with near-identical anatomy:
`[←] [½] [N] [×2] [→]` (beatjump) and `[½] [LOOP N] [×2]` (loop). Proposal:
collapse them — pressing the beatjump **size number** engages/releases a
loop of that size, and the halve/double buttons become loop-size controls
while a loop is active (they already adjust the shared size when idle).

Open questions for grilling:

- One shared size for jump and loop, or keep the per-Deck pending loop size
  separate? (Today: separate — beatjump N vs pendingLoopBeats.)
- Loop sizes go sub-beat (1/8–1/2); beatjump clamps to whole beats 1–128 —
  whose clamp wins on a shared control?
- Keyboard: `r`/`u` stay as the loop toggle either way?
- MIDI `beatjump-size` targets currently hit the shared size — same overload?

## Update (2026-07-05, MIDI grilling)

The MIDI question is decided: SHIFT+IN/OUT overloads by state — loop active →
loop resize halve/double; no loop → beatjump-size, as today. The on-screen
overload (collapsing the two rows) remains open, but should match this
state-disambiguated semantics if taken.

## Blocked by

None (UI-only refactor over landed loop semantics)
