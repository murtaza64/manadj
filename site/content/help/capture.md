---
slug: capture
draft: true
title: Review Sessions and Takes
summary: Revisit live performance events in Sessions and open captured Takes for review before saving reusable mix artifacts.
order: 4
related: [perform, editor]
shot: session
caption: A Session timeline shows Track playback, captured Takes, and control events.
---

## Find a performance Session {#sessions}

Play in [Performance](../perform/index.html). Capture is always on: a **Session** opens when a Deck first becomes audible on the Master bus. Loading Tracks or cueing only in headphones does not open one. Ten continuous minutes without Master-audible performance end the Session; the next audible performance starts another.

Open **Sessions** in the Library sidebar, then click a row to see its timeline. Rows show when the Session started, its duration, audible Track count, and Take count.

To revisit a moment:

1. Zoom with the wheel or pan with the trackpad. Use **fit** to see the whole Session.
2. Click a timeline moment, then its play button to replay from there.
3. Use the replay controls to pause or stop. A manual Deck or Mixer gesture takes over and returns you to live performance.

The **gaps ≥** control collapses long quiet or machine-controlled stretches; uncheck it to inspect their timing. Enable **traces** to examine transport movement.

A Session stores events, not audio. Replay uses the original Tracks through the shared Decks and Mixer. Editor auditions and Set playback appear as machine-controlled stretches rather than captured performance event streams.

## Review a captured Take {#takes}

A **Take** records a detected Handover: the incoming Track becomes audible and the outgoing eventually stays silent. Brief cross-cuts can belong to the same Take. If the original Track survives a guest's appearance, the result can instead be a **Cameo Take**. Cue-bus listening is not a Handover, and a blend is not guaranteed to produce a Take.

Click a Take on the Session timeline, then **open in editor**. You can also find captured evidence in **Transition history** and use its Session link to return to the surrounding performance.

In review, audition the draft and adjust it before [Promote](../editor/index.html#promote). Opening a Take does not add a Transition to the Transition library. The captured evidence stays separate from the saved artifact.

For a suggested multi-Track passage, select its candidate span and trim the edges. Choose **Confirm Routine Take** when it contains at least three Tracks. Confirmation keeps evidence for later review; promotion saves the Routine. A two-Track span offers **Cut Take instead**.
