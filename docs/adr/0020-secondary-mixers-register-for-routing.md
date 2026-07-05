# Secondary mixers register for device routing

Status: accepted (headphone-cue 06 post-mortem)

The Transition editor's private Mixer (its audio isolation, tolerated
against ADR 0009's one-context intent and policed by ADR 0013's arbiter)
was invisible to device routing: headphone-cue 04 applied the saved
master sink to the shared Mixer only, so editor playback went to the
system default device — for a DJ with a configured cue device, the
headphones. Third tax on the private-mixer decision, after the arbiter
(clock stutter) and ADR 0019 (hardware addressability).

Decision: `routingStore` owns a registry. Any Mixer other than the shared
one MUST `registerRoutedMixer(mixer)` for its lifetime; the store applies
the resolved MASTER sink to every registered mixer, immediately on
registration and on every recompute. The cue sink stays exclusive to the
shared Mixer — a secondary cue bridge would double the headphone feed.
The rule for future features on "the" mixer: if it concerns where audio
COMES OUT, it goes through routingStore, which knows every mixer; if it
concerns the graph inside one mixer, it may stay per-instance.

## Considered options

- **Fold the editor onto the shared Mixer/context** — the real fix: one
  context, ADR 0009 restored, the arbiter's reason-to-exist retired, and
  this class of bug (features landing on one mixer, missing the shadow
  one) impossible. Rejected *for now*: it re-opens deck-count, channel
  strip ownership, and editor audio isolation in one move — a re-grill,
  not a bug fix. This ADR is the interim rule until that happens.
- **MixPlayer applies the sink itself** (read routing snapshot, subscribe)
  — rejected: re-states routing policy in a consumer; the next private
  mixer forgets again. The registry keeps one owner.

## Consequences

- `registerRoutedMixer` returns an unregister; MixPlayer holds it for its
  lifetime (dispose unregisters).
- Regression tests live at the routingStore seam with fake mixers
  (routingStore.test.ts) — the first tests this store has.
- The deep fix (single context) is tracked as a deepening opportunity for
  an architecture pass, not scheduled.
