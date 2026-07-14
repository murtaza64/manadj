# DDJ-GRV6 hardware reference

Control-surface inventory for Mapping work. Sources: official Operating
Instructions (`DDJ-GRV6_DRI1927A_manual.pdf`, alphatheta.com downloads) and
MIDI message list (`DDJ-GRV6_MIDI_Message_List_E1.pdf`). All facts
verified-from-manual unless flagged. Researched 2026-07-14, pre-hardware —
the physical controller remains the authority for ambiguity (PRD:
four-deck-performance).

## Wire facts

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
