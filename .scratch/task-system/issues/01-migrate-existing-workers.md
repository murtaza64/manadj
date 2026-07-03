# Migrate existing background work onto the task system

Status: needs-triage

## Problem

Once the generic task system exists (ADR-0002, built for SoundCloud acquisition), `backend/waveform_worker.py` remains a separate hand-rolled background thread, and Analysis (key/BPM/beatgrid) runs outside any queue.

## Idea

Migrate existing background work onto the task system:

- Waveform generation (replace `waveform_worker.py`)
- Analysis runs (key, BPM, beatgrid)

Each becomes a task type with observable state, errors, retry, and history — same as downloads.

## Notes

- Blocked by: the task system itself (soundcloud-acquisition effort).
- See docs/adr/0002-in-process-task-system.md.
