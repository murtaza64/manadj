# 02 — waveform generation on the task system

Status: ready-for-agent

## Parent

`.scratch/waveform-overhaul/PRD.md`

## What to build

Automatic Waveform data generation moves from the hand-rolled daemon thread (`backend/waveform_worker.py`) to the in-process task system (ADR 0003), which was already slated to absorb it: tracks lacking v2 Waveform data get blobs generated as tasks with concurrency 2, exposing per-track progress (the blockwise pipeline yields a natural percentage) if the task system supports it. The daemon thread is deleted; `DISABLE_WAVEFORM_WORKER` behavior is preserved or replaced by the task system's equivalent. The bulk `populate_waveforms.py` script is updated to the new generation module (or retired if the task system covers backfill).

## Acceptance criteria

- [ ] Importing a Track results in v2 Waveform data appearing without manual action
- [ ] Generation runs on the task system with concurrency 2; the ad-hoc daemon thread is gone
- [ ] Per-track progress observable (if the task system supports progress)
- [ ] Bulk backfill path exists and uses the new module
- [ ] `uv run -m pytest` green

## Blocked by

- `01-v2-blob-generation-and-endpoint.md`
