---
slug: beat-fx
title: Beat FX and filters
summary: Apply Echo, Reverb, or Flanger to a Deck or Master, and tune the shared sweep-filter sound.
order: 13
related: [perform, audio, controllers]
---

## Use Beat FX {#effects}

The Mixer has one shared Beat FX section. Select one Deck or **MST** for the whole mix.

1. Choose **ECH** (Echo), **RVB** (Reverb), or **FLG** (Flanger) from the effect selector.
2. Select **A**, **B**, **C**, **D**, or **MST** as the target. C and D are available in the four-Deck layout.
3. Set the length with **1/2** and **x2**, or scroll over the length readout.
4. Click **FX** to turn the effect on. Move **DEPTH** left for more original audio or right for more effect. Center is the balance point; double-click returns there.

Echo repeats at the selected beat length. Reverb does not follow the length control. Flanger uses that length for one sweep cycle and reads **bars by default**: **1 BAR** means four beats. Change its **Length unit** under **Settings → Performance → Beat FX** if you prefer beats.

In Performance, with deck keyboard controls active:

- **1–5** select A, B, C, D, and Master respectively.
- **6 / 7** shorten or lengthen the timing.
- **8 / 9** select the previous or next effect.
- Hold **0** and move the mouse to adjust depth; double-tap **0** to center it.
- **-** toggles FX on/off.

If nothing changes, check the target, its channel fader, FX on/off, and depth. **---** disables the section. PFL listens before Beat FX; [blend Master into CUE MIX](../audio/index.html#outputs) to hear the processed mix in headphones. Closing a fader stops new audio entering the effect, but existing tails can ring out. Master uses the last selected Deck target as its tempo source.

## Tune the sweep filters {#filters}

The per-channel filter is separate from Beat FX: turn left for low-pass, right for high-pass, and return to center to open it.

1. Load and play a track, then open **Settings → Performance → Filters**.
2. Choose a filter model and move a Deck's filter to hear it.
3. Adjust **Resonance**, **Peak compensation**, and **Sweep curve** while listening. **Center deadzone** controls the neutral area; **Drive** adds saturation.
4. Use **Reset filter defaults** to restore the starting sound.

Filter and Beat FX sound settings apply live and persist across launches. Filter preferences affect every Deck, PFL, existing Transitions, and Session replays. Changing those preferences does not move the Deck filter controls. Most tuning controls are fixed in **Original 12 dB**; **Peak spread** applies only to **Twin peak 24 dB**.
