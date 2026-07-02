# Classification: heuristics, filters, override

Status: ready-for-agent

## Parent

`.scratch/soundcloud-acquisition/PRD.md`

## What to build

Each Source Item gets a heuristic Classification — track, mix, clip, or other — assigned at Refresh from duration bounds and title keyword patterns configured in config.toml. Classification filters views but never auto-ignores.

UI: classification shown on each row; suspected mixes/clips hidden by default behind a filter toggle; user can override an item's Classification; filter by lifecycle state as well.

## Acceptance criteria

- [ ] Classifications assigned on Refresh from config-driven duration bounds and title keywords
- [ ] Default view hides mix/clip; toggle reveals them
- [ ] User override persists and wins over heuristics (re-Refresh doesn't clobber it)
- [ ] Nothing is ever auto-ignored by Classification alone
- [ ] Heuristics unit-tested directly; override + filtering covered at the module interface

## Blocked by

- 02-refresh-end-to-end.md
