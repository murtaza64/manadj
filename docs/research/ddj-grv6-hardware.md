# DDJ-GRV6 hardware reference

Control-surface inventory for Mapping work. Sources: official Operating
Instructions (`DDJ-GRV6_DRI1927A_manual.pdf`, alphatheta.com downloads) and
MIDI message list (`DDJ-GRV6_MIDI_Message_List_E1.pdf`). All facts
verified-from-manual unless flagged. Researched 2026-07-14, pre-hardware —
the physical controller remains the authority for ambiguity (PRD:
four-deck-performance).

## Wire facts

Jog resolution and software prior art were measured during hardware acceptance;
see [`ddj-grv6-jog-calibration.md`](ddj-grv6-jog-calibration.md).

- Everything sends MIDI except the rear MIC ATT. trim (analog).
- Deck controls: NOTE/CC on channels 1–4 (deck = channel). Right deck reuses
  left-deck note numbers except the DECK buttons.
- Every deck button has a distinct Shift note (same channel, different
  number). IN/4BEAT additionally sends a distinct long-press note (20).
- Pads: fixed note per (pad × shift layer); no-shift on channels 8/10/12/14
  (decks A–D), shift layer on 9/11/13/15. Pad notes do not change with
  host-side size paging. Pads are host-lightable (MIDI-OUT mirrors MIDI-IN).
- Browse/global/mixer-master/Sound Color FX: channel 7. Beat FX: channel 5.

## Per-deck surface (2 physical sides, layered ×2 via DECK buttons)

| Control | Official function | Notes (no-shift/shift where known) |
|---|---|---|
| Jog (206mm) | vinyl scratch / pitch bend; shift = fast seek | touch + rotate + side rotate |
| TEMPO slider | pitch | 14-bit CC |
| PLAY/PAUSE | play/pause | 11 / 71 |
| CUE | set/return; shift = track start | 12 / 72 |
| SHIFT | modifier | 63 |
| IN/4BEAT | loop in; hold = 4-beat auto loop | 16 / 76; long-press 20 |
| OUT | loop out | 17 / 119 |
| RELOOP/EXIT | reloop / exit loop | 77 / 80 |
| CUE/LOOP CALL ◄ ► | call memory cue/loop (pause only); during loop halve/double | 81,83 / 97,98 |
| MEMORY | save cue/loop; shift = delete | 61 / 62 |
| SLIP | slip; shift = vinyl mode | 64 / 23 |
| QUANTIZE | quantize; shift = tap tempo | 53 / 104 |
| DECK 1–4 | layer switch; chord (1+3 or 2+4) = dual deck | notes 114/60/115 per side |
| MASTER TEMPO | key lock; shift = tempo range cycle | 26 |
| BEAT SYNC | sync; shift = set sync master | 88 |
| KEY SYNC | key match; shift = key reset | |

CDJ CALL behavior (2000NXS2/3000): memory-cue call works only during pause;
calling moves the current cue point to the called stop.

## Performance pads

8 RGB pads per side; 4 mode buttons × shift = 8 modes (rekordbox Mac/Win):

| Button | Mode | Shift mode |
|---|---|---|
| HOT CUE | Hot Cue (shift+pad = delete) | Keyboard |
| STEMS | Stems (1–3 mute vocal/inst/drums; 5–7 FX target) | Pad FX |
| B.JUMP | Beat Jump | Beat Loop |
| SAMPLER | Sampler | Key Shift |

Beat Jump mode (manual p.72–73): odd pads left, even pads right; four
size pairs, default 1/2/4/8 beats. Shift+pad7/8 pages the whole window
down/up (host-side state; range not enumerated in manual). No documented
LED size semantics. Beat Loop mode (p.77): pads = fixed 1/4, 1/2, 1, 2, 4,
8, 16, 32 beats; press engages, same pad releases.

## Groove Circuit (per deck side)

Drum-remix engine over the Drums stem (rekordbox): swap loops replace/layer
the track's drums, beat-synced; disabled in dual-deck mode.

| Control | Official function |
|---|---|
| GAIN knob | drum-swap loop volume |
| DRUM SWAP 1–4 | play/pause loop n; shift = bank A/B, single/multi mode |
| CAPTURE | arm capture of track's drum stem; shift = length 4/8/16/32 |
| DRUM ROLL 1–4 | hold = roll 1/8–1 beat; shift = trans |
| DRUM RELEASE lever | spring-loaded tilt-and-hold = release FX; center = off |

## Effects

- Beat FX (ch 5): SELECT knob (14 effects), CH SELECT (1/2/3/4/SP/MST),
  LEVEL/DEPTH knob, ON/OFF (shift = release FX), BEAT ◄ ►, beat indicators
  (MIDI-out only).
- Sound Color FX: 4 per-channel knobs + one ON/OFF button (shift = cycle
  type FILTER/DUB ECHO/REVERB/NOISE).

## Mixer

4 strips: TRIM, 3-band EQ, headphone CUE button (shift = EQ↔stem-level mode),
channel fader (shift = fader start), level meters (MIDI-out). Crossfader (no
assign switches). MASTER LEVEL, MASTER CUE, BOOTH LEVEL (sends MIDI).
Front: HEADPHONES LEVEL, HEADPHONES MIX. Rear: MIC LEVEL (MIDI), MIC ATT.
(analog), Android MONO/STEREO switch.

## Browse

Smart Rotary Selector: rotate (shift = waveform zoom), press (enter),
4-way tilt (up/down list, left/right browse areas; shift variants).
BACK, VIEW, DISCOVER (track suggestion; shift = related tracks), PREVIEW,
LOAD 1–4 (double-press = instant doubles).

## Absent (verified)

No dedicated beatjump buttons, no crossfader assign switches, no Smart CFX /
SMART FADER / silent cue, no per-deck grid buttons, no sampler volume knob.

## Control-state reporting (issue 34, hardware-verified 2026-07-15)

Method: hot-plug-aware sniffer (`scripts/probes/midi_sniff.py`) armed before
USB connection; E1 MIDI list cross-checked. No undocumented writes attempted.

- **No spontaneous state dump.** Power-on, USB connect, port open, and a
  settle window produce ZERO MIDI-IN messages.
- **No state request exists.** The E1 list contains no SysEx at all; every
  MIDI-IN row is gesture-triggered (press/rotate/slide).
- **Layer switches ARE reported**: DECK N press emits note 114 plus note 60
  velocity 0x7F on the activated deck's channel and 0x00 on the displaced
  deck's channel (the Mapping already binds note 60 to set-control-focus).
- **Shared controls report on the ACTIVE layer's channel only**; positions
  are NOT re-reported for the newly active layer. Soft takeover must re-arm
  per layer on every switch. One exception observed: GRV GAIN (CC 18/50)
  spontaneously reported on DECK 3/4 activation (not decks 1/2) — treat as
  unreliable; do not depend on it.
- Absolute controls send 14-bit MSB/LSB CC pairs per the E1 list (tempo
  0/32 per deck channel, trim 4/36, crossfader 31/63 on global channel 7).
- **Policy consequence** (34 acceptance): cold startup, on-demand sync, and
  hot reconnect all retain full soft takeover for every absolute control;
  a layer change marks all shared controls stale/unsynced.

## Channel level meters (issue 36, E1 + hardware verified 2026-07-16)

The four Mixer channel level indicators are MIDI-OUT (`## Mixer` above). The
manadj driver (four-deck-performance 36) sends a per-channel CONTROL-CHANGE
on each deck channel (0–3 = A–D), CC 2. The official E1 MIDI-OUT ranges are:

- `0x00–0x25`: dark
- `0x26–0x40`: one green
- `0x41–0x56`: two greens
- `0x57–0x64`: two greens + one orange
- `0x65–0x76`: two greens + two oranges
- `0x77–0x7f`: all above + red

The signal
tapped is each channel's own post-EQ/filter, pre-fader level (the PFL tap
point in `mixer.ts`), so a channel meters whether or not its fader is up.

Level shaping follows Mixxx's `EngineVuMeter` (`src/engine/enginevumeter.cpp`):
sample-window mean absolute value, normalized as
`log10(32767 * meanAbs / 1000 + 1)`, sampled at 30 Hz, immediate attack and
10% decay per tick. Normal VU is capped at `0x75`, matching Mixxx's Pioneer
mapping; it cannot enter the E1 red range. A separate sample-clipping flag
sends `0x77` and holds red for 500 ms, matching Mixxx `peak_indicator`.
This avoids both the initial sample-peak implementation's constant redline
and the second implementation's mistake of letting ordinary VU reach red.

Master-headroom 01 sets trim center to -6 dB (-18..+6 dB throw). Orange at
the loudest passage is the target, matching the official manual. The meter
tap includes trim/EQ/filter but excludes fader/crossfader/Master: red means
that channel exceeded full-scale, while summed overload is handled by the
separate Master ceiling.

## Lamp memory (issue 28 probe, hardware-verified 2026-07-15)

- MASTER TEMPO lamp (note 26): OFF=0x00 / ON=0x7F on ALL four channels; no
  per-deck polarity differences.
- **Per-layer lamp memory**: the device stores lamp state per channel and
  displays the active layer's stored value. Writes to an inactive layer's
  channel are stored silently and repainted by the hardware on layer switch
  — no host involvement in layer repaints (MidiFeedbackBridge's re-send on
  control-focus change is still correct, merely redundant for this lamp).
