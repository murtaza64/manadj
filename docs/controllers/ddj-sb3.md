# Pioneer DDJ-SB3

- Code: `frontend/src/midi/mappings/ddjSb3.ts` (port match `DDJ-SB3`)
- Wire facts + verification list:
  [ddj-sb3-hardware.md](../research/ddj-sb3-hardware.md)
- Decks: 4. Two physical sides over a two-channel mixer; DECK buttons
  switch a whole side — deck controls AND its mixer strip — between Decks
  1/3 (left) and 2/4 (right).
- **Not hardware-verified.** Built from the official MIDI list and the
  Mixxx mapping.
- Plain-language guide (rekordbox differences, gotchas):
  [ddj-sb3-guide.md](ddj-sb3-guide.md)

## Layers

A DECK press reports the newly active layer (note 114 on that Deck's
channel) and moves control focus. Layered controls — TEMPO, TRIM, EQ,
FILTER, channel fader — re-arm soft takeover for both Decks of the pair on
every switch: after switching, a fader does nothing until it reaches the
new Deck's value; returning to the old Deck requires the same pickup.

Firmware limit: Decks 3/4 only work while the app uses the SB3's audio
interface.

## Deck section (ch 1–4 = Decks A–D)

| Control | Action | SHIFT+ |
|---|---|---|
| PLAY/PAUSE | play/pause | — |
| CUE | cue (CDJ) | — |
| SYNC | sync on/off | match (one-shot) |
| KEY LOCK | key lock | quantize (app-wide) |
| VINYL | vinyl mode | slip mode |
| LOOP 1/2X | beatjump back | loop/jump size halve |
| LOOP 2X | beatjump forward | loop/jump size double |
| AUTO LOOP | loop on/off | — |
| TEMPO fader | pitch | pitch |
| Jog top / rim | scratch (vinyl on) or bend / nudge | fast seek |
| Jog touch | scratch hold | shifted touch |
| headphone CUE | PFL | — |
| DECK | switch layer | — |

`loop/jump size`: resizes the active loop, otherwise changes the beatjump
size. 1/2X / 2X as loop controls instead of jump is a planned
per-controller setting once loop in/out exists.

## Performance pads (ch 8–11 = Decks A–D)

| Mode button | Pads | SHIFT+pad |
|---|---|---|
| HOT CUE | hot cue 1–8 (set / jump) | clear hot cue |
| SHIFT+HOT CUE (BEAT JUMP) | jump pairs: odd = back, even = forward; sizes size/8, /4, /2, size | pads 7/8: beatjump size halve/double |
| SHIFT+FX FADE (ROLL) | loop 1/4, 1/2, 1, 2, 4, 8, 16, 32 beats (latching) | — |
| SHIFT+PAD SCRATCH (SLICER) → GRID | shrink, grow, nudge earlier, set downbeat, drop anchor, nudge later, mark reset, delete reset | — |
| SAMPLER → stems | pads 1–4: kill vocals, drums, bass, other | pads 1–4: solo |

FX FADE, PAD SCRATCH, TRANS: firmware-driven modes, unbound.

## Mixer

TRIM, EQ HI/MID/LOW, FILTER (sweep filter), channel fader per side (follow
the layer); crossfader.

## FX (ch 5 = FX1, left; ch 6 = FX2, right)

Both units drive manadj's one Beat FX section (one effect, one target).

| Control | Action | SHIFT+ |
|---|---|---|
| FX-1 / FX-2 / FX-3 | engage Echo / Reverb / Flanger on the side's focused Deck; again = off | engage it on master; again = off |
| LEVEL/DEPTH | Beat FX depth (original ⟷ effect) | — |

- Engaging on one side moves the section there; the units are not
  independent.
- A LEVEL knob only acts while the section targets its side's focused Deck
  (either knob when targeting master); each knob picks up separately.
- Echo beat fraction: screen/keyboard only.

## Browse (ch 7)

| Control | Action | SHIFT+ |
|---|---|---|
| BROWSE turn | move selection | — |
| BROWSE press | open (sidebar) / no-op (table) | Performance ⟷ Library |
| LOAD L / R | load the side's active Deck (A/C, B/D) | — |

## Lights

PLAY, CUE (CDJ flash), PFL, SYNC, KEY LOCK, SHIFT+KEY LOCK (quantize),
VINYL, SLIP; FX buttons (lit while their effect runs on their scope);
hot cue pads (both layers); GRID pads (lit when the Track has
a beatgrid); ROLL pads (lit for the active loop length); SAMPLER pads
(stem state, both layers); channel meters (pre-fader, red = clipping).
BEAT JUMP pads stay dark.

## Unbound (deliberate)

- MASTER LEVEL, HEADPHONES VOL: act on the device's own audio interface.
- MASTER CUE: pending hardware check (may be host-side on this device).
- SHIFT+LEVEL/DEPTH.
- SHIFT+PLAY, SHIFT+CUE, SHIFT+AUTO LOOP, SHIFT+headphone CUE, SHIFT+DECK,
  SHIFT+BROWSE turn, SHIFT+LOAD, fader-start (SHIFT+fader).
- No BACK, VIEW, DISCOVER, tilt, QUANTIZE, IN/OUT, CUE/LOOP CALL on this
  device.
