# 06 — Fractional BPM breaks Follow's candidate query

Status: done — pending user eye-verify

## Parent

.scratch/follow-mode/PRD.md

## What to build

Bug found in eye-verify: following a Deck whose Track has a fractional BPM (e.g. 127.98) silently produced no narrowing — "no matches shown for B". The track-list endpoint declared `bpm_center: int`, so Follow's candidate query (which sends the reference Track's BPM verbatim) got a 422; the query never resolved, and the null-gating fell back to the unfiltered list. Latent since the one-shot era; Follow made it visible.

Fix: `bpm_center` is float at the router and in the crud signature — BPM is float BPM at every interface, centiBPM stays a column-unit detail (per the units module's doctrine).

## Acceptance criteria

- [x] `GET /api/tracks/?bpm_center=127.98&bpm_threshold_percent=4` returns 200 and filters correctly (regression test at the router seam)
- [x] Gate green

## Blocked by

None.

## Comments

- Done (lane followmode): router `bpm_center` int→float (+ crud hint), regression smoke test `test_list_tracks_fractional_bpm_center` (red at 422 before the fix). No frontend change needed — it always sent the float.
