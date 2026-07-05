# Set adjacencies may pin unpromoted Takes

Status: accepted (sets grilling 2026-07-05)

ADR 0020 established Takes as **audit data**: raw capture evidence, listed in the
Transition history, "never in the Transition library" — usable only after
promotion idealizes them into a saved Transition. Sets deliberately breach that
stance in one narrow place: a Set adjacency may pin a Take directly, by uuid,
without promoting it.

The rationale is the once-recorded handover: a pair was mixed live exactly once,
the Take exists, no saved Transition does. Requiring promotion before that
handover is usable in a Set forces a curation decision ("is this library-worthy?")
just to answer a planning question ("what plays at this handover?"). The pin keeps
those decisions separate.

The breach is bounded by three rules:

- **Pinning a Take is always a manual act.** Auto-fill proposes Transitions only
  (favorite first, else the sole Transition); unreviewed material enters a Set
  only by explicit choice. Discovery is also unchanged: Follow mode's known tier
  still excludes Takes — pinning is the only non-audit use of an unpromoted Take.
- **Take pins play their idealized vectorization computed at play time**, using
  the same vectorizer promotion runs (ADR 0020). Nothing is snapshotted into the
  Set; vectorizer improvements flow through automatically.
- **Promotion re-points the pins.** Promoting a Take rewrites every Set pin
  referencing it to the resulting Transition's uuid, at promotion time (the Take
  row already records its promoted Transition). Deleting a pinned Take degrades
  the pin to unresolved — library cleanup never corrupts a Set.

## Considered options

- **Auto-promote on pin** (pinning a Take silently saves a Transition) —
  rejected: sprays uncurated Transitions into the library, corrupting the
  "what mixes well" signal that promotion-as-quality-gate exists to protect
  (ADR 0020's own rejection of auto-saving captures, resurfaced through a
  side door).
- **Snapshot the vectorized data into the adjacency** (pin stores cooked lanes,
  not a reference) — rejected: same freezing problem as cooked Takes in
  ADR 0020; the Set would play a stale vectorization after the vectorizer
  improves, and the snapshot is a second copy of transition data with no
  owner in the library.
- **Keep the pure stance** (Sets pin Transitions only) — rejected: the
  once-recorded handover then requires promotion-as-ceremony, and the
  rehearsal-planning loop (pin what you have, practice what's missing)
  loses its cheapest move.

## Consequences

- "Takes are audit data" is now "Takes are audit data, except as explicit,
  re-pointable Set pin targets." CONTEXT.md's Take entry records the exception.
- The Conductor (later issue) must vectorize Take pins at plan time; the
  planner treats the result exactly like a pinned Transition.
- The backend stores pin uuids as asserted (no FK): pin integrity is a
  client-side degradation rule, matching the dangling-reference decision in
  the sets PRD.
