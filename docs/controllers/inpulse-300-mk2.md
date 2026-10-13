# Hercules DJControl Inpulse 300 MK2

- Code: `frontend/src/midi/mappings/inpulse300mk2.ts` (port match
  `DJControl Inpulse 300`)
- Decks: 2 (A, B). No layers.
- Learned on the device via `/midi-inspect`; Mixxx's Inpulse 300 file for
  the rest. Unverified bindings carry `TODO(hardware-verify)` in code
  (shifted jog seek, three of four shifted jump buttons, 15 of 16 shifted
  hot cue pads, LOOP pads).

## Deck section (ch 2 = A, ch 3 = B; SHIFT layer = ch 5 / 6)

| Control | Action | SHIFT+ |
|---|---|---|
| PLAY | play/pause | — |
| CUE | cue (CDJ) | — |
| SYNC | sync on/off | match (one-shot) |
| Q | quantize (app-wide) | key lock |
| Jump ◄ / ► | beatjump back / forward | loop/jump size halve / double |
| Pitch fader | pitch (fader down = faster) | — |
| Jog rim | bend (playing) / nudge seek (paused) | fast seek |
| Jog top (touch surface) | fine seek (paused) | fast seek |

`loop/jump size`: resizes the active loop, otherwise changes the beatjump
size.

## Performance pads (ch 7 = A, ch 8 = B)

| Mode | Pads | SHIFT+pad |
|---|---|---|
| HOT CUE | hot cue 1–8 | clear hot cue |
| LOOP | loop 1, 2, 4, 8, 16, 32, 64, 128 beats | pads 1–3: 1/8, 1/4, 1/2; pad 5: 3/4 |
| SAMPLER → GRID | nudge earlier, set downbeat, —, nudge later, shrink, grow, BPM halve, BPM double | — |

Other pad modes: unbound.

## Mixer

TRIM, EQ HI/MID/LOW, filter knob, channel fader, headphone (PFL) per
channel; crossfader; MASTER → app master level; HEADPHONES → cue level.
No cue-mix control on the device.

## Browse

| Control | Action |
|---|---|
| Browse encoder | move selection |
| LOAD A / B | load Deck A / B |
| Assistant | Follow on/off |

## Lights

PLAY, CUE, PFL, Q (quantize; SHIFT shows key lock), SYNC; hot cue pads
(both layers); GRID pads (lit when the Track has a beatgrid; pad 3 dark);
LOOP pads (lit for the active loop length); assistant (lit when any Deck
follows). No channel meters.

## Unbound

Jog touch note, SHIFT+assistant, other pad modes, FX section.
