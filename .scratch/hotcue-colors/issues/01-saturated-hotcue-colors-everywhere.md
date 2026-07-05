# 01 — Saturated hotcue slot colors everywhere

Status: done (approved and landed, change puywxqvs)
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

**2026-07-05 — implemented (lane minimap-clarity, change puywxqvs), parked ready-for-human.**

- Palette (bright, hue-preserving): 1 `#1e90ff` blue, 2 `#ffd400` yellow,
  3 `#ff8800` orange, 4 `#ff4455` red, 5 `#2ed573` green, 6 `#ff5cc8`
  pink, 7 `#a855f7` purple, 8 `#00cec9` teal. Single hex source
  (`HOT_CUE_CSS_COLORS`); GL floats derived from it at module init;
  mirrored as `--hc-1..8` in variables.css for `HotCue.css` (GL can't
  read CSS vars — sync comment on both sides).
- Renderer stored-color honoring: `pushHotCues` + `renderHotCueNumbers`
  use the cue's `#RRGGBB` when valid (`CUE_COLOR_RE` guard), slot palette
  otherwise — same precedence as pads/OverviewLadder.
- Verified headless: deck with Engine colors (track 9) — minimap flags ==
  pad colors per cue; deck with colorless cues (track 942) — identical
  saturated fallback on pads and flags. No pastel hotcue values remain
  (grep-verified; `--yellow`/`--peach`/`--pink` untouched for non-hotcue
  UI).
- Gate: vitest 919, build + tsc + eslint clean.

**Verification walkthrough (lane app at http://localhost:5273):**

1. Performance view, load 9 on A (Engine-colored cues) and 942 on B
   (colorless in-app cues).
2. Deck A: pads 2-6 (cyan/amber/red/amber/red) match the minimap flag
   colors exactly.
3. Deck B: pads and flags both show the saturated slot palette (blue,
   yellow, orange, red) — no pastels anywhere.
4. Full waveform: cue poles + number badges use the same colors as pads.
5. Sets view → any set: OverviewLadder cue ticks unchanged for colored
   cues, saturated fallback for colorless ones.

**2026-07-05 — approved and landed** (verbal approval in-session). Related
bugfix landed alongside (change xqpwmtty): right-clicking a set pad to
delete no longer starts hold-to-preview playback (`HotCue.tsx` now gates
pointer down/up on the primary button; verified live headless — delete
fires, no playback, left-hold preview unaffected).
