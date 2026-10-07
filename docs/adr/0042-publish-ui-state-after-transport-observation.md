# Publish UI state after transport observation

Status: accepted for implementation; #13 parks for review.

- Deck, Sync Group and Follow state remain authoritative and synchronous.
  Capture, takeover, readiness and gesture cleanup keep their immediate observers.
- React reads through `presentationOf`: immutable snapshots published together
  in a later task, before notifying any presentation observer. Multiple source
  updates may become one UI update; domain edges are never coalesced.
- A microtask would still precede the next keyboard task. A zero-delay timer
  yields without imposing a full animation-frame delay on Deck feedback. This is
  not a real-time scheduling guarantee; browser input latency remains measured.
- Commands check live state and track identity, not published display flags.
  Waveform motion keeps the authoritative audio clock; structural UI metadata
  uses published snapshots. Publication subscriptions detach and discard pending
  work when their last observer leaves.
- Follow owns admission, factual rank, matching signals and list projection.
  Library and playlist views reuse those results for sorting and decoration.
  A bounded scoring-fact identity cache shares evidence across query keys;
  same-ID fact changes invalidate it. Weak caches retain rows only while used.
  Temperature and column sorts only re-project results.
- Follow reference facts are subscribed queries. Unresolved candidate queries
  remain distinct from resolved empty results, and each reference's BPM gate
  and affinity test stay paired before union.
- A scoring worker is deferred: first remove repeated work and measure remaining
  cache-miss long tasks. The keyboard timestamp correction remains independent.

ADRs 0008, 0009, 0022, 0031 and 0033 remain in force.
