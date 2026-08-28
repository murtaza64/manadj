# DESIGN.md — the manadj design system

Single source of token values: `frontend/src/theme/tokens.ts` (ADR 0037),
projected onto `:root` at boot by `installTheme()`. This file is the written
system: principles, semantic roles, element specs, and the rules that keep
them from drifting. Decisions D1–D12 (grilled 2026-08-26) are recorded in
gh#199.

## Principles

- **Dark only.** No theme switching.
- **Monospace everywhere**: `'UbuntuMono Nerd Font', monospace`, declared
  once on `body` (`FONT_MONO` in tokens for canvas `ctx.font`). Components
  inherit; never re-declare.
- **Bright, fully saturated accents** on mostly-neutral gray surfaces.
  Pastels rejected (one named exception: the transport playhead, below).
  Text is deliberately slightly cool (`#cdd6f4` family) on pure-gray
  surfaces.
- **Flat geometry** (D5): `border-radius: 0`. `50%` legal for genuine
  circles (knob dials, status dots). Any other rounding must be a named
  exception here. There are currently none.
- **Instant by default** (D9): no transitions on hover, engage, focus, or
  reveals. Anything animated must be a named exception here, using
  `--transition-fast (0.1s)` / `--transition-normal (0.15s)` only. Real-time
  state (playheads, meters, ghosts, waveform windows) is never animated.
  There are currently no named exceptions.
- **Interaction vocabulary**: transparent background, 1px accent border,
  accent text at rest; fill-with-accent + dark ink when engaged/hovered.
  (The `.btn` recipe; see Components.)

## Color roles

Values live in tokens.ts; this table is the meaning. UI code never
hardcodes a color literal — import the token (TS/canvas) or `var(--…)`
(CSS).

| Role | Token | Notes |
|---|---|---|
| App background layers | `--base` / `--mantle` / `--crust` | pure grays, descending |
| Canvas/waveform background | `--void` | waveform surfaces sit darker than panels |
| Panels, borders, inputs | `--surface0/1/2` | ascending elevation |
| Text | `--text` / `--subtext1` / `--subtext0` | primary / secondary / muted |
| Faint chrome, tick labels | `--overlay0/1/2` | |
| Interactive accent | `--accent` `#4a9eff` | selection, focus, generic actions. NOT Deck A's cyan |
| Success / active | `--success` `#00e676` | |
| Danger / error | `--danger` `#ff2d55` | |
| Warning | `--warning` `#ffcc00` | |
| Machine orange | `--orange` `#ff9500` | Conductor playheads, automation ghosts, alignment accent, Main cue |
| Transport playhead | `--playhead` `#f5c2e7` | the audible mix position; named pastel exception |
| Deck identity | `--deck-a..d` (+`-rgb`) | A `#00e5ff` cyan, B `#ff2d95` pink, C `#ff7a00` orange, D `#8f4dff` violet. **Deck colors mean decks** — never generic accent, never playhead |
| Routine accent | `--routine-accent` (+`-rgb`, `-ink`) | chartreuse `#a8ff00` |
| Hotcue slots | `--hc-1..8` | stored cue color wins when valid hex; resolution via `hotcues/palette.cueCssColor` only |
| Energy | `--energy-1..5` | |
| BPM/key coloring | computed HSL, `utils/displayColors.ts` | formula-driven, not flat tokens |
| Lane colors | `editor/laneColors.ts` | derived from deck anchors |

Deprecated, die with gh#200: `--sapphire --green --teal --yellow --red
--mauve --lavender` (migrate to semantic roles), `--blue` (→ `--accent`).

## Scales

| Scale | Tokens | Notes |
|---|---|---|
| Type (D1) | `--font-micro 9 / -small 11 / -body 12 / -large 14 / -title 16 / -display 24` | 7/8/10/13px abolished; knob labels → micro. Weights: 400 and 700 only |
| Spacing (D8) | `--space-2/4/6/8/12/16/24` | 2px grid. Legacy `--space-xs..xl` die with gh#200 |
| Radius (D5) | `--radius: 0` | see Principles |
| z-index (D8) | `--z-sticky 100 / -overlay 1000 / -modal 2000 / -toast 3000` | cross-component layers only; local stacking keeps raw 1–5 |
| Motion (D9) | `--transition-fast / --transition-normal` | named exceptions only |

## Playhead identity registry (D6)

Every playhead color is a meaning. Adding a playhead means picking a row,
not a color.

| Identity | Token | Meaning | Surfaces |
|---|---|---|---|
| Transport | `--playhead` | the audible mix position | GL waveforms, `.editor-playhead`, GlobalMinimap |
| Machine | `--orange` | machine playback: the Conductor's position (editor + Set ladder) and session-replay position | ConductorLanePlayhead, OverviewLadder conductor, SessionTimelineView replay |

Never a playhead: deck colors, `--accent`, white (reserved for
selection/marquee chrome).

## Domain element specs (D11)

Shared draw helpers/tables: `frontend/src/theme/markers.ts` (gh#201).

| Element | Spec |
|---|---|
| Waveform body | GL: `WaveformRendererV2` + `waveform/styles.ts` style slots (`full`/`minimap`). CPU: `sets/ladderWaveStyle.createStyledColumnRenderer` (deliberate port, test-guarded). No other waveform implementations. Background `--void`; minimap dim `MINIMAP_BRIGHTNESS = 0.65`; audibility/gain fill = deck color at alpha 0.16 |
| Hotcue flag | 2px full-height pole + flag. Variants: `full` (16px numbered square, ink `rgb(17,17,17)`, number `--font-micro` bold) and `mini` (5×5, unnumbered). Color via `cueCssColor` (stored-hex validation) — no surface grows its own fallback. PerfDiffViewer exception: source-based coloring (diagnostic), shared geometry |
| Main cue | `--orange` 2px line + bottom triangle. Same orange family as Machine — geometry disambiguates (D11: chosen over recoloring) |
| Beatgrid / hypermeter | tier tables as data: `full` (GL widths/alphas) and `dim` (lane guides). All beat-domain surfaces render tier-aware — dropping hypermeter silently is a bug |
| Loop region | `waveform/loopOverlay.ts`: `#00f900`, fill alpha 0.18, edges on full, 2px top band on minimaps. Session-history loops: deck-color brackets (intentionally distinct: history, not live state) |
| BPM/key/energy badges | `KeyDisplay` / `BPMDisplay` / `EnergySquare` components; coloring only via `utils/displayColors.ts` |

## Components

- **Buttons are CSS classes** (D10): `.btn` + `.btn-primary/-success/
  -danger/-secondary` in `styles/utilities.css`. New buttons use `.btn`;
  new variants are added to utilities.css, never hand-rolled in feature
  CSS.
- **Modals use `<Modal>`** (gh#202): overlay, centering, escape/backdrop
  close, `--z-modal`, title bar.
- No other primitives until a third duplication appears (D10).

## Exemptions (D12)

- `frontend/src/visualizer/presets/**` — generative art; palettes are
  content, not UI.
- Pre-mount boot splash (`index.html`) and Electron splash
  (`desktop/main.js`) — render before `installTheme()`; literals by design.

## Rules for agents

1. No new color literals in UI code (CSS or TS/TSX) outside the exemptions.
   Reach for a semantic token; if none fits, add one.
2. Canvas/GL code imports tokens from `theme/tokens.ts` (hex, or
   `hexToGlFloats`) — never re-type a value, never read CSS vars from draw
   code.
3. Adding a token: constant + `CSS_VARS` entry in tokens.ts, a row in this
   file, done — `installTheme()` picks it up. If the backend must mirror
   it, extend `tests/test_design_token_mirrors.py`.
4. New font sizes, spacings, z-indexes, radii, transitions: don't. Use the
   scales; propose a scale change here if reality genuinely doesn't fit.
5. Hotcue color resolution goes through `cueCssColor`. Playhead colors come
   from the registry. Deck colors mean decks.

## Migration status

| Step | Issue | Scope |
|---|---|---|
| 1 | gh#199 (landed) | tokens.ts, installTheme, this file |
| 2 | gh#200 | palette collapse + scale adoption across stylesheets (the visible sweep) |
| 3 | gh#201 | markers.ts: cue flags, tier tables, playhead registry adoption, waveform surface unification |
| 4 | gh#202 | `.btn` fold + `<Modal>` |
| 5 | gh#203 | inline-style long tail, ruler helper, deprecated-token removal audit |

Step 2 deleted the legacy tokens (`--font-xs..xl`, `--space-xs..xl`, the
deprecated accents) and retuned `--transition-fast/-normal` to their D9
values (0.1s/0.15s). Proposed D9 exceptions awaiting a ruling (kept in
code, flagged in the gh#200 walkthrough): Toast enter animation, waveform
ghost dim (`.waveform-dimmed`), visualizer chrome auto-hide fades.
