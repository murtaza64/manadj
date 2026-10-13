# AlphaTheta DDJ-GRV6

- Code: `frontend/src/midi/mappings/ddjGrv6.ts` (port match `DDJ-GRV6`)
- Wire facts: [ddj-grv6-hardware.md](../research/ddj-grv6-hardware.md),
  decisions: [ddj-grv6-mapping-design.md](../research/ddj-grv6-mapping-design.md),
  jog: [ddj-grv6-jog-calibration.md](../research/ddj-grv6-jog-calibration.md)
- Decks: 4. Two physical sides layered by DECK 1–4 (left 1/3, right 2/4);
  four fixed mixer strips. Hardware-verified.

## Layers

DECK 1–4 select which Deck a side controls (control focus). The device
reports the switch (note 60, ch 1–4). Only the TEMPO fader is layered: its
pickup re-arms for both Decks of the pair on every switch. Mixer strips are
fixed per channel and keep their latch.

## Deck section (ch 1–4 = Decks A–D)

| Control | Action | SHIFT+ |
|---|---|---|
| PLAY/PAUSE | play/pause | — |
| CUE | cue (CDJ) | — |
| BEAT SYNC | sync on/off | match (one-shot) |
| MASTER TEMPO | key lock | — |
| QUANTIZE | quantize (app-wide) | — |
| SLIP | slip mode | vinyl mode |
| IN/4BEAT | beatjump back | loop/jump size halve |
| OUT | beatjump forward | loop/jump size double |
| IN/4BEAT long press | loop on/off | — |
| RELOOP/EXIT | loop on/off | — |
| CUE/LOOP CALL ◄ ► | hot cue walk prev/next (paused only) | — |
| TEMPO fader | pitch | — |
| Jog top / rim | scratch (vinyl on) or bend / nudge | fast seek |
| Jog touch | scratch hold | shifted touch |
| DRUM SWAP 1–4 | stem kill: vocals, drums, bass, other | stem solo |

`loop/jump size`: resizes the active loop, otherwise changes the beatjump
size.

## Performance pads

| Mode button | Pads | SHIFT+pad |
|---|---|---|
| HOT CUE | hot cue 1–8 (set / jump) | clear hot cue |
| B.JUMP | jump pairs: odd = back, even = forward; sizes size/8, /4, /2, size | pads 7/8: beatjump size halve/double |
| SHIFT+B.JUMP (Beat Loop) | loop 1/4, 1/2, 1, 2, 4, 8, 16, 32 beats | — |
| STEMS → GRID | shrink, grow, nudge earlier, set downbeat, drop anchor, nudge later, mark reset, delete reset | — |

Pad FX, SAMPLER, Key Shift, Keyboard: unbound.

## Mixer (per channel)

TRIM, EQ HI/MID/LOW, channel fader, headphone CUE (PFL), Sound Color FX
knob (sweep filter), crossfader.

## Beat FX (ch 5)

| Control | Action |
|---|---|
| SELECT | Echo / Reverb / Flanger; other detents select none (section off) |
| CH SELECT 1–4 / SP / MST | Beat FX target Deck A–D / sampler (silent) / master |
| ON/OFF | section on/off |
| BEAT ◄ ► | Beat FX length halve / double (beats; Flanger reads bars by default) |
| LEVEL/DEPTH | depth (original ⟷ effect) |

## Browse (ch 7)

| Control | Action | SHIFT+ |
|---|---|---|
| Rotary turn | move selection | — |
| Rotary press | open (sidebar) / no-op (table) | — |
| Tilt ▲ ▼ | page up/down | top/bottom |
| Tilt ◄ ► | move between browse areas | — |
| BACK | focus sidebar | split view on/off |
| VIEW | Performance ⟷ Library | — |
| DISCOVER | Follow on/off | Follow "known only" |
| LOAD 1–4 | load Deck A–D | — |

## Lights

PLAY, CUE (CDJ flash, beat-locked), PFL, QUANTIZE, BEAT SYNC, MASTER
TEMPO, SLIP, vinyl; hot cue pads (both layers); GRID pads (lit when the
Track has a beatgrid); Beat Loop pads (lit for the active loop length);
DRUM SWAP (stem state); Beat FX ON/OFF and beat indicator; channel meters (pre-fader, red = clipping). B.JUMP
pads stay dark.

## Unbound (deliberate)

- MASTER LEVEL, HEADPHONES LEVEL/MIX, MASTER CUE: act on the device's own
  audio hardware; binding would double-apply.
- Groove Circuit GAIN, CAPTURE, DRUM ROLL, DRUM RELEASE; MEMORY; KEY SYNC;
  PREVIEW; shifted rotate/press/LOAD; Pad FX, Sampler, Key Shift, Keyboard.
- Beat FX: shift-layer CH SELECT notes, RELEASE FX.
