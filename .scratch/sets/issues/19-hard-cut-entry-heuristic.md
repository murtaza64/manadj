# 19 — Hard-cut entry: Hot Cue 1 → track start, and plan reactivity to cue edits

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md (decided 2026-07-05 during a live debugging session; CONTEXT.md "Set playback" updated)

## Problem

Two related findings from debugging a real set (Slow Motion → RUN, "plays 0:00"):

1. The unresolved-adjacency hard-cut rule enters the incoming Track at its **Main cue** — but the Main cue is *defined* to move freely during performance (CDJ memory-cue behavior). Any plan anchored to it rots as the user performs. In the observed case the Main cue (2:35) sat after the pinned mix-out (1:51), yielding a never-audible track and a confusing "plays 0:00".
2. Persisting a cue edit does not invalidate the track data the Set plan reads — after moving a cue, the plan (ladder, played durations, warnings) shows stale numbers until an app reload.

## What to build

- **Planner rule change**: unresolved hard-cut entry = incoming Track's **Hot Cue 1**, falling back to **track start** when slot 1 is unset. (Cue-slot convention: slot 1 = first buildup — the stable entry anchor. Main cue no longer participates in Set planning anywhere.)
- **Align the practice affordance** (issue 13's positioning): the unresolved case cues B at Hot Cue 1 → track start, matching what the plan would do.
- **Plan reactivity**: cue and hot-cue persistence must invalidate whatever queries feed the Set plan's track facts, so the ladder/durations/warnings recompute without a reload. (The plan is a derived projection; there is deliberately no refresh button.)
- **Warning clarity** (same debugging session): classify the "entry after exit" case distinctly from window overlap — message names the cause with numbers ("planned entry 2:35 is after the pinned mix-out 1:51") — and give never-audible rows a loud badge (e.g. NEVER AUDIBLE) instead of the innocuous "plays 0:00".

## Acceptance criteria

- [ ] Unresolved adjacency enters incoming at Hot Cue 1; at track start when slot 1 unset; Main cue is not consulted
- [ ] Practice on an unresolved adjacency cues B identically
- [ ] Moving a hot cue (or Main cue) updates the Set plan without reload
- [ ] Entry-after-exit produces its own warning naming both numbers; the affected row shows a loud never-audible badge
- [ ] Planner tests updated (entry rule, fallback, entry-after-exit classification)

## Notes

- `sets/planner.ts` is contested while lane `setlist` implements issue 16 — dispatch this to that lane after 16 parks, or to whoever owns the planner next. Small change; land promptly after approval.

## Blocked by

- Soft: 16-conductor-pickup in flight on the planner-owning lane (avoid parallel planner edits)
