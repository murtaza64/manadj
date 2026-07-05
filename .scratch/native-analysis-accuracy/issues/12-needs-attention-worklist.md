# 12 — Needs-attention worklist filter

Status: ready-for-agent

## Parent

.scratch/native-analysis-accuracy/PRD.md

## What to build

Surface the needs-attention flag (set by bail, issues 07/10/11) as a library view filter, so unquantized/failed tracks form a worklist for manual gridding or External Import. Flag clears when the track gains a grid from any origin. The only UI in this PRD.

## Acceptance criteria

- [ ] Library view can filter to needs-attention tracks
- [ ] Flag visible on the track row/detail
- [ ] Flag clears when a grid is saved (edited, imported, or successful re-analysis)
- [ ] Frontend test at the view seam; backend behavior test for flag lifecycle

## Blocked by

- 07
