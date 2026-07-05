# 04 — Tier ordering

Status: done — pending user eye-verify

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

## Comments

- Done (pypooqvy, lane followmode): ranking face in the follow model — `followTier` (proven 0 → same 1 → relative 2 → up 3 → down 4 → rest 5, wheel wrap at 12↔1, best tier via min across references) and `orderByTier` (stable sort: the view's own order holds within tiers; no references = no-op). Library filter+order applies only while following, to both the library list and the non-split playlist list. 6 new tests; engine-id literals audited against keyUtils. Tier numbering stays inside the model face (provisional per PRD). Gate: 530 pytest / 525 vitest / build / one head.
