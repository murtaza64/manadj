# One-handed portrait DJing (Android)

Design spike, 2026-10-15, lane `android-onehand-one-handed-portrait-design-spike`.
Three layouts in `android/app/src/main/java/dev/manadj/app/onehand/`, switched in
Settings › Layout (portrait); STANDARD is the UI lane's Portrait, untouched. Spike only —
parked for review, never lands as-is.

## Brief

Right thumb, phone 1260×2800 @440 dpi (≈458×1018 dp). The thumb comfortably covers ~40 %
of the screen at the bottom right; the top is view-only. Controls to cover: PLAY/CUE, 8 hot
cues, beat jump, loops, bend/jog, SYNC, faders/crossfader, 3-band EQ + filter + trim, Beat
FX, BROWSE + load, Quantize.

## Round 2 (human feedback, OH1–OH4)

- **OH1 cut-only EQ.** All EQ gestures run kill → unity; 0 dB is the end of travel, on a sine
  ease (`cutToEq` / `eqToCut`) so steps are finest near the kill and near unity. A: `CutKnob`
  (relative drag, double-tap kill ↔ unity; a *second finger resting on the knob* switches the
  drag to the boost half — the deliberate extra gesture). B: EQ sweeps are cut-only, unity at
  the end of the arc, double-tap = unity; no boost. C: the EQ pad is cut-only; no boost.
- **OH2 drawn reach zone.** Settings › DRAW REACH ZONE: trace the comfortable thumb area in one
  stroke (per hand, `ReachZone`, normalized polygon in prefs). Every layout places its control
  block **centred on the zone's centroid** (`OneHandScaffold`, `ReachFrame`), clamped on
  screen; the waves take what is left above. Until drawn, the default zone is an ellipse at
  (0.66 w, 0.70 h) — controls sit well above the corner now. REACH ZONE overlays the polygon
  and its centre. RINGS reads its radius band and angular window off the zone polygon (rings
  fill it evenly; the corner under the innermost ring is dead space).
- **OH3 faders.** A: both channel faders (short, side by side) above the XF lever in the right
  column. B: MIX ring 2 = A | B fader half-sweeps. C: FADERS chord — hold, move left/right to
  pick A/B, up/down for level; tap = both to full. The crossfader stays in the macro (lever /
  XF ring / MIX pad).
- **OH4 CUE.** Not a layout bug: the engine adopted the MP3 decoder's TOC-estimated seek start
  for a parked playhead (tens of ms past the cue), so CueDown took the set-cue branch. Verified
  on the emulator: identical commands from all layouts; the engine lane's at-cue fix (pxntqqtm)
  applied locally makes CUE-hold preview in FOCUS/RINGS/CHORDS. `OneHandCueTest` (instrumented,
  MP3 asset with cue = hot cue 4) covers CUE hold per layout.

## Shared model

- **Reach zone** (OH2 above): drawn polygon or the default ellipse; overlay toggle Settings ›
  REACH ZONE (`drawReach`).
- **Focused deck** (`OneHand.focus`): every layout drives one deck's controls; the other
  deck is a wave up top plus a chip. Switch: chip tap, hub tap (B), or a horizontal flick
  over the control block (A, C). The browser sheet's foot shows CUE/PLAY for the focused deck.
- **View area** (`ViewArea`): deck info in the camera band, both detail waves stacked and
  filling whatever the thumb zone leaves (focus edge in deck colour), minimaps with a mix
  readout between them (gain·XF, LOW, FILTER bars per deck + XF dot). Waves still scrub/
  scratch/pinch with a second hand; the thumb never needs to go there.
- **Mix macro** (`applyMixMacro`): one 0..1 throw = crossfader (XF), optionally + bass swap
  (XF+LOW: the outgoing deck's LOW falls to kill over the second half) or + outgoing
  high-pass (XF+FILT). This is the desktop Transition idea reduced to one gesture.
- **Browse**: the UI lane's portrait sheet (swipe up on free space, BROWSE chip); row swipe
  loads A/B as before. While the browser is open the waves drop to their minimum so the list
  gets the thumb zone. Load target is the swipe direction, not the focused deck (gap, below).
- **Mirror** (Settings › LEFT HAND): RTL layout direction for A and C; ring geometry mirrors
  itself in B. Best-effort.

Stubs (visible): MID EQ in C's EQ pad; trim/PFL only in A; SESSIONS not reachable from
the one-hand layouts; key lock / grid edits only via the PITCH panel overlay.

## A · FOCUS — one deck under the thumb, vertical mix lever

`FocusLayout.kt`. The pragmatic one: the standard control vocabulary, rearranged.

Thumb zone, bottom → top (stair-stepped toward the corner; least-used row highest):

| Row | Controls |
|---|---|
| transport (54 dp) | focus chip · BEND strip · CUE · PLAY (PLAY in the corner) |
| strips | ÷2 LOOP ×2 · ◀ JUMP ▶ (UI lane strips, half width each) |
| pads | 8 hot cues, 2×4 (UI lane pads) — or the Beat FX card when FX is toggled |
| mixer | PFL · TRIM · HI · MID · LOW (cut-only `CutKnob`s) · FILTER, right-aligned so FILTER/LOW are nearest |
| chips | ⚙ · Q · SYNC · PITCH · FX · BROWSE (full block width) |

Right column: both channel faders (short) over the **MIX LEVER** — a vertical rail, A at the top (its
wave is the top one), B at the bottom. Relative drag; double-tap recentres; the pill above it
cycles the macro (XF / XF+LOW / XF+FILT). PITCH overlays the UI lane's pitch panel on the
block. Flick the pad block sideways to switch focus.

Encoding: position = function, like a controller. Gestures: vertical lever flexion, knob
relative drags (UI lane Knob, popup + fine), pad stabs, flick to switch deck.

Good at: zero learning; everything is a known control; multi-touch stabbing stays; mixing
is one thumb flexion along the edge, eyes on the waves. Bad at: it is dense — knobs at 38 dp
and 4-column pads leave little margin; the chips row and TRIM/HI are at the edge of reach;
the other deck's PLAY is two taps away (switch, then PLAY); EQ on the other deck needs a
switch too.

## B · RINGS — concentric thumb arcs

`RingsLayout.kt`. The radical one. The thumb pivots at the bottom corner, so its natural
motion is an arc at (roughly) constant radius. Everything in the zone is an arc around that
pivot: **radius picks the control, angle is the value (sweeps) or the sector (stabs)**.

| Ring (outer radius) | PERF | MIX | FX |
|---|---|---|---|
| hub 72 dp | focused deck; tap = switch | | |
| 124 | mode: PERF · MIX · FX | | |
| 190 | PLAY (half) · CUE (half), every mode | | |
| 254 | hot cues 1–4 | XF sweep (XF+LOW macro) | ON/OFF · →A · →B · →MST |
| 318 | hot cues 5–8 | FADER A (half) · FADER B (half) | effect sectors (6) |
| 378 | ÷2 · LOOP · ×2 · ◀ · JUMP (size) · ▶ | FILTER sweep | beats sectors (9) |
| 430 | BEND sweep (momentary) | LOW sweep | DEPTH sweep |
| — | | MID (half) · HI (half) cut sweeps | |

(Radii above are the original fixed ones; since OH2 the rings fill the drawn zone's radius
band evenly, innermost = ⇄deck · PERF · MIX · FX.)

Sweeps are **relative** (touch anywhere on the ring, drag along it; a full quarter = full
range; half rings = half quarter), with the knob rule: double-tap resets to neutral; BEND
springs back. Sectors are momentary stabs with the same engine semantics as the pads (hot
cue down/up, CUE down/up), multi-touch (each pointer binds to the ring it landed in).
Haptics on every press / notch.

Good at: the whole zone is one gesture family; every control is the same distance along
its ring, so once you know the ring you do not look; sweeps are long (270 dp of travel for
the XF) and precise; the ring picture is the mix state. Bad at: the outer two rings sit at
the edge of reach on a tall phone (the reach overlay shows it) — 6 rings is one too many;
sector labels are small; mode switching is a stab near the corner (fine) but the mode
*content* is invisible until you switch; no multi-finger EQ + XF at once unless you
remember the ring order; the hub + mode ring waste the easiest-to-reach pixels on the least
frequent actions (deliberate — they are the "wrist rest" — but debatable).

## C · CHORDS — six chord keys and palettes

`ChordsLayout.kt`. The gesture one. A compact dock in the corner is all that is ever on
screen; the waves get the rest. Tap = primary; **press-and-drag (160 ms or 10 dp) opens a
palette under the thumb**; release commits. Haptic on open.

| Key | Tap | Hold + drag |
|---|---|---|
| PLAY · CUE | UI lane keys (slide-to-lock on CUE still works) | |
| PADS | — | fan of 8 hot cues on two arcs; sliding into a cell = hot cue down (SET if empty), leaving = up; stabbing between cells plays them |
| LOOP | toggle loop | ↔ length wheel (live resize while looping) |
| JUMP | jump ▶ | ↔ past 48 dp arms ◀ / ▶ (commits on release), ↕ steps the size |
| MIX | cycle macro | 2-D pad: ↔ XF macro throw, ↕ focused deck FILTER |
| EQ | LOW kill toggle (the bass-swap move) | cut-only 2-D pad: ↔ LOW, ↕ HI (MID stubbed) |
| FADERS | both to full | two lanes: ↔ picks A / B, ↕ level |
| FX | ON/OFF (target = focused deck) | ↔ DEPTH, ↕ beats; double-tap = next effect |

Plus the focus chip and the ⚙ · Q · SYNC · PITCH · BROWSE chips above the dock.

Good at: the smallest footprint — 9 keys in the easy zone, the largest waveforms of the
three; palettes appear where the thumb already is, so nothing is a stretch; every function
is "hold the thing, move, let go", easy to do blind with haptics; the FX target following
the focused deck removes a whole control. Bad at: discoverability (chords must be
learned; the sub-labels hint); one finger at a time — no pad stabbing with two fingers, no
EQ while crossfading; the palette's values are relative so a drag's start is a "find the
current value" moment; hot cue cells near the dock overlap keys (covered while held, but
busy).

## Recommendation

Not one of them wholesale. The pieces that felt right on the emulator (phone check pending):

1. **Mix macro on one axis** (A's lever, B's XF ring, C's MIX pad all use it) — a
   transition as one gesture is the single biggest one-hand win. Keep XF+LOW as the default.
2. **Focused-deck model** with the other deck summarised — necessary; the symmetric layout
   has no spare width for a thumb.
3. **Sweeps along the thumb arc** (B) for continuous controls: the most natural thumb
   motion and the longest travel. Three rings, not six: XF/macro, FILTER, LOW; MID/HI go to
   a secondary mode.
4. **Hold-and-slide palettes** (C) for the occasional controls: loop length, jump, FX
   depth/beats, hot-cue fan — they cost no screen while idle.
5. **Keep real pads for hot cues** (A) if stabbing matters; the fan (C) is one finger.

A plausible synthesis: C's dock in the corner (PLAY/CUE/PADS/LOOP/JUMP/FX), with B's three
sweep rings around it for XF-macro/FILTER/LOW instead of the MIX/EQ chords, and A's waves
+ mix readout on top. Needs the phone in hand to judge reach honestly — the reach overlay
is there for that.

## Hooks outside the package

Two one-line edits in UI-lane files (mailed to the UI lane): `Layouts.kt` dispatches to
`OneHandApp` when `OneHand.layout(context) != STANDARD` in portrait and `DetailWave` is
`internal` (was private); `Sheets.kt` calls `OneHandSettings()`. Everything else lives in
`dev.manadj.app.onehand`.
