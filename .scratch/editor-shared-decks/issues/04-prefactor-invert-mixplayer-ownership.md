# Prefactor: invert MixPlayer's ownership

Status: ready-for-agent

## Parent

`.scratch/editor-shared-decks/PRD.md` (ADR 0022)

## What to build

Pure refactor, zero behavior change: MixPlayer stops constructing its own
Mixer and DeckEngines. The Transition editor constructs them (still the
private pair, still the editor pitch range, still registered with the
routing store and the audible-surface arbiter exactly as today) and
injects them into MixPlayer. MixPlayer's dispose stops disposing what it
no longer owns; ownership and lifecycle live with the editor's
mount/unmount effects (StrictMode discipline: setup/cleanup pair in
effects, never constructor/dispose).

This shrinks the swap slice (issue 05) to "inject different objects +
lifecycle hooks + deletions."

Respect existing seams: MixPlayer keeps its deterministic mix timeline on
the injected mixer's audio clock, drift sync, jump-crossing detection,
lane application, and tempo-match pitch — all unchanged.

## Acceptance criteria

- [ ] MixPlayer constructs no Mixer and no DeckEngines; it receives them
- [ ] Editor behavior byte-identical: audition, mute overrides, Slides,
      jump events, routing registration, arbiter claim/release all work
      as before (existing tests stay green unmodified in intent)
- [ ] Dispose/lifecycle survives StrictMode double-mount (no zombie
      registration, no orphaned live instance)
- [ ] Full gate green

## Blocked by

None — can start immediately.
