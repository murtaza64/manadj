# DDJ-SB3 hardware reference

Control-surface inventory for Mapping work. Researched 2026-10-06, no
hardware in hand: every fact is from documents, the physical controller is
the authority. Sources:

- Official MIDI list ver. 1.00 (2018):
  [`DDJ-SB3_MIDI_Message_List_E1.pdf`](https://downloads.support.alphatheta.com/software_info/dj-controllers/DDJ-SB3/DDJ-SB3_MIDI_Message_List_E1.pdf)
- Mixxx mapping (community, GPL):
  [`Pioneer-DDJ-SB3.midi.xml`](https://github.com/mixxxdj/mixxx/blob/main/res/controllers/Pioneer-DDJ-SB3.midi.xml),
  [`Pioneer-DDJ-SB3-scripts.js`](https://github.com/mixxxdj/mixxx/blob/main/res/controllers/Pioneer-DDJ-SB3-scripts.js)
- Mixxx manual page:
  [`pioneer_ddj_sb3`](https://manual.mixxx.org/2.5/en/hardware/controllers/pioneer_ddj_sb3)

Channels below are 1-based (as in the PDF); code uses 0-based.

## Wire facts

- Same Pioneer protocol family as the GRV6: many deck notes are identical
  (PLAY 11, CUE 12, SYNC 88 / shift 92, key lock 26, VINYL 23 / SLIP 64,
  headphone CUE 84, jog CCs 33/34/35, touch 54/103, tempo 0/32, trim 4/36,
  EQ 7/11/15, channel fader 19/51, filter 23–26 on ch 7, crossfader 31/63,
  browse CC 64, browse press 65, LOAD 70–73, meter CC 2).
- Channels: decks 1–4 = ch 1–4; FX units = ch 5 (DECK1/3) and 6 (DECK2/4);
  browser/global = ch 7; pads = ch 8–11 (decks 1–4); host→device
  "communication" = ch 12–13.
- **2 physical sides, 2-channel mixer, layered ×2 via DECK buttons.** The
  whole side — including that side's TRIM/EQ/fader/headphone CUE — reports
  on the active layer's channel (Mixxx binds channel faders on ch 3/4).
  Filters are fixed per channel on ch 7 (CC 23–26), so a filter knob sends
  CH1 or CH3 depending on layer (verify).
- Every deck button has a distinct SHIFT note on the same channel.
- Absolute controls: 14-bit MSB/LSB; tempo "−" side = 0.
- Jog (offset-64): platter CC 34 (vinyl on) / 35 (vinyl off), shift
  platter CC 31, wheel side CC 33, shift side CC 38. Touch note 54, shift
  touch 103. Vinyl mode is device state (selects CC 34 vs 35). Mixxx also
  binds touch note 53 ("no vinyl mode") — not in the PDF.
- Browse rotate: two's complement (CW 1–30, CCW 127–98); shift rotate
  CC 100.
- Pads: one fixed note per (mode × pad × shift); device tracks pad mode.
  Blocks (pad n = block + n − 1, shift = +8): HOT CUE 0, FX FADE 16,
  PAD SCRATCH 32, SAMPLER 48, BEAT JUMP 64, ROLL 80, SLICER 96, TRANS 112.
- Mode buttons (deck ch): HOT CUE 27 / shift BEAT JUMP 105; FADE MIX 30 /
  shift ROLL 107; PAD SCRATCH 32 / shift SLICER 109; SAMPLER 34 / shift
  TRANS 110.
- Host-lightable (MIDI-OUT "same as MIDI-IN"): PLAY, CUE, SYNC (+shift),
  KEY LOCK (+shift), VINYL/SLIP, DECK (+shift), AUTO LOOP (+shift),
  1/2X, 2X (+shift), FX buttons, MASTER CUE, headphone CUE (+shift),
  LOAD 70–73, mode buttons, every pad note in every mode.
- Channel meter: CC 2 on deck channel, 0–127. Mixxx: ordinary level
  capped at 117, 119+ lights red (same scheme as manadj's GRV6 meter).

## Per-deck surface

| Control | Note / CC | +SHIFT |
|---|---|---|
| PLAY/PAUSE | 11 | 71 |
| CUE | 12 | 72 |
| SYNC | 88 | 92 |
| KEY LOCK | 26 | 96 (Serato: tempo range) |
| SHIFT | 63 | — |
| VINYL | 23 | 64 (SLIP) |
| DECK (1/3, 2/4) | 114 | 115 |
| AUTO LOOP | 20 | 80 (Serato: reloop/exit) |
| LOOP 1/2X | 18 | 97 (Serato: loop in) |
| LOOP 2X | 19 | 98 (Serato: loop out) |
| TEMPO | CC 0/32 | CC 5/37 |
| headphone CUE | 84 | 104 |
| CH fader | CC 19/51 | fader-start notes 102/81/82 |
| Crossfader (ch 7) | CC 31/63 | fader-start notes 102/81/82 on deck ch |

Absent vs GRV6: QUANTIZE, IN/OUT, RELOOP, CUE/LOOP CALL, MEMORY, KEY SYNC,
Groove Circuit / DRUM SWAP, STEMS button, rotary tilt, BACK, VIEW, DISCOVER,
PREVIEW, BOOTH, HEADPHONES MIX, Sound Color FX ON/OFF.

## Effects (ch 5 / 6, one unit per side)

FX 1/2/3 ON notes 71/72/73 (shift 99/100/101). LEVEL/DEPTH knob: PDF lists
CC 2/34, 4/36, 6/38 (per FX slot?) and shift CC 18/50; Mixxx binds only
6/38. Serato Beat FX are host-side. manadj binds all three pairs to the
unit's knob.

## Mixer / browser (ch 7)

- MASTER LEVEL CC 8/40, HEADPHONES VOL CC 13/45: per the Mixxx manual both
  act directly on the device's audio interface (analog + MIDI, like GRV6).
- MASTER CUE note 91 / shift 120. Mixxx implements it host-side (head mix)
  — implies NOT hardware, unlike GRV6. Verify.
- LOAD L = 70 (deck 1) / 72 (deck 3); LOAD R = 71 / 73. Shift: 88/96,
  89/97. Browse press 65 / shift 66.

## Firmware-driven pad modes

- FX FADE, PAD SCRATCH, TRANS are executed by the controller (Mixxx
  manual). TRANS needs the deck BPM via SysEx
  (`F0 00 20 7F <0x11+deck> 00 00 <4 nibbles of bpm×100> F7`) and toggles
  the channel volume itself. What these modes emit over MIDI (synthesized
  fader/filter/jog messages?) is unknown.

## Host messages (Mixxx, undocumented in PDF)

- Init SysEx `F0 00 20 7F 03 01 F7` on startup (purpose unknown).
- `9B 09 7F` (ch 12 note 9) = request current knob/fader positions. If
  real, this is a state dump the GRV6 lacks.
- Host can set the DECK layer: Mixxx shutdown sends note 114 on ch 1/2.
- Decks 3/4 only work when the host uses the SB3 sound card (firmware).

## Audio

USB outs 1–2 master, 3–4 headphones (Mixxx). Mic not routed to host.

## Verification list

- Layer-switch reporting: does DECK emit 114 on the new channel only, or
  also a release / displaced-layer message?
- Host layer override via note 114 out.
- Knob-position request `9B 09 7F` and init SysEx.
- Whether the device lights mode buttons itself.
- Filter knob channel follows layer?
- MASTER CUE hardware vs host.
- Jog counts/revolution (Mixxx's 720 is convention, not measurement).
- Tempo fader polarity.
- What FX FADE / PAD SCRATCH / TRANS emit.
- Touch note 53.
