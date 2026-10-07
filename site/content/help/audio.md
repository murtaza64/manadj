---
slug: audio
draft: true
title: Audio and Cue mode
summary: Route Master and headphone audio, check PFL, and choose how paused Hot Cues behave.
order: 12
related: [perform, start]
---

## Set audio outputs {#outputs}

1. In the top bar, choose the device beside **MASTER** for the sound sent to your speakers. **System default** follows the computer's default output.
2. Choose the device beside **CUE** for headphones. **Off** disables the Cue bus.
3. On a multichannel interface, select explicit stereo pairs. Controller speakers commonly use outputs 1/2 and headphones 3/4; verify yours with **Test tone** under **Settings → Controllers → Controller check**.
4. Adjust the top-bar **MASTER** and **CUE** knobs for their separate levels.

To listen to a track before bringing it into the mix, load it on a Deck and enable that channel's headphone-icon **PFL** button. Start playback and move **CUE MIX** in the Mixer toward cue-only. Toward the other end, it blends in Master; fully right is Master only. Double-click **CUE MIX** to return to cue-only.

PFL hears the channel after EQ and filter, before its fader and crossfader. You can lower the channel fader to keep it out of Master and still hear it through PFL. Beat FX is not included in that PFL tap; use the Master side of CUE MIX to hear its result.

Output choices are saved. If a saved device is unplugged, Master falls back to the system default and Cue turns off. Reopen a selector after plugging a device in if its first list has not updated. For silent headphones, check the Cue output, CUE level, PFL, CUE MIX, and Deck playback separately.

## Choose paused Hot Cue behavior {#cue-mode}

Cue mode controls Hot Cue playback, independently of headphone routing.

Open **Settings → Help → Setup → Cue mode**, choose a mode, and click **Continue**:

- **Gated**: hold a Hot Cue on a paused Deck to preview from it; release returns to the cue.
- **Trigger**: press a Hot Cue to jump there and start playback; releasing keeps it playing.

You can change the saved preference directly with **GATED** in Performance: lit means Gated, unlit means Trigger. It applies across Decks to keyboard, controller, and on-screen Hot Cues. On a playing Deck, both modes jump. The Main cue keeps its hold behavior in either mode.

A Gated preview follows normal mixer routing. Enable PFL and keep the channel out of Master when you want that preview only in headphones.
