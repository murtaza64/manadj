# 02 — Editor jumps

Status: ready-for-agent

## Parent

`.scratch/editor-midi/PRD.md`

## What to build

The jumps gesture class, mirroring the editor's on-screen ◀/▶ cluster:

- Beatjump joins the surface handle's gesture classes; the shared surface
  delegates to today's deck beatjump.
- Editor: deck A's jump buttons seek the mix ±N of A's beats; deck B's
  Slide B by ±N of its own beats (sketch edit; the playhead's mix position
  never moves).
- SHIFT+jump (beatjump-size halve/double) stays shared-direct — it already
  feeds the editor's gesture cluster through the shared per-deck size.

## Acceptance criteria

- [ ] Library/Performance beatjump unchanged
- [ ] Editor: A jumps the mix by the shared size in A's beats, both
      directions; B Slides by its own beats, both directions
- [ ] SHIFT+jump still halves/doubles the size shown in the editor cluster
- [ ] Dispatch + fake-surface routing tests; pure jump/slide delta math
      under vitest
- [ ] typecheck, eslint on touched files, vitest green

## Blocked by

- 01-gesture-class-handle-pads
