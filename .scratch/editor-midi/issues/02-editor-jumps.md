# 02 — Editor jumps

Status: done

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

## Comments

- 2026-07-05 (edmidi lane): implemented in jj change `kwtmmlzq`. `jumps`
  section on the surface handle (beatjump deck+direction); shared surface
  delegates to deck beatjump; editor: A seeks the mix ±N of A's beats, B
  Slides ±N of its own beats (both via the shared per-deck size and the new
  pure `beatsToSeconds` in editor/gestureMath.ts, which the on-screen
  cluster now also uses). Beatjump-size stays registry-direct. Status →
  ready-for-human: HARDWARE SMOKE TEST — editor: jump buttons on A move the
  playhead by the size shown in A's cluster (both directions); on B they
  Slide B (playhead stays put); SHIFT+jump halves/doubles the size shown in
  the editor cluster and the change carries to Performance view.
  Library/Performance beatjump unchanged.
- 2026-07-05 (edmidi lane): hardware smoke tests verified by the user; closed (jj change `owmzxpnt`).
