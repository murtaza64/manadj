# Native iteration 2 — upfront design contract

OpenAI gpt-6-astra, support collaborator. Implements the human's iteration-2 handoff, not the previous cockpit. Author owns native code/emulator; support owns this proposal. No landing. Region maps sent to author before this document.

**Latest human scope correction:** publish APK + brief usage notes only. Prior requests below for fresh frames, galleries or recordings are superseded as deliverables/gates. Captures are optional implementation/debugging aids; do not produce or refresh them for handoff. Continue existing interaction fixes and targeted verification without delaying the APK for presentation artifacts. Routine author-directed findings use passive mail; wake parent only for ready-for-human closure, orchestration blockers or genuine user decisions.

## Common decisions

- OLED `#000000` canvas; neutral-black control wells, saturated manadj accents, Ubuntu Mono, square structural edges. Round **knobs** are instruments, not rounded cards. Selected deck gets a bright identity spine, `A SELECTED`/`B SELECTED` label and matching control headings; playing remains a separate indication.
- A stays left/top, B right/bottom. Selection never moves instruments, retargets a captured finger, stops playback or transfers active FX.
- Immersive system bars, no app title strip. Top is waveform content from the safe cutout boundary. Reserve the actual bottom gesture exclusion/inset; do not draw PLAY under the home gesture. Transient system bars overlay rather than rearrange instruments during a gesture. Recompute composition on rotation after cancelling captures.
- No page scroll. INFO contains explanations and layout chooser, reached by a 48dp control integrated into the waveform header. Browse may scroll within its own surface.
- Use **actual usable bounds**, not device screenshot dimensions. Baseline portrait example: 360×640, no cutout and 24dp bottom reserve → 360×616. Keep bottom controls anchored; excess height grows waveform visibility and control travel, not chrome.

## 1 — waveforms / dual workspace / dual transport

| Region, top to bottom | 360×616 budget | Contents |
|---|---:|---|
| Waveforms | 96 | A and B strips, 48 each; title/BPM/key in each strip, fixed playhead and scrolling waveform. Tap selects; explicit LOAD affordance opens browse. |
| Workspace selector | 48 | PADS / MIX / FX; no JUMP page. INFO/layout control stays in top region. |
| Workspace | 360 | Always two deck columns, A left/B right. |
| Transport | 112 | Two fixed deck columns: CUE/PLAY 48; 8 gap; jump back/size/forward 48; 8 bottom breathing room. |

Thumb-reachable browsing takes priority over the author's optional footer pitch: first row CUE/PLAY/LOAD, three60dp cells per180dp deck, with48dp height. Pitch stays in the workspace here; layout2's full-width selected footer and landscape can also fit PITCH. Do not add a third footer row or squeeze four targets into180dp. Jump row is48/84/48dp per deck. Top LOAD remains a shortcut, not the only browse entry.

- PADS: **all eight per deck**, two columns × four rows per deck; 24dp noninteractive deck heading, 4dp gutters, remaining height divided into rows (about 80dp). No A/B switching or paging. Empty pad says `SET`, loaded pad shows number/name; do not hide destructive editing in a performance hold.
- MIX: both decks visible; each half has EQ HIGH/MID/LOW + FILTER as 2×2 knobs beside a vertical channel fader. Knob glyph ~28–36dp, capture region ≥48dp. Crossfader is a 48dp row inside MIX only. Use remaining height for channel-fader travel, not extra actions.
- FX: both deck FX states/controls in fixed columns. Selecting the other track never transfers an active effect. No permanent XF outside MIX.
- Loop access can occupy a named workspace; beat jumps remain integrated in the footer regardless of workspace.

## 2 — persistent dual mixer / all selected-deck tools

| Region, top to bottom | 360×616 budget | Contents |
|---|---:|---|
| Waveforms/selection | 96 | A above B; tap selects without moving either. |
| Persistent mixer | 176 | 128 dual-channel area + 48 XF. Each ~180dp channel: 2×2 EQ/filter capture cells in ~120dp width, ≥48dp channel fader beside them. |
| Selected tools | 232 | Ownership heading 32 + eight pads 4×2 at48 (96) + loop row48 + FX row56. |
| Selected transport | 112 | Large selected-deck CUE/PLAY plus integrated jump row. Label the deck on the buttons, not solely the heading. |

- No tool tabs. Loop row: halve / length+ON / double / momentary ROLL. FX row: effect selection / ON / depth knob / length. Detailed choices expand from their own control; their current state remains visible.
- The **mixer always operates both decks**; pads/transport/loop/FX in the selected region operate only the labelled deck. Selection applies after current captures release. Whole-region identity update is immediate and unmistakable; no sliding A/B panel that suggests physical decks swapped.
- This comparison intentionally trades simultaneous two-deck pads/transport for persistent mixing. Do not quietly turn it into layout 1 with more tabs. The feedback explicitly requests selected-deck controls here; no extra user question needed.

## 3 — all-visible landscape instrument

Baseline **usable height 336dp**: waveforms48 + instrument area192 + transport96. At800dp width, use 8dp outer gutters: **A236 / mixer312 / B236**. If left/right cutouts reduce usable width, shrink side columns only, never below204 each; minimum usable width728 including gutters.

| Column | Instrument area, 192dp high |
|---|---|
| A / B, each ≥204 wide | Eight pads in4×2 at48 high (96); four loop controls at48 (48); four FX controls at48 (48). |
| Mixer, 312 wide | Two156dp channels: four EQ/filter knobs in2×2 within104dp width, adjacent48dp-wide channel fader; total144 high. Full-width XF48 below. |

- Top48: A/B waveform halves with title/tempo and selection affordance; no title bar. Bottom96: each deck's CUE/PLAY row48 plus jump back/size/forward row48. A/B always occupy the same halves.
- Touch cells can abut vertically; artwork has internal breathing room. Small circular knob artwork **does not shrink the capture cell**. All major actions/values visible, menus only for choosing effect/length/jump size or precision. No bank tabs, no “tap a deck to reveal its other half.”
- The layout is genuinely feasible at728×336 usable; **not** at arbitrary smaller bounds. Below that floor, explicitly offer another composition/orientation rather than shrink targets. Expansion improves precision, not hit-target capacity. Font1.3 keeps numerical values and short labels; extra explanatory text belongs in INFO.

## Gesture and motion decisions

| Interaction | Contract |
|---|---|
| Knob/fader | Down captures original control+deck/value; no absolute jump, including fader track. Relative vertical drag begins after ~4dp slop; permit travel beyond the cell. Show immediate pressed halo and value. |
| Precision | Stationary hold ~350ms (preserve tested timing) expands a local instrument/readout above or beside the finger. Keep the originating control/ghost visible; choose a safe placement avoiding bottom transport and finger. Same pointer continues at ~3.5× finer gain, rebased on mode entry/reset. No scrim or global input grab. |
| Release/cancel | UP commits continuous edits; CANCEL/background/rotation restores touch-down value and releases momentary actions. Independent fingers retain their own ownership/readouts; queued selection/load cannot retarget them. |
| Expansion motion | 120–160ms anchored growth from source instrument to precision surface, with a short ease-out and no bounce. Instrument value follows input immediately throughout; animation must not delay ownership or change sensitivity. Collapse ~100ms to origin. Reduced motion uses immediate reveal. |
| Press response | CUE/pads illuminate on DOWN; momentary state follows finger exactly. PLAY command updates immediately, glyph transition ≤80ms optional. Haptics only on explicit trigger/neutral entry; never on every move. |
| Jump size | Tap the size opens a deck-labelled compact picker containing1/2/4/8/16/32/64/128; chosen size remains visible. Arrow taps jump immediately by that size. No long-press-only route to128, no JUMP page. |
| Waveforms | Fixed playhead, cached deterministic sample envelope scrolling underneath at display cadence from monotonic transport time. Paused stays still. BPM, loops and jumps update the same transport clock, not an unrelated animation. |
| Discontinuities | Jump/cue/load updates musical position immediately; show a brief old-position ghost/landing accent (~100ms), never animate a pretend traversal through skipped audio. Loop wrap uses the same clock and visible loop boundaries. |
| Workspace change | Layout1 only: content crossfade/short reveal ≤120ms, bottom controls absolutely stationary. Layout2/3 have no bank transitions. |

Meaningful motion is an explicit **mobile prototype** choice from human feedback, not a change to desktop DESIGN.md. Avoid ornamental bounce, delayed transport, and continuously animated chrome. Assess feel from an actual recording/device trial; screenshots only establish geometry.

## Browse/load without abandoning the mix

- Explicit LOAD A/LOAD B opens a black native sheet over the central tools; top playback display and bottom transports remain visible. Header shows destination deck and current track. List rows ≥56dp with title/artist, duration, BPM/key and small distinctive waveform; list scroll is confined to the sheet.
- Several complete fake tracks, not aliases of one image: deterministic envelopes, different duration/BPM/key and named cue/loop landmarks. Loading replaces metadata, envelope and timeline together; paused at cue0 by default. No network or full DSP needed; silence is acceptable and must not masquerade as newly loaded audio from the old synth.
- Tap a row selects a candidate; explicit `LOAD A`/`LOAD B` commits. If destination is playing, turn that action into `REPLACE PLAYING A` with a second deliberate confirmation; do not interrupt the other deck. A held gesture delays replacement. Dismissal changes nothing. After load, sheet closes and new track is selected; physical deck locations stay fixed.

## Collaboration checkpoint

Author: send early mounted frames of all three compositions, **before** polishing every control, plus a short native clip of one relative knob→precision gesture and waveform play/jump. Include usable dp bounds/insets. Support will check spatial feasibility, static identity, thumb access and motion against these maps, not open another broad feature review. Author retains emulator ownership; support needs no duplicate app/prototype or tooling installation.

### First-frame checkpoint

Read author `.lane-tmp/iteration2-{workspace,mixer,dense}.png`; feedback delivered in author mail #43–44 while implementation is in progress.

- Workspace frame obscured by Android's first-use fullscreen education; recapture before judging layout. Not an app fullscreen failure.
- Mixer: keep native knobs/faders. Toolbar plus waves currently consume approximately168 screenshot pixels; compact allocation is96dp including metadata (plus any genuinely spare usable height). Reclaim chrome before compressing pads/loop/FX.
- Layout2 currently mixes selected A tools with dual-deck footer. Use a single, explicitly deck-labelled selected footer; both mixers remain persistent. Show selection at waveform, tools and footer.
- Dense: current top region approximately105 screenshot pixels. Instrument192 + footer96 leaves48 at336 usable, or72 at360 usable. Widen mixer to312; separate loop/FX rows at48 each, rather than tiny depth alongside loop controls.
- Preserve thumb LOAD: layout1 footer CUE/PLAY/LOAD, pitch in workspace; layout2/landscape have room for both. Top LOAD is supplementary.
- Native motion clip not yet supplied; no fluidity/performance verdict. Next checkpoint: unobscured corrected frames, tall-portrait LOAD location, waveform/jump/precision clip. No emulator access by support.

### Second checkpoint

Fetched current staged `iteration2-workspace-{360,390}`, `mixer-360-font130`, `dense-800{,-font130}`, precision/browse/replace/loaded PNGs. Downloaded 40.07s `iteration2-motion.mp4` and inspected sampled frames alongside current Compose source. Recording has no audio stream; encoded frame rate is not an app-render benchmark. Author reports14 behavior tests; geometry/rotation verification remains in progress.

Dual pads/mixer, selected footer, bottom LOAD, scrolling fake tracks and guarded playing-track replacement now appear in the native artifacts. Concrete feedback sent to author #45:

1. `Loops` uses1:2.6:1 widths: halve/double approximately36dp at360 portrait,40dp at390. Make sides48dp and give center the remainder. Check both hit dimensions.
2. Selection remains a2dp waveform underline and deck prefix. Use `A SELECTED`/`B SELECTED` in the existing heading/badge; request a B-selected frame.
3. Pads still call generic click-on-release. Trigger hotcue once on DOWN, with no repeated trigger on UP; preserve separate deliberate edit/load buttons.
4. Hold currently reveals a numeric popup, not an expanded instrument. Add enlarged knob/track with brief anchored reveal; gesture capture/value remains immediate. Generic button release scaling does not establish the requested precision motion.
5. Below dense floor, source renders36dp loops/40dp FX despite the warning. Replace that miniature fallback with an explicit rotate/layout choice, preserving safe transport. Calculate the threshold after cutout/gesture-safe insets, not raw window bounds.

No emulator interaction. These are corrections to supplied layout/feel constraints, not new feature scope; next checkpoint is author dispositions and targeted frames/motion.
