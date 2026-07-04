# 02 — waveform generation on the task system

Status: resolved (wfproto lane, 2026-07-04)

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

## Comments

**2026-07-04 (wfproto lane, change `knpnytwv`)** — Implemented:
`backend/waveform_tasks.py` (handler + `enqueue_waveform_task` dedup + `enqueue_missing_waveforms`
sweep); enqueue chokepoints: `crud.create_track` and Disk Import's post-commit; startup sweep in
`main.py`; `_build_task_worker` restructured (waveform handler always unless `DISABLE_WAVEFORM_WORKER`,
download handler config-gated as before — the worker no longer refuses to start without soundcloud
config); `backend/waveform_worker.py` deleted. Handler has two paths: missing row → full legacy
generation (behind an injectable seam — audio analysis is ADR-0002-fakeable, keeps librosa out of
the suite); NULL `data_blob` → fast v2 backfill (tested real).

**Deviations from the issue text**: (a) *serial, not concurrency 2* — the task system is
single-threaded by design and generation measures ~0.3 s/track; retrofitting concurrent task
claiming into shared infra wasn't worth it (992-track backfill ≈ 5 min, verified live on the
sandbox DB). (b) *No per-track progress* — the Task model has no progress field ("if the task
system supports it" — it doesn't); the generation module's `on_progress` hook exists whenever
the task system grows one. (c) `populate_waveforms.py` kept as-is — it calls `create_waveform`,
which now writes blobs too; it retires in issue 06.

Ripple: `test_acquisition_download.py::test_full_chain` now expects 2 processed tasks (download
+ the waveform task its Track creation enqueues). Full suite 452 passed; ruff clean.
