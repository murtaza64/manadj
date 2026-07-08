# PRD: Minimap clarity

Status: ready-for-agent
Date: 2026-07-05 (grilled)

## Problem

The track minimap (30px strip, `WaveformRendererV2` minimap mode) now carries:
waveform body, main cue bar+triangle, up to 8 hot-cue bars, playhead bar, and
(Performance view) DOM play-guide ticks. Everything is a full-height vertical
bar; the strip is hard to read at a glance.

## Scope

- **In**: the track minimap (Performance deck panels + TagEditor). Prototype
  lab first; WebGL port of the winner is a follow-up.
- **Out**: editor `GlobalMinimap` (back-port winning ideas later).

## Decisions (from grill)

- **Information hierarchy**: playhead > transition guides > hotcues > main cue.
  Playhead + upcoming guides get the strongest visual weight.
- **Height**: may grow modestly; prototype each variant at 30px and ~44px.
- **Body treatment in scope**: dimming, desaturation, filtering. Played
  portion (before playhead) dimming as a cross-variant toggle.
- **Dynamics**: mostly static marks; the one dynamic element is upcoming vs
  passed guide emphasis (passed guides dim — precedent: missed guides at 0.35
  opacity today).
- **Mark vocabulary is an open axis**: edge lanes (top = guides, bottom =
  cues, playhead alone full-height) vs full-height bars both stay in the
  space. Main cue and guides may keep bars in some variants.
- **Hotcue colors**: per-slot vs unified is a toggle, not a decision.
- **Loop bands**: looping (`.scratch/looping/`) will add loop regions; each
  variant renders one optional synthetic loop region (toggle) as a
  band/body-tint to verify the vocabulary has room for regions.

## Prototype vehicle

New dev lab page `?view=minimap-lab` (alongside `StyleTuningPage`):

- Real data via existing hooks: `useWaveformBlob` (+ `toThreeBands`),
  `useHotCues`, track `cue_point_time`, beatgrid optional.
- Guides: real — pick a saved transition (`initTransitionStore` →
  `snapshotPairStore` → `computePlayGuides`); synthetic fallback when none.
- Rendering: Canvas 2D per variant (accepted fidelity gap vs the WebGL shader
  body), all variants stacked with a synchronized playhead.
- Playhead: synthetic sweep, adjustable speed, click-to-scrub. No audio.

## Variant slate

1. **Baseline** — replica of today's minimap (control).
2. **Edge lanes** — playhead only full-height; guides top ticks (next guide
   flagged/brighter); hotcues bottom ticks; main cue distinct bottom shape.
3. **Knockout bars** — full-height bars with a 1–2px dark halo punched into
   the body; body dimmed further.
4. **Quiet body** — body desaturated/monochrome, marks own all color; played
   portion dimmed hard; marks near-today otherwise.
5. **Kitchen-sink hybrid** — played-dim + edge lanes + unified hotcue color +
   next-guide emphasis (maximal declutter; measure the information loss).

Cross-variant toggles: played-dim on/off, hotcue palette per-slot/unified,
height 30/44px, synthetic loop band on/off.

## Success criteria

Human side-by-side judgment in the lab: which variant answers, fastest, the
glance-questions "where am I / where's the next guide / where are my cues"
with all marks present. Winner (or top two) recorded here, then a fresh
implementation change ports it into `WaveformRendererV2` (prototype code is
never promoted).

## Verdict (2026-07-05, human judged in the lab)

**Winner: "Zoned marks"** — out of 8 variants (the 5 grilled + 3 iterated:
square-flag cues, flagpole guides, zoned marks). Vocabulary: all mark kinds
keep full-height bars, but each kind carries its identity glyph in its own
vertical zone:

- **Hotcues**: 2px full-height pole + 5px square flag at the TOP right,
  per-slot colors (unified-color option rejected).
- **Transition guides**: 1px full-height bar + ▶ play arrow at MID-height,
  deck color (incoming). The next guide is emphasized (2px bar, larger
  arrow); passed guides dim to 0.3.
- **Main cue**: 2px full-height yellow bar + triangle at the BOTTOM.
- **Playhead**: 3px pink bar, the widest — plus the played-dim boundary.
- **Loop region**: `#00f900` wash at 0.18 + 2px guide line at the TOP edge
  (the bottom edge is the waveform's zero line). Mid-loop, the played-dim
  wash stops at the loop's left edge — the loop body is about to replay,
  never "already heard".
- **Played-portion dim**: black wash at 0.35 over body before the playhead
  (marks stay full brightness). Ships ON by default.
- **Height**: stays 30px (44px explored, rejected).

Loop rendering itself belongs to `.scratch/looping/` (their issue 05) —
this feature hands over the visual verdict only.

Port issues: 02 (marks vocabulary + played-dim), 03 (play-guide marks) —
both approved and landed 2026-07-05 (changes xlnwqstv, wmmuzpzl). The
prototype lab (`?view=minimap-lab`, change oyrprrqt) is retired —
abandoned, never landed.

## Follow-ups (out of scope here)

- Port winner into `WaveformRendererV2` minimap mode (+ `PlayGuideMinimapMarks`).
- Revisit editor `GlobalMinimap` with the same vocabulary.
