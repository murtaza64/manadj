---
slug: analysis
title: Analysis and waveforms
summary: Check a track's key and Beatgrid, correct its timing, and adjust how waveforms look.
order: 7
related: [curate, perform, sync]
---

## Check the analysis {#analysis}

New tracks receive Analysis in the background. Waveforms, keys, and Beatgrids may still be processing after an Import finishes; you can browse the Library while you wait.

1. Load the track you want to check. Selecting its Library row alone does not load it.
2. Listen while watching the beat lines. Check both an early passage and a later one: a grid can start aligned and drift later.
3. To run Analysis again, click **A** beside the BPM and grid controls. Its tooltip reads **Analyze grid and key**. The button shows an ellipsis while Analysis is pending or running.
4. Check the result by ear before using it for beat jumps or loops.

Automatic Analysis preserves imported or hand-edited keys and Beatgrids. Clicking **A** is an explicit re-analysis and can replace those values; it is not a preview.

For a small timing offset, use the grid-nudge arrows. To establish the downbeat, position the playhead and choose **Set downbeat at playhead**. These change the track's saved Beatgrid. A performance Nudge only bends playback temporarily.

If Analysis cannot fit a reliable grid and no saved grid exists, the track appears in **Needs attention** in the Library sidebar. Retry Analysis, edit the grid, or [import a saved grid from Engine DJ](../sync/index.html#import). The worklist clears when the track has a saved grid; a generated placeholder is not enough. Analysis does not place Hot Cues for you.

## Change waveform appearance {#waveforms}

1. Open **Settings → Display → Waveforms** with a track loaded.
2. Choose the **full** or **minimap** editing slot.
3. Pick a **Waveform color style**. Adjust display gamma, master display gain, band gains, colors, or **smooth color** while watching the waveforms above.
4. Switch slots to tune the other view independently. Library-row waveform previews use the minimap style.

These are saved display preferences, not audio EQ. They apply immediately and need no re-analysis. **style default colors** resets only the custom colors for the selected slot; **Reset waveform defaults** resets both slots. If the waveform itself is missing after an Import, changing colors will not finish its background processing.
