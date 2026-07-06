# Offset-parameterized beatgrid nudge endpoint

Status: ready-for-agent

## Parent

`.scratch/midi-performance-ops/PRD.md`

## What to build

The backend grid-nudge endpoint takes a fixed ±10ms step today. Give it an explicit millisecond offset parameter so one API serves both the discrete tap (±10ms) and the accumulated spin-to-nudge commit (±n ms, issue 06). The existing on-screen nudge buttons and keyboard shortcuts pass the same 10ms they always meant.

## Acceptance criteria

- [ ] The nudge endpoint accepts a signed millisecond offset and translates the grid by exactly that amount
- [ ] Existing UI/keyboard nudges behave identically to before (±10ms)
- [ ] Router tests (existing backend seam) cover arbitrary offsets, sign, and accumulation across calls
- [ ] No change to anchor/set-downbeat or delete semantics

## Blocked by

None - can start immediately

## Comments

**2026-07-06 (lane midigrid)**: The endpoint was already offset-parameterized — `NudgeGridRequest.offset_ms: float` (backend/routers/beatgrids.py), applied exactly via `beatgrid_utils.nudge_beatgrid` (rigid shift, clamp at first tempo change, anchor moves by the applied offset). The fixed ±10ms lives only in the frontend constant `GRID_NUDGE_MS` (useBeatgridData.ts), which UI/keyboard callers pass unchanged. Work delivered: router tests for arbitrary signed offsets, accumulation across calls, and clamping (tests/test_beatgrids_router.py). No backend code change; anchor/set-downbeat/delete untouched. Verified `uv run -m pytest tests/test_beatgrids_router.py tests/test_beatgrid_origin.py` green.
