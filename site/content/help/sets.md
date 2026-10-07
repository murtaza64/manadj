---
slug: sets
draft: true
title: Plan and play a Set
summary: Arrange Tracks, choose the saved moves between them, and use the Conductor to play the plan or hand control back to you.
order: 6
related: [curate, editor, perform]
shot: set-motion
clip: set
caption: Set playback advances through the plan while the Conductor drives the shared Decks.
---

## Arrange Tracks and pin moves {#planning}

Click **+ New… → Set** in the sidebar and enter a name. Drag Library Tracks onto the Set, or right-click a Playlist and choose **New set from playlist** to copy its Play order. That copy is independent of later Playlist edits.

Open the Set and drag rows to arrange them. Each gap between neighboring Tracks is an adjacency. Open its pin picker to choose a saved Transition, a specific Take, or **Hard-cut**.

- **Unresolved** uses the pair's best saved Transition at plan time: Favorite first, otherwise most recently edited. Without one, it cuts.
- **Auto-fill** freezes available auto-resolved Transition choices as pins. It does not choose Takes.
- **Resolve from evidence** previews Take choices for remaining unresolved gaps; review the short Takes and remaining cuts before confirming.

A pin stays fixed when other Transitions are saved. Reordering keeps broken adjacency pins Dormant; restoring that ordered pair restores its pin. To edit a move, open it in the [Mix editor](../editor/index.html#editing).

For longer choreography, the picker can offer a Routine matching the next group of Tracks. A Cameo belongs to its host entry and brings in a guest without adding another step to the Set order.

## Play and inspect the plan {#playback}

Click **Play set**. The **Conductor** loads Tracks and performs the pinned moves on the shared Decks and Mixer. The first Track starts at its beginning. A hard cut waits for the outgoing Track to end, then starts the incoming at Hot Cue 1, or its beginning if that cue is unset.

Click the **Overview ladder** to seek, including into a Transition. Use the Set transport to pause or resume; Stop pauses the Decks. Zoom or pan the ladder to inspect a handover, and hover warning badges for plan problems.

Choose **Riding** to let incoming Tracks ease back to native tempo between handovers, or **Fixed** to set one BPM for the Set. Overlapping handovers can shorten a departing Track with a Grace fade; inspect and listen to flagged overlaps.

## Take over and pick up {#takeover}

Move any live Deck or Mixer control to stop the Conductor's automation. The Decks keep playing, and you are mixing live. Take capture resumes at takeover; automated Set playback itself does not create Takes.

Click **Pick up** to resume the plan when the live Deck state matches it. If unavailable, hover for the reason. A misaligned blend may need its stray Deck faded out first. Pick up during an unfinished Handover abandons that in-flight capture rather than completing a Take by machine.
