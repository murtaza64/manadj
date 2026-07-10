# Metric ladder: layered over the Beatgrid, irregularity as full-ladder reset marks

We need hypermeter (2/4/8/16-bar grouping) for waveform display, phrase-aware snapping/jumps, transition templates, and eventually phrase analysis — including irregular structure (fakeout-drop extensions, pickup bars, inserted bars). We decided: the Metric ladder is a **separate artifact layered over the Beatgrid's downbeat lattice** (the Beatgrid stays sole authority on beats and bars; sub-bar strong/weak grouping is a projection of the time signature), shaped as an **ordered arity stack up from the bar** (duple by default, arity 3 admissible per tier) plus **reset marks** — downbeats where every tier recounts from 1, stored as track-time seconds and resolved to the nearest downbeat at read.

Parenthetical ("extra") bars are **derived, never stored**: between marks, complete groups form bottom-up and a trailing incomplete group is the parenthetical, with the discipline that orphans must trail — a leading orphan (pickup) is isolated by one more mark. The default ladder (duple, origin = Grid origin, no marks) is computed on demand and never persisted, mirroring the placeholder-grid posture; only deviation is saved. The ladder is manadj-internal: outside Divergence, Sync, and Export.

## Considered options

- **Unified meter model** (ladder owns everything above the beat; time signature becomes a bottom-tier projection): conceptually pure, but rewrites `tempo_changes_json` — the most load-bearing stored artifact — and every grid consumer and import path, for no display win. Rejected.
- **Insertion marks** (annotate specific bars as outside the count): more literal music theory, but forces the user to identify *which* bar is parenthetical, which is harder to hear than "the count restarts here". Rejected.
- **Full meter segments** (tempo_changes-style: start + arities + phase vector per segment): maximally general, miserable to hand-edit, and unneeded — walkthroughs (fakeout extension, 12-bar intro, mid-breakdown inserted bar, leading pickup) showed reset marks express all of them with at most one extra mark. Rejected.

## Consequences

- Tier-selective resets (a higher tier restarting while a lower tier's phase flows through) are deliberately unrepresentable; the backward-compatible escape hatch is an optional per-mark depth ("resets tiers ≥ k"). Per-tier arity editing (triple meter) is likewise deferred until real music demands it.
- Marks are a pure read-time projection: grid nudges, re-tempo, and even full grid replacement never rewrite or invalidate them — a bad re-grid makes marks land visibly oddly, and the fix is fixing the grid. Gridless tracks have an undefined ladder; persisted marks lie dormant until a grid returns.
- Display (and every other consumer) reads only the derived boundary/count projection through one resolver, keeping the representation swappable.
- Grid origin must graduate from a frontend-only helper to a shared, backend-computable definition, since the default ladder anchors on it.
