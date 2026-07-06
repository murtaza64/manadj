# 40 — TopBar audio-ownership chip

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md (grilled 2026-07-06 — decisions below are settled, do not re-litigate)

## What to build

One persistent chip in the TopBar (global chrome, above the view
switch) answering "who owns the decks/audio right now — and what will
my next transport gesture drive". Primary job: make the next gesture's
consequence legible (34's stateful spacebar + 37's mounted-editor-over-
live-set make this pure hidden state today); secondary: ambient
"conductor is active" visibility from any view.

## Decisions (grilled 2026-07-06)

- **Three faces**, driven by `audibleHolder()` + conductor state:

  | State | Chip |
  |---|---|
  | Conductor playing | `▶ SET <set name>` |
  | Conductor paused | `⏸ SET <set name>` — a paused Conductor still holds the claim (ADR 0024); the chip must not hide it |
  | Editor audition sounding | `AUDITION` (pair label if cheap) |
  | Shared (manual decks) | muted `DECKS` |

- **Always present** (muted when shared): a fixed location you learn to
  glance at; no layout shift; the muted→colored flip is itself the
  takeover/stand-down signal.
- **No extra state** for "editor mounted but silent over a live set" —
  the chip reading `▶ SET …` while you stand in the editor IS the
  warning. Three faces, learnable.
- **Navigate-only interaction**: click `SET` → select/scroll to the
  conducting set in the Sets view; click `AUDITION` → editor. Never a
  transport control — 34/36(now 39) just gathered transport; a global
  pause button in chrome re-scatters it and invites destructive
  fat-fingers.
- **Tooltip carries the next-gesture consequence** ("Space pauses this
  set" / "Play in the editor will silence this set").
- **Out of scope (follow-up candidate)**: a one-shot toast on
  system-initiated stand-down (24's anchor-gone reorder) — the one
  ownership change with no audible edge and no user transport gesture.

## Acceptance criteria

- [ ] Chip visible in every view, same TopBar slot, no layout shift across faces
- [ ] Conducting (playing or paused) shows the set's name; manual decks show muted DECKS; sounding audition shows AUDITION
- [ ] Takeover / stand-down / displacement flip the chip live (subscribeAudible + useConductorState)
- [ ] Click navigates to the owner (set view selection / editor); nothing on the chip changes audio
- [ ] Tooltip states what space/play will do in the current context

## Notes

- Everything needed is landed: `audibleHolder`/`subscribeAudible`
  (playback/audibleSurface.ts), `useConductorState` (setId + status),
  set name via the `['sets']` query. TopBar is App-chrome — additive
  mount, coordinate via `.lanes/` (App.tsx hotspot rule).
- Bright, fully saturated colors per repo convention.
