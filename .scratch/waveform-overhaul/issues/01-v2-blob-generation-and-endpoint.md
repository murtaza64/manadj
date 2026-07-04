# 01 — v2 blob generation, storage, and endpoint

Status: ready-for-agent

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
