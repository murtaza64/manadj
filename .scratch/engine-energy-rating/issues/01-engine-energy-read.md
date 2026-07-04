# Energy read from Engine — divergence and per-cell import

Status: closed (implemented change rlntlqus)

## What to build

The Engine DJ Surface starts carrying the Energy field, decoded from Engine's star rating (rating 20/40/60/80/100 ↔ energy 1–5; rating 0 or NULL = no energy). The encoding knowledge lives in the enginedj package, like the performance-data decoders.

With the field carried, the existing sync machinery does the rest: energy joins the scalar divergence comparison against the Engine Surface, the sync view shows Engine's value in the energy row, and the per-cell "← import" appears in the Engine DJ column wherever Engine has a value the Library could take (the frontend already treats energy as an importable field).

A rating that is not an exact multiple of 20 (hand-edited DB, other tools) decodes to the nearest star, clamped to 1–5.

## Acceptance criteria

- [ ] enginedj package exposes the energy↔rating mapping in one place, both directions
- [ ] Engine surface reader carries `energy` decoded from Track.rating; 0/NULL decode as absent
- [ ] A track whose Library energy differs from Engine's decoded energy shows as Diverged on the Engine surface
- [ ] Per-cell import from the Engine column sets the Library track's energy
- [ ] Aggregator-seam tests (fake surface readers) cover: equal, diverged, Engine-absent (rating 0/NULL), Library-absent (importable)
- [ ] Unit tests for the mapping incl. non-multiple-of-20 rounding and clamping
- [ ] Typecheck and full test suite pass

## Blocked by

None - can start immediately

## Comments

**2026-07-04 — Done** (jj change `rlntlqus`). `enginedj/ratings.py`: `rating_to_energy` / `energy_to_rating` (star = rating/20, 0/NULL = absent, half rounds up, clamp 1-5; 13 unit tests). `EngineSurfaceReader` carries `energy` decoded from `Track.rating`. 3 aggregator-seam tests (diverged/unrated-not-importable/empty-library-importable); per-cell import needed no frontend work (energy already in `IMPORTABLE_UI_FIELDS`, surface-agnostic). Real-DB dry-run: 994 tracks decode to {None: 871, 3: 43, 4: 58, 5: 22}, matching the raw rating distribution exactly.
