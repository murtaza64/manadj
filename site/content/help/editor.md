---
slug: editor
title: Edit and audition a mix
summary: Shape saved Transitions and Routines, review Takes, and author multi-Track material on the Mix editor timeline.
order: 5
related: [capture, sets, perform, analysis]
shot: editor-motion
clip: editor
caption: A saved Transition is auditioned through the shared Decks in the Mix editor.
---

## Open and edit the timeline {#editing}

Open **EDIT** and use the picker at the right to find a mix by its Tracks. You can also arrive from a Set pin or [captured Take](../capture/index.html#takes). Slots represent the Tracks' roles in the mix, not fixed physical Decks.

Start with **Select (V)**. Select a slot, then drag to adjust its placement; the outgoing slot anchors a Transition's timeline. **Pan (H)** moves the view. **Jump (J)** lets you click a waveform to open the Jump/pause popup or drag a span to excise it.

Show the control lanes you need beneath a slot. Use a lane's edit control to open its breakpoint editor. Click the line to add a node, drag nodes to shape the fader, EQ, or filter over time, and double-click a node to delete it. Try a small change first and listen across both ends of it.

Use **Cmd/Ctrl+Z** to undo and **Cmd/Ctrl+Shift+Z** to redo. **Escape** clears a selection or popup before returning to Select. Edits to saved artifacts autosave; review drafts have a separate Promote step.

## Listen through the Decks {#audition}

Press the editor play button or **Space** to audition. The editor loads and plays through the shared Decks and Mixer. Merely opening a mix does not interrupt performance; starting an audition claims the audible surface.

If the button shows loading, wait or press it again to cancel. Use the editor transport to pause. Moving a live Deck or Mixer control is takeover, ending the audition's control of playback. Auditions do not generate new Takes.

## Keep a reviewed Take {#promote}

An unpromoted Take opens as **REVIEW**. Its performance becomes an editable draft through Vectorization; listen before treating that interpretation as the move you want.

Adjust the draft, audition again, and click **Promote** when ready. Your review edits carry into the saved Transition or Routine. Until then, review edits do not persist. Promotion preserves the original evidence; promoting a Handover Take also redirects its Set pins to the saved Transition.

## Start a blank mix {#blank-mix}

Choose **+ New blank mix**, then drag Library Tracks onto the canvas. Place the slots and shape their lanes as above.

Currently, the blank canvas saves automatically as a Routine once it contains **three slots**. Below that, it remains unsaved. For a two-Track handover, select the outgoing and incoming Tracks in the picker and choose **New Transition** instead.

To use the result in a running order, [pin it in a Set](../sets/index.html#planning), then [audition Set playback](../sets/index.html#playback).
