# Bulk queue, failure/retry UX, concurrency limit

Status: ready-for-agent

## Parent

`.scratch/soundcloud-acquisition/PRD.md`

## What to build

The catch-up flow. "Queue all visible" queues every Source Item in the current filtered view (respecting Classification filters and lifecycle state — only queueable items), from the sticky bottom action bar of the review-split layout (see the UI decision in the PRD). Download concurrency is limited to respect SoundCloud rate limits (the single-threaded task worker enforces 1; a config knob only if parallel workers ever land). Failed tasks are highlighted in the item list (filterable via a `failed` pseudo-filter in the sidebar) with error detail and retry in the detail panel.

Scope addition (from 05 review): **ignore for permanent failures**. DRM-protected (Go+) tracks fail forever — retry is useless. Failed (and new) items get an ignore action; ignored items can be restored to new. When the error mentions DRM, the UI suggests ignoring over retrying.

## Acceptance criteria

- [x] Queue-all-visible queues exactly the filtered, queueable set
- [x] Concurrency limit enforced across pending downloads (single-threaded worker = 1)
- [x] Failed items are discoverable via the sidebar failed filter; detail panel shows the error; retry re-runs the task and clears the failure on success
- [x] Failed and new items can be ignored; ignored items can be restored to new; DRM errors suggest ignoring
- [x] Bulk queueing, ignore/restore transitions, and retry covered at the module interface

## Blocked by

- 03-classification.md
- 05-download-end-to-end.md
