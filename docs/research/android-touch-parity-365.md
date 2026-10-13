# Android touch design and desktop parity — #365 iteration 3

Support note for the native prototype author (lane
`android-performance-playable-phone-prototypes`). Code is the source of
truth; every claim below cites `frontend/src` on local `main`
(2aefcc32). Prototype paths cite `prototypes/android-performance/app/src/main/java/dev/manadj/phonelab/`
at author revision e5ab33aa (the gap table) unless noted; the author's
frozen iteration-3 head is bookmark `tmp/android-performance-365`
(e5cf4d6f), which already applies the corrections in the table (author
report, lane mail android-fable#6). Nothing here is implemented in this
lane.

## Parity gaps found in the prototype (iteration 2 source)

| Prototype | Desktop truth | Source |
|---|---|---|
| Per-deck ECHO toggle + DEPTH (`MainActivity.kt` Fx, `Deck.fxOn/echo`) | ONE Beat FX section: selected effect, radio target A/B/C/D/sampler/MST, ON gate, bipolar depth, beat ladder; per-channel state is an assignment flag | `playback/beatFx.ts` 21-34; `MixerStrip.tsx` 394-488 |
| DEPTH neutral 0 | DEPTH range -1..1, reset/default **-1 (dry)**; `BeatFxKeys` comment says "center" but code sets -1 | `MixerStrip.tsx` 471; `BeatFxKeys.tsx` 65 |
| CUE always previews from 0 (`Deck.cueDown`) | playing → return to cue + pause; paused at cue → hold preview, release stops at cue; paused elsewhere → set cue (Quantize snaps); PLAY during hold commits | `playback/transport.ts` 225-266 |
| Hotcue tap = jump (`Deck.triggerCue`) | paused + Gated: down launches from cue, up stops at cue; PLAY during hold commits; playing: jump keeps playing, phase-preserving with Quantize; unset slot: set at playhead | `transport.ts` 268-311; `hooks/useHotCueActions.ts` 68-92 |
| VOL default 0.8, linear | default 1.0, gain = v² | `DeckPanel.tsx` 979; `playback/mixerMath.ts` 28-31 |
| FILTER 0..1 neutral .5 | -1..1, neutral 0, ±0.05 audio bypass deadzone | `playback/graph.ts` 28, 47-58 |
| no TRIM | TRIM 0..1, 0.5 = -6 dB, range -18..+6 dB, "set-and-forget", smaller knob | `mixerMath.ts` 7-11, 33-37; `DeckPanel.tsx` 926-940 |
| loop default 8 beats, 1..128 | default 4, 1/8..128 dyadic | `playback/loop.ts` 27; CONTEXT "Active loop" |
| jump 1..128 default 32 | same | `playback/beatjump.ts` 8-10 |
| pitch 0.84..1.16 of BPM via knob | ±8 %, step 0.1, horizontal fader, right = faster, detent 0 | `playback/tempo.ts` 13; `DeckPanel.tsx` 985-999 |
| orange CUE key | orange is reserved: Main cue marker + machine (Conductor/replay) playhead | `DESIGN.md` 48, 75-86 |
| single deck-color envelope waveform | additive RGB 3-band body, pink playhead, tiered grey grid | below |

## Desktop waveform render map (for fake-analysis parity now)

Body, `waveform/WaveformRendererV2.ts` 404-448 + `waveform/styles.ts` 77-88:

- Per pixel column: `p` = hard-max peak, `g` = three group amplitudes from
  8 STFT bands (`groupAmps` 386-396: `sqrt(Σ b²)` per group, gains
  `[0.7, 1.05, 1.5]`, bounds `b1=3 b2=5`, soft-knee limit at 0.6, master
  0.85; minimap slot master 2.0, `waveform/styleSlots.ts` 33).
- Color is **additive** from `--void` `#0b0b0f`: inside low lobe add
  `(1,.1,.1)`, inside mid add `(0,1,.25)`, inside high add `(.2,.45,1)`,
  clamp. Low reads red, overlaps stack toward yellow/white. Mirrored about
  center (`yA = |uv.y-.5|·2`, 423).
- Fake data recipe: three per-beat envelopes (low = kick pulse, mid =
  sustained body, high = 8th-note hats); per column draw nested rects
  low ⊇ mid ⊇ high with additive blend.
- Playhead: `--playhead` `#f5c2e7`, 3 px, fixed at `PLAY_MARKER_FRACTION`
  0.25 of width; waveform scrolls under it (`theme/markers.ts` 211;
  renderer 1608-1619). Default window 20 s (`utils/waveformZoom.ts` 14);
  desktop perf rows 52 px (`PerformanceView.css` 64).
- Beatgrid, renderer 1357-1400: weak beats 1 px α .15 only ≥12 px/beat;
  bar tiers `BEAT_TIER_FULL` width `[2,2,2.5,3,3.5]` α
  `[.3,.38,.48,.6,.75]` (bar, 4, 8, 16, …), grey-white; a tier culls
  below 2.5 px spacing (`markers.ts` 146-164).
- Hotcue: 2 px pole full height in cue color; full wave flies a 16 px
  numbered square off the pole's top-right, number bold 12 px mono, ink
  `rgb(17,17,17)` (1710-1730, `markers.ts` 44-54); minimap 5×5 unnumbered
  (1589-1597). Palette `theme/tokens.ts` 72-81: 1 `#1e90ff` 2 `#ffd400`
  3 `#ff8800` 4 `#ff4455` 5 `#2ed573` 6 `#ff5cc8` 7 `#a855f7` 8 `#00cec9`.
- Main cue: `#ff9500` 2 px line + bottom triangle (minimap half-width 5,
  depth 8; full 12 % of height) 1467-1489.
- Loop: `#00f900` fill α .18, 2 px edges α .85 on full; minimap = 2 px band
  at the top edge only (`waveform/loopOverlay.ts`; renderer 1439-1465).
- Minimap: 30 px tall (`Waveform.css` 39-55), body ×0.65 brightness
  (`MINIMAP_BRIGHTNESS`), played portion left of the playhead gets a black
  wash α .55 that stops at a loop's start while inside it; marks draw above
  the wash at full brightness (1251-1276).
- Deck identity on desktop is chrome (row edge rails `perf-wave-row::before/after`,
  bordered deck tag), never body tint.
- Cue labels: desktop shows `label` on pads only (`components/HotCue.tsx`
  179-182); waveforms show numbers. Phone minimap: proposed number + label
  truncated to 6 chars in cue color beside the mini flag.
- Vertical center waves (dense): same model rotated 90°, time on y,
  playhead fixed 25 % from the top, future below; both decks identical.

## Gesture contract

### Position vs rate (jog question)

Variants considered:

- **A — waveform = position only.** Paused drag seeks; content follows the
  finger (desktop sign: drag right = earlier, `WebGLWaveform.tsx` 185-189).
  Playing + VINYL off = desktop scrub: pause on down, seek per move, resume
  on release (169-202). Playing + VINYL on = scratch: hold stops audio,
  movement scratches, release restores prior play/pause (CONTEXT "Vinyl
  mode"). Tap <250 ms without movement selects the deck; never seeks.
  Minimap tap/drag = absolute seek (`WaveformMinimap.tsx` 82-84).
- **B — bend strip.** One-thumb momentary surface beside PLAY: press left
  half = -2 %, right half = +2 % (`NUDGE_BEND_PERCENT`, `tempo.ts` 25;
  `DeckPanel.tsx` 699-704); horizontal drag from the touch point scales
  |bend| to ±8 % over 120 dp (`JOG_BEND_MAX_PERCENT`, `midi/jog.ts` 56).
  Any UP/CANCEL/pause → `setBend(0)`. Shows live bend % and effective BPM.
- **C — modifier-held waveform bend.** Second thumb holds a BEND/VINYL key,
  first drags the waveform with the desktop mouse-jog velocity filter
  (`mouseJog.ts` 88-119, 157-184).

Default: **A + B.** Rule: the waveform never changes rate, the strip never
changes position, so seek, scratch and bend are never ambiguous and release
cannot leave tempo bent (B's release path is a single unconditional
`setBend(0)`). C is keyboard-era (Shift+T exists because a keyboard has
modifiers); it needs two hands and a velocity filter whose release timing
(100 ms window + smoothing) is exactly the "tempo left bent" risk. Offer C
later only as a VINYL-off alternative if testers ask.

### Knob neutral notch

Port `mouseControl.ts` `moveKnob` 13-33 literally: tolerance .02 (bipolar
.04); approaching center lands exactly on it (`stopped`). Desktop escapes
only after a 160 ms pause (`KNOB_STROKE_PAUSE_MS`). Phone adds a distance
escape: `stopped → departing` after 160 ms pause **or** 16 dp further
travel. One `SegmentTick` on entering `stopped`, none while held there.
Double-tap knob → neutral (desktop double-click → `defaultValue`,
`MixerStrip.tsx` 119). Neutrals: EQ .5, FILTER 0, TRIM .5, DEPTH -1
(end stop, not a notch), XF 0, PITCH 0.

### Faders

Direct rail mapping (`HFader` 214-220): value = finger position along the
visible rail. Down on the handle (±16 dp) preserves grab offset; down on
the rail does nothing until 8 dp slop, then the handle jumps to the finger
and follows. No fine-mode expansion on full faders. Label on the handle
(319-328): `VOL`, `PITCH +1.3`, `X-FADER`. Double-tap handle → default
(VOL 1, PITCH 0, XF 0).

Open decision for the human: rail-drag-jumps (chosen, desktop parity) vs
handle-only grabs (safer against brushes, slower to reach). The 8 dp slop
is the compromise.

### Value wheel (jump / loop / FX beats)

Hold 350 ms on the value → horizontal detented wheel anchored at the
finger, 56 dp per detent, `SegmentFrequentTick` per detent, release of the
same pointer commits (`Confirm`); vertical escape >48 dp or CANCEL restores
the previous value (`Reject`). Ladders: jump dyadic 1..128 default 32;
loop 1/8..128 default 4; FX beats `[1/4,1/2,3/4,1,2,4,8]` (`beatFx.ts` 37).
½ / ×2 keys remain as tap and accessibility path; value carries slider
semantics.

### Haptics

Compose BOM 2025.04.01 (Compose UI 1.8) exposes the extended
`HapticFeedbackType` set. Map: pad/CUE down `VirtualKey`; notch entry
`SegmentTick`; wheel detent `SegmentFrequentTick`; commit `Confirm`;
cancel `Reject`; bend engage `GestureThresholdActivate`; hold-overlay open
`LongPress`.

## Layout

Mirrored channels (layouts 2, 3): knob column 48 dp wide, rows TRIM, HIGH,
MID, LOW, FILTER top→bottom on both sides (desktop: "habit controls never
mirror", `DeckPanel.tsx` 13-14; only knobs-vs-fader side mirrors); VOL
fader full column height, inward: `A [knobs][VOL] | center | [VOL][knobs] B`.
Center ≥96 dp: Beat FX in `MixerStrip` order — ON, SELECT (--- ECH RVB
FLG), [½] beats [×2], DEPTH, targets A/B/MST radio (A cyan, B pink). XF
horizontal below, detent 0.

Portrait budget at 360 wide: 192 dp of knobs+faders leaves ~158 dp center.
Height rule: 390×844 keeps five knob rows (240); 360×640 drops TRIM into the
pitch drawer (desktop itself ranks TRIM set-and-forget), giving a 192 dp
mixer band that matches the FX stack (48 + 48 + 96). Capture never below
48 dp; shrink art (32 dp) and labels instead.

Drawers: PITCH drawer = horizontal pitch fader ±8 detent 0 right=faster,
effective BPM 28 sp, SYNC, MATCH (=), KEYLOCK, VINYL, SLIP (desktop
`perf-mix-foot`, 1000-1120). GRID drawer = ◄ nudge ►, SET DOWNBEAT, ANCHOR
DROP, tap BPM (`deckControls/GridEditControls.tsx` 88-140). Drawers never
cover the other deck's transport.

Dense (800×360): top 48 dp row = two 30 dp minimaps with title 14 sp over
and BPM/pitch right; center mixer 312 dp flanked by two vertical scrolling
detail waves (mini flags + label text; numbered flags only ≥72 dp wide);
pads 2×4 outer; transport + bend strip + jumps bottom. Bottom margin:
Android cannot exclude the mandatory bottom gesture zone; either drop the
reserve (author's choice, CANCEL path rolls back) or fill it with a
non-interactive readout; never leave it blank.

Selected deck: 2 dp frame in deck color around every selected surface
(wave, pads, transport); unselected α .35 (desktop rails + `.focused`).
Every drawer/popover/browser header opens with a 20 sp deck-letter badge
filled deck color, dark ink. LOAD preselects the selected deck. Selection
never retargets a held control (`DjModel.chooseDeck` pending path, keep).

Readouts: title 16 sp bold deck color, BPM 20 sp bold, pitch 14 sp, time
14 sp mono; key borders 1.5 dp, 6 dp padding; radius 0; `--void` behind
waves, `--base` panels.

## Scope seams

- Decks as a list, selected = index, FX target enum already includes
  C/D/sampler; layouts take the first two. Four-deck is a layout change,
  not a model change.
- Orange reserved for Main cue and the machine playhead (Conductor,
  replay); recolor the CUE key (desktop uses `--warning` for jump-size,
  `deckControls.css` 85).
- Headphone cue/PFL/CUE MIX deferred: no PFL button on phone.

## Open decisions for the human

1. Rail-drag jumps to finger after 8 dp slop (recommended) vs handle-only.
2. Compact portrait drops TRIM into the pitch drawer (recommended) vs 44 dp
   rows with 48 dp overlapping capture.
3. Variant C (modifier-held waveform bend) deferred entirely vs shipped as
   a VINYL-off option.
