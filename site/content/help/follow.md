---
slug: follow
title: Find the next Track with Follow
summary: Follow loaded Decks to browse candidate Tracks, then adjust matching and Temperature without changing what is playing.
order: 3
related: [curate, perform, analysis, editor, sets]
shot: follow
caption: Follow filters the browse list around loaded Tracks and shows candidate matching.
---

## Turn on suggestions {#suggestions}

1. [Load a Track](../perform/index.html#loading) onto a Deck.
2. In the Library filter bar, click that Deck's **A**, **B**, **C**, or **D** Follow button. An empty Deck cannot supply a reference.
3. Browse the resulting list, then load a candidate onto another Deck when you are ready.

Follow changes the browse list; it does not load or play a suggestion. Once enabled, it follows playback: starting another Deck spreads Follow to it, and pausing a Deck removes it while another plays. The last followed Deck stays selected through silence. Playing alone never turns Follow on from scratch.

When several Decks are followed, candidates can match any of them. **Known** Tracks have a saved Transition from a followed Track or are Linked with it. They stay above heuristic **Compatible** suggestions, even when their metadata would not qualify.

Compatible matching considers BPM, including half/double-time relationships. Key relation, shared Tags, and Shared artist contribute musical affinity; BPM proximity and Energy shape the Match score. A clashing Key does not automatically exclude a Track, but nearby BPM alone is not enough.

## Adjust the candidate list {#matching}

Click the gear beside the Follow buttons to open **Follow Parameters**. Adjust the BPM tolerance or select **Known only**. Changes apply immediately; **Reset** restores the parameter defaults.

If the list is unexpectedly short, turn off Known only and check your text, Tag, and other Library filters. Those still narrow what you see. Missing metadata supplies less matching evidence: [curate Tags and Energy](../curate/index.html#tags) or [check Analysis](../analysis/index.html) before assuming a Track cannot fit.

## Add variety with Temperature {#temperature}

Find **TEMP** in the Compatible section. At **0**, candidates follow descending Match score. Drag or scroll toward **1** for a more varied, score-weighted order. Double-click the control to reset it.

Click **Reroll** for another ordering at the same Temperature. It changes neither admission nor displayed scores, and Known ordering stays fixed. Filtering and ordinary redraws do not keep reshuffling the list.

An explicit column sort overrides Temperature. If TEMP is disabled, click the **Match score** header to return to score-based ordering. Temperature is remembered; Reroll chooses a new draw for this session.
