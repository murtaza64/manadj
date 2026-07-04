# 01 — v2 blob generation, storage, and endpoint

Status: resolved (wfproto lane, 2026-07-04)

## Parent

`.scratch/waveform-overhaul/PRD.md`

## What to build

A Track gets style-agnostic Waveform data (ADR 0014, format v2 multi-resolution) generated, stored, and served: an alembic migration adds a BLOB column to the waveforms table; a new backend generation module absorbs the prototype pipeline (`scripts/proto_waveform_blob.py` is the reference implementation — ffmpeg f32le streaming decode, blockwise compute, vectorized peaks at hop 128, multires STFT band energies at hop 512 with windows 2048/1024/256 on shared frame centers, uint8 sqrt-gamma quantization, versioned header); the waveforms router serves the blob as `application/octet-stream` with `Cache-Control: immutable` + ETag, 404 until generated. Startup check that ffmpeg exists, with a clear error.

The old JSON columns/endpoint stay untouched (the old renderer still reads them until issue 04); the new column and endpoint are additive.

## Acceptance criteria

- [ ] Alembic migration (rev-id per convention: sequential number + jj short ID) adds the blob column; single alembic head
- [ ] Generation module produces a v2 blob for any library format including m4a/aac
- [ ] Endpoint serves the blob with immutable caching + ETag; 404 with a "not ready" detail before generation
- [ ] Committed synthetic fixtures: ~2 s tones at 50 Hz / 1 kHz / 8 kHz + an impulse click, in wav and m4a
- [ ] TestClient tests (per PRD testing seam, real internals, real ffmpeg): header fields correct; tone energy lands in the expected band and not neighbors; impulse spikes the peak channel at the expected bin; blob size matches duration/hop arithmetic
- [ ] A backend-generated golden blob is committed as a fixture for the frontend decoder tests (issue 03)
- [ ] `uv run -m pytest` green

## Blocked by

None - can start immediately

## Comments

**2026-07-04 (wfproto lane, change `rmzqotxl`)** — Implemented:
`backend/waveform_data.py` (module: `analyze`/`build_blob`/`generate_blob`/`decode_blob`/`ensure_ffmpeg`,
with an `on_progress` hook for issue 02); migration `0010_rmzqotxl` adds deferred
`waveforms.data_blob`; `create_waveform` also stores the blob (extra decode until 04/06);
`GET /api/waveforms/{id}/data` serves it with ETag + immutable caching and If-None-Match → 304;
ffmpeg checked at startup. Fixtures: tones 40 Hz/1.5 kHz/8 kHz + impulse, wav+m4a
(note: sub-band tone is 40 Hz — a 50 Hz Hann main lobe straddles the 60 Hz edge at window 2048;
ffmpeg's sine source outputs at 1/8 amplitude, fixtures use `volume=4` → −6 dBFS).
Golden blob at `frontend/src/waveform/fixtures/golden.wfb`. Full suite 445 passed;
ruff clean; single alembic head. One drive-by: the legacy router's `waveform_utils`
import went lazy — it was about to drag librosa into the test import chain (hygiene guards).

**Post-verify fix (2026-07-04, found by user)**: `analyze()` deadlocked on a real
library m4a that decodes successfully while emitting ~360 KB of AAC warnings — nobody
drained ffmpeg's stderr pipe, ffmpeg blocked at 64 KB, and the serial task queue wedged
behind it. stderr is now consumed on a daemon thread (capped at 64 KB for error
reporting). Verified against the offending file (0.37 s) and by the sandbox queue
draining to 987/992 (remaining failures = files missing on disk). Known wart: the
startup sweep re-enqueues permanently-failed tracks each restart (files might return;
revisit if the failed-task rows annoy).
