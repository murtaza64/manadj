# 04 — Grid candidates: madmom DBN, beat_this, TempoCNN cross-check

Status: ready-for-agent

## Parent

.scratch/native-analysis-accuracy/PRD.md

## What to build

Additional Stage-1 grid candidates behind the interface from issue 02, all sharing the same constant-fit stage and scoring: madmom DBN beat tracker (required), beat_this (optional — skip with a note if install/runtime is painful on this machine), and TempoCNN as a tempo-only cross-check column in the report (no phase, not a grid candidate).

## Acceptance criteria

- [x] madmom DBN candidate scored by the same harness command
- [x] beat_this scored or explicitly skipped with reason recorded in this issue
- [ ] ~~TempoCNN tempo agreement reported as a cross-check column~~ SKIPPED: no TF-enabled Essentia build on this machine; pip tempocnn needs old TF on py3.13 (see Done comment; three-tracker agreement triangulates instead)
- [x] Heavy deps (madmom, beat_this) absent from the app import chain (guard passes)

## Blocked by

- 02

## Comments

**2026-07-05 (agent, lane `analysis`, change qpxwvwpl)** — Done. 100-gold-track results:

| candidate | ok | bail | half/double | wrong | phase median | ≤10ms | ≤25ms |
|---|---|---|---|---|---|---|---|
| **madmom_dbn** | **97%** | 2% | 1% | 0% | **3.2ms** | 80/95 | 91/95 |
| beat_this | 85% | 15% | 0% | 0% | 10.4ms | 41/84 | 80/84 |
| essentia_rhythm2013 | 43% | 26% | 30% | 1% | 18.3ms | 15/42 | 32/42 |

madmom DBN is the presumptive winner: matches Engine within 0.05 BPM on 97/100, phase within 10ms on 84% of scored tracks, no wrongs. Its 2 bails ("not constant-tempo") + 1 half_double go to issue 06's failure review.

Real data forced fit upgrades (shared stage, all candidates benefit — essentia rose 27%→43%): (a) period seeded from the longest base region, never a start-anchored walk (intro wander biased the period 0.1%, smearing phase across long regions — regression test added); (b) two-pass conform-and-refit growing the region to the full track; (c) second quantization gate on the final grid's conforming fraction (catches 174→180-style steps the running-mean regions absorb); (d) per-candidate FitParams — beat_this emits 50fps frame-quantized beats needing region_tolerance 0.10 (its ~6% interval wobble at 175 BPM), while a loose default hurt clean trackers.

**TempoCNN cross-check: skipped** — this Essentia build has no TensorFlow support (`es.TempoCNN` absent) and the pip `tempocnn` package needs old TF on py3.13. madmom's own tempo histogram could substitute if issue 06 wants a second opinion; the three-tracker agreement already triangulates. beat_this required `torchaudio==2.9.1` pin (resolver picked 2.11 against torch 2.9.1 — broken ABI) and installs from git; model checkpoint cached at `~/.cache/torch/hub/checkpoints/beat_this-final0.ckpt`.

**2026-07-05 (agent, post-review)** — Review fixes: heavy-dep guard lists extended with torch/torchaudio/beat_this (were vacuously passing for the new deps) and import-hygiene now also imports the harness pure modules; stale fit docstring rewritten (described the removed circular-mean algorithm); the two "not constant-tempo" bail reasons disambiguated (region vs conform coverage) and residual-bail evidence reports conform coverage — issue 06's failure review can now tell which gate fired; min-ticks fallback restructured (bail on too-few-conforming rather than proceeding on scraps); candidate registration unified (one dict per module). All three candidates re-scored from caches: numbers unchanged.
