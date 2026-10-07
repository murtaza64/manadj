# Using a Pioneer DDJ-SB3 with manadj

A plain-language guide. The exact button-by-button reference is
[ddj-sb3.md](ddj-sb3.md).

**Status: untested on a real SB3.** The mapping was built from Pioneer's
published MIDI list. Expect rough edges; the list at the end says what to
watch for and report.

## Setup

1. Plug the SB3 in over USB and open manadj. The **MIDI** badge in the top
   bar lights up when the controller is recognised.
2. In the top bar, set **MASTER** to the DDJ-SB3, outputs 1–2, and **CUE**
   to the DDJ-SB3, outputs 3–4. manadj asks you to pick the output pair
   because it hasn't confirmed the SB3's channel order yet.
3. Use the SB3 as the audio output. **Decks 3 and 4 only work while the
   SB3 is the audio output** (a limit of the SB3 itself).
4. The SB3's **MASTER** and **HEADPHONES** knobs turn the SB3's own outputs
   up and down. They don't move manadj's on-screen Master or Phones level.
   Leave the on-screen levels where they are.

## The basics

| On the SB3 | What it does in manadj |
|---|---|
| PLAY/PAUSE, CUE | Same as rekordbox / a CDJ |
| SYNC | Sync on/off |
| SHIFT + SYNC | One-time tempo match (doesn't stay synced) |
| KEY LOCK | Key lock |
| VINYL | Jog top scratches (on) or nudges (off) |
| SHIFT + VINYL | Slip mode |
| Jog wheel | Scratch / nudge; SHIFT + jog = fast search |
| Headphone CUE | Send that deck to the headphones |
| BROWSE knob | Scroll the track list |
| BROWSE press | Open the highlighted playlist |
| LOAD | Load the highlighted track onto that side's deck |

## Where manadj differs from rekordbox / Serato

- **1/2X and 2X are beat jump buttons.** In rekordbox they halve and double
  a loop. In manadj, 1/2X jumps back and 2X jumps forward.
  SHIFT + 1/2X / 2X makes the jump shorter or longer. While a loop is
  playing, SHIFT + 1/2X / 2X halves or doubles the loop instead. A setting to switch them
  back to loop buttons is planned.
- **AUTO LOOP** starts and stops a loop at the current loop length.
  SHIFT + AUTO LOOP does nothing.
- **SHIFT + KEY LOCK is Quantize.** The SB3 has no Quantize button. It
  switches Quantize for the whole app, not just that deck. Serato uses this
  combination for tempo range; manadj has no tempo-range setting.
- **SHIFT + BROWSE press** switches between the Performance and Library
  screens.
- **SHIFT + PLAY and SHIFT + CUE do nothing.** manadj has no "stutter" or
  "jump to track start" buttons.

### Pads

Choose a pad mode with the four buttons above the pads, alone or with
SHIFT:

| Mode button | rekordbox / Serato | manadj |
|---|---|---|
| HOT CUE | Hot cues | Hot cues. SHIFT + pad deletes one. |
| SHIFT + HOT CUE (Beat Jump) | Beat jump | Beat jump. Pads come in back/forward pairs; each pair to the right jumps further (largest = your jump size). SHIFT + pads 7/8 change the jump size. |
| SHIFT + FX FADE (Roll) | Loop **roll**: plays only while held | **Loops that stay on.** Pads = 1/4, 1/2, 1, 2, 4, 8, 16, 32 beats. Press once to start, press the same pad to stop, or another pad to change length. The track doesn't jump ahead when you let go. |
| SHIFT + PAD SCRATCH (Slicer) | Slicer | **Beatgrid editing**: shrink, grow, nudge earlier, set downbeat, drop anchor, nudge later, mark reset, delete reset. These change the saved beatgrid. |
| SAMPLER | Sampler | **Stems.** Pads 1–4 = vocals, drums, bass, other: press to mute or unmute. SHIFT + pad plays only that stem; press again for all stems. Pads 5–8 do nothing. |
| FX FADE, PAD SCRATCH, TRANS | Built-in SB3 effects | manadj doesn't control these modes; see Gotchas. |

### Effects

manadj has **one** effects unit (Echo, Reverb, Flanger) that can sit on one
deck or on the master at a time. The SB3's two FX units both control it.

- **FX 1 / 2 / 3** on the left = Echo / Reverb / Flanger on the left
  deck. Press again to turn it off. The right-hand FX buttons do the same
  for the right deck.
- Starting an effect on the other side **moves** it there. Unlike Serato,
  you can't run one effect per side.
- **SHIFT + FX 1 / 2 / 3** puts the effect on the **master** output.
- **LEVEL/DEPTH** sets the dry/wet mix. Only the knob on the side with the
  effect does anything (either knob when it's on master).
- The echo length (1/2 beat, 1 beat …) is set on screen, not on the SB3.
- An FX button is lit while its effect is running there.

## Four decks: the DECK buttons

The SB3 has two sides but controls four decks: left = 1 or 3, right = 2
or 4. Press **DECK** to swap. The **whole side** swaps, including that
side's EQ, TRIM, FILTER and channel fader. manadj shows the controlled deck
highlighted on screen.

**Faders and knobs don't jump when you switch decks.** After a switch, a
fader or knob does nothing until you move it to where that deck's setting
already is. The on-screen control pulses to show which way to move. This is
"soft takeover", as in rekordbox. The **TAKEOVER** button in the mixer turns
it off (then controls jump straight to the physical position).

Example: deck 1's fader is up and deck 3's is down. Press DECK, and the
physical fader (still up) does nothing until you pull it down to meet deck
3. Switch back, and you push it up to meet deck 1 again.

The same applies when you first connect, and whenever something changes a
setting on screen.

## Lights

Mapped controls light up to match the screen: PLAY, CUE, SYNC, KEY LOCK,
SHIFT + KEY LOCK (Quantize), VINYL, SLIP, headphone CUE, FX buttons,
pads, and the level meter. Beat Jump pads stay dark. The meter shows each
deck's level before its fader. Red means that deck is clipping, so turn
down TRIM.

## Gotchas and rough edges

Things nobody has tried yet. Please report what actually happens:

1. **Decks may be out of step at startup.** manadj assumes decks 1 and 2.
   If the SB3 was left on 3 or 4, the controls still go to the right deck,
   but the screen highlight is wrong, and the FX buttons put effects on
   the wrong deck, until you press DECK once.
2. **Filter knobs may not swap with DECK.** If deck 3's filter can't be
   reached from the left knob, report it.
3. **FX FADE, PAD SCRATCH and TRANS** are run by the SB3 itself. They may
   move faders, filters or the jog behind manadj's back, or do nothing.
   TRANS (a volume chop) may fight soft takeover. Avoid them for now.
4. **MASTER CUE** (master in the headphones) does nothing yet. On some
   controllers it's built into the hardware; it may need manadj support on
   the SB3.
5. **Jog feel** is borrowed from the DDJ-GRV6 and not tuned for the SB3.
   Scratching or nudging may feel too fast or too slow.
6. **Tempo direction**: if pushing the tempo fader away from you speeds the
   track up instead of slowing it down, report it.
7. **Mode button lights**: if the pad mode buttons don't light up to show
   the current mode, report it.
8. **Audio channels**: if MASTER plays in the headphones (or the reverse),
   swap the output pairs in the top bar and report it.
9. **Effects follow the DECK button.** With Reverb on deck 1, switching
   the left side to deck 3 leaves Reverb on deck 1. The left FX lights go
   dark, because they now refer to deck 3.

## Open questions for after first use

- Should 1/2X / 2X default to beat jump or loop size?
- Is SHIFT + KEY LOCK a comfortable spot for Quantize?
- Would you rather Roll pads play only while held (as in rekordbox)?
- Should the two FX units be independent, one effect per side?
