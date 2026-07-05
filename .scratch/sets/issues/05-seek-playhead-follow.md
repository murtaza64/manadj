# 05 — Seek, playhead, follow

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md

## What to build

Conductor transport beyond play: **seek = plan evaluation at a mix-time instant** — active track(s), deck positions, lane values mid-window, tempo state — legal into the middle of a Transition and while paused (positions without playing). Clicking the overview ladder seeks (replacing the ladder's navigate-on-click). Playhead line in the ladder; active row highlighted in the list. **Follow mode** for the pinned ladder+list scroll: on when playback starts, disengaged by any manual scroll, re-engaged by seeking or a follow button. Transport gestures are Conductor controls, not takeover triggers.

## Acceptance criteria

- [ ] Seeking mid-window reproduces the same audio state as playing into that instant
- [ ] Ladder click seeks; playhead and active-row highlight track playback
- [ ] Seek while paused positions without starting
- [ ] Follow engages on play, disengages on manual scroll, re-engages on seek; scrolls stay mutually pinned throughout
- [ ] Seeking never stops the Conductor

## Blocked by

- 04-conductor-v1
