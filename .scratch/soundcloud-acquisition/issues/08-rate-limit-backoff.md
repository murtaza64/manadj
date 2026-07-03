# Rate-limit backoff for downloads and Refresh

Status: ready-for-agent

## Parent

`.scratch/soundcloud-acquisition/PRD.md`

## Problem

SoundCloud's API budget is ~600 requests per 10 minutes. Today a 429 is treated like any permanent failure: yt-dlp does 3 immediate retries and errors; the sequential worker then burns through the remaining queue, fast-failing every task. A bulk catch-up (~150 tracks × several requests each) will convert most of the queue to `failed` mid-run. Refresh has no retry at all — a 429 during likes listing is an unhandled 500.

## What to build

1. **Rate-limited ≠ failed.** `RateLimitedError` raised by the download handler when the yt-dlp error indicates 429/"Too Many Requests". Migration (`<NNNN>_<jj-short-id>`): add `attempts` and `not_before` columns to `tasks`. `run_pending` only picks tasks with `not_before <= now`. On `RateLimitedError`: task returns to `pending`, `attempts += 1`, `not_before = now + backoff` (5 → 10 → 20 min), real `failed` after ~5 attempts. On any 429, defer **all** pending download tasks (one cool-down for the type) so the worker doesn't fast-fail the rest.
2. **Pace the queue.** `[acquisition] download_delay_secs` in config.toml (default 3); worker sleeps between download tasks.
3. **yt-dlp retry options** for transient blips: `extractor_retries: 5` + exponential `retry_sleep_functions`.
4. **Refresh resilience.** urllib3 `Retry` adapter on the requests session (retry 429, exponential backoff, respect `Retry-After`).
5. **UI (optional).** Deferred tasks show as `pending`; nicety: "cooling down until HH:MM" from `not_before` in the detail panel.

## Acceptance criteria

- [ ] Tasks with future `not_before` are not picked up; backoff progression and exhausted-attempts-to-failed covered at the module interface
- [ ] A 429 defers the whole download queue instead of fast-failing it
- [ ] Refresh survives transient 429s
- [ ] Inter-download delay configurable; default 3s

## Notes

- Default delay 3s was assumed, not confirmed — cheap to change in config.
- Real-world repro: bulk catch-up or manual yt-dlp runs already hit this (~600 req/10 min, observed 2026-07-02).

## Blocked by

None - can start immediately
