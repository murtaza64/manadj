# 01 — Saturated hotcue slot colors everywhere

Status: ready-for-agent
Type: task

## Problem

Competing design language (found in the 2026-07-05 hotcue color audit):

- `WaveformRendererV2` (full-waveform poles/badges + minimap flags) uses a
  pastel Catppuccin slot palette (`HOT_CUE_COLORS` / `HOT_CUE_CSS_COLORS`)
  and IGNORES stored cue colors — the only surface that does either.
- Every other surface (pads via `HotCue.tsx`, OverviewLadder, sync views,
  DawTimeline, GlobalMinimap) renders the stored per-cue color first
  (saturated Engine hex, 2,517 of 2,548 cues have one) with saturated-ish
  fallbacks.
- The pad fallback vars themselves are mixed: `--yellow`, `--peach`,
  `--pink` are pastel while `--blue`, `--green`, `--red`, `--mauve`,
  `--teal` are saturated.

AGENTS.md: this project prefers bright, fully saturated colors. Verdict
(user, 2026-07-05): saturated everywhere.

## What to build

One saturated per-slot palette, and the renderer joins the stored-color
convention:

1. **Palette**: replace the pastel values in `HOT_CUE_COLORS` /
   `HOT_CUE_CSS_COLORS` (WaveformRendererV2.ts) with fully saturated
   equivalents, hue-preserving (1 blue, 2 yellow, 3 orange, 4 red,
   5 green, 6 pink, 7 purple, 8 teal). Mirror the same eight values as
   `--hc-1..--hc-8` custom props (variables.css) and point `HotCue.css`'s
   `cue-N.set` rules at them, replacing the mixed theme vars.
2. **Stored color wins**: `pushHotCues` and `renderHotCueNumbers` use the
   cue's stored color when present (renderer already receives and stores
   it), slot palette as fallback — the same precedence as pads and the
   OverviewLadder. Bad/absent hex falls back silently.
3. Fallback consumers (`OverviewLadder`) inherit the new palette via the
   existing export.

Out of scope: the main-cue yellow, deck colors, tag colors, theme vars
used by non-hotcue UI (`--yellow` etc. stay pastel for whatever else uses
them).

## Acceptance criteria

- [ ] Minimap flags, full-waveform poles, and number badges show the
      stored cue color when one exists; pads and waveform agree per cue
- [ ] Colorless cues (in-app-created) show the same saturated slot color
      on pads and waveforms
- [ ] No pastel hotcue color remains on any surface (pads slots 2/3/6
      included)
- [ ] Slot hues stay recognizable (1 blue … 8 teal)
- [ ] vitest + build green

## Blocked by

None - can start immediately.

## Comments
