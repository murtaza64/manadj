# 04 — Tier ordering

Status: ready-for-agent

## Parent

.scratch/follow-mode/PRD.md

## What to build

The follow model's ranking face: while following, the list is tier-ordered by candidate strength — proven, same Key, relative Key (10m→10d), one Key up (10m→11m), one Key down (10m→9m), then everything else that passed the filter. The tiering is explicitly provisional; keep it isolated in the model so changing it is cheap.

A Track qualifying under both followed references ranks by its best tier. The user's table sort orders Tracks within each tier — tiering never overrides it, only groups above it. Tracks outside every key tier stay in the list (catch-all tier); sorting never changes membership. Ordering applies only while Follow is on; normal browsing keeps the plain sort.

## Acceptance criteria

- [ ] Followed list ordered proven → same Key → relative → +1 → −1 → rest
- [ ] Dual follow: best tier wins per Track
- [ ] User's sort (e.g. BPM) orders within each tier and is untouched when Follow is off
- [ ] Catch-all tier: filter-passing Tracks with unrelated Keys appear last, not dropped
- [ ] Comparator tests: tier assignment per reference (proven via constructed index), best-tier-wins, within-tier stability under the user's sort
- [ ] Gate green

## Blocked by

- 03-proven-tier-folded-in
