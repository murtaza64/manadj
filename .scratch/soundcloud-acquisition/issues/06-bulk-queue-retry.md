# Bulk queue, failure/retry UX, concurrency limit

Status: ready-for-agent

## Parent

`.scratch/soundcloud-acquisition/PRD.md`

## What to build

The catch-up flow. "Queue all visible" queues every Source Item in the current filtered view (respecting Classification filters and lifecycle state — only queueable items), from the sticky bottom action bar of the review-split layout (see the UI decision in the PRD). Download concurrency is limited per config (default 1–2) to respect SoundCloud rate limits. Failed tasks are highlighted in the item list (filterable via the sidebar's `failed` state count) with error detail and retry in the detail panel.

## Acceptance criteria

- [ ] Queue-all-visible queues exactly the filtered, queueable set
- [ ] Concurrency limit enforced across pending downloads
- [ ] Failed items are discoverable via the sidebar state filter; detail panel shows the error; retry re-runs the task and clears the failure on success
- [ ] Bulk queueing, concurrency bound, and retry covered at the module interface

## Blocked by

- 03-classification.md
- 05-download-end-to-end.md
