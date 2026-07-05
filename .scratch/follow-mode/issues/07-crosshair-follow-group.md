# 07 — Crosshair follow group: ◎ [A][B][⚙]

Status: done — pending user eye-verify

## Parent

.scratch/follow-mode/PRD.md

## What to build

Eye-verify feedback: the ⟲ glyph read as "reload", and the summary chips shifted layout as Follow spread/dropped. Rework the FilterBar Follow group to the bar's standard idiom — a leading 16px icon, then controls:

- New `CrosshairIcon` (ring + ticks + center dot): the list is locked onto the playing Deck. Chosen over a magic wand, which reads as a one-shot "cast" — closer to the retired Find Compatible than to a mode that rides playback.
- `[A][B]` fixed-width toggle buttons (green while following). The derived summary moves into their tooltips ("Following Deck A — deriving: 10m·128±4%") — no layout shift as Follow state changes.
- `[⚙]` (existing SettingsIcon) always present, opens the Follow parameters modal. Replaces the per-deck summary chips and the ⟲… fallback chip.

## Acceptance criteria

- [x] Follow group renders ◎ [A][B][⚙] with no width changes as follow state or references change
- [x] A/B tooltips carry the per-deck derived summary while following
- [x] Gear opens the parameters modal regardless of follow state
- [x] Gate green

## Blocked by

None.

## Comments

- Done (mprnvzsp, lane followmode): CrosshairIcon added to icons.tsx; FilterBar group reworked; summary chips removed (`followSummary` now feeds tooltips + the modal's context rows). Gate: 531 pytest / 551 vitest / build / one head.
- Follow-up (ptqrpwqw): the shared SettingsIcon gear reads as a sun/spark at 14px — params button now uses a new `SlidersIcon` (three mixer faders); gear untouched for its other user (TagEditor).
