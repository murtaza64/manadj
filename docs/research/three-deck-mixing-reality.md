# Three-deck mixing reality (session-data analysis, 2026-08-18)

What the persisted Sessions say about real 3/4-deck play, and its bearing
on four-deck-performance phases 2–4 (issues 09–14). Method: replayed all
20 non-empty Sessions (Aug 13–18, ~10.2h Master-audible time) through the
one audibility definition (`backend/session_audibility.py`), measuring
audible-deck-count over time, per-pair handovers (overlap where the
outgoing goes silent and the incoming persists ≥5s), 3+-audible stretches
and their context, sustained-track deck-rotation chains, and (pass 3)
sustained high-gain co-play stretches with their resolutions.

## The picture

1. **The base texture is a two-deck A↔B conversation.** 97% of audible
   time has ≤2 decks audible (1-deck 37.5%, 2-deck 59.4%, 3-deck 3.1%).
   Four decks were NEVER simultaneously audible in ~10 hours.
2. **The third deck is D, and D is a DOUBLE deck** (pass-3 correction —
   an earlier read called D's 3-audible stretches "accents"; gain-level
   analysis shows otherwise):
   - **Sustained co-play doubles**: 124 stretches where D and a host deck
     both sat at high Master gain (≥0.35) for ≥12s — median 24s, max
     105s, **61 min total ≈ 60% of all of D's audible time**. A+D
     (29.7 min) and B+D (31.5 min) are symmetric: D doubles whichever
     deck carries the current track, with distinct tracks (zero
     same-track doubles).
   - **Rotation deck**: 158 sustained track changes ran through D
     (D→A 47, B→D 43, A→D 36, D→B 32 vs A↔B ~660). Sequences show
     D-interludes: `…ABAB DAD BAB…`, `ADADADAB` runs.
   - Heavy hot-cue/preview stab use on D (253 stabs — audibility-inert
     by design, correctly so).
3. **Doubles are ridden through transitions, not dropped out of.** How
   the 124 doubles resolve: **76% collapse back** (D exits, the host
   track continues — a double section inside one track's reign); **20%
   chain** — the next track joins while the double still runs, producing
   rolling chains (`A+D → B in → B+D → A in → A+D…`: one half of the
   double hands over at a time); only **4%** are the strict
   "double out → new track alone". The 102 brief 3-audible stretches
   (median 10.2s) are the CROSSING WINDOWS of these joins/exits, not the
   doubles themselves. 43 of them are D entering during an A↔B blend and
   staying — doubles often START inside a transition.
4. **Deck C is nearly unused**: 8.8 audible minutes total (vs D's 101),
   13 rotations, 20 handovers. Three decks is the practical ceiling of
   this style; the fourth is headroom.
5. **The killer interaction: 101 of 102 3-audible stretches landed INSIDE
   an in-flight blend or running double.** Phase-1's >2-audible self-gate
   doesn't just blind 19 minutes — entering suspension DISCARDS the
   in-flight engagement, so every chained-double handover and every
   double entry over a blend destroys the Take of the underlying pair
   handover. This is the single most common 3-deck event in the data.
6. **26% of pairwise handovers involve C/D** (214 of 816 approximated;
   194 involve D specifically) — all invisible to the phase-1 A/B
   machine.

## Bearings on the designed work

### Take detection (issues 09–11: 12 ordered pair machines)

- **The pairwise design is validated.** Real 3-deck play decomposes into
  pair handovers under a sustained layer; nothing n-ary showed up (no
  4-audible instant in 10 hours).
- **The biggest single payoff is killing the global >2 self-gate**, not
  the new pairs: per-pair machines that ignore third-deck audibility
  recover the 101 gate-nuked pair handovers (chained-double swaps,
  double entries over blends) AND the 214 C/D handovers. Issue 10 should
  state explicitly that the global suspension dissolves (each pair
  machine gates on its own pair), rather than replicating the gate per
  machine.
- **Pair priority**: A↔B ≫ A↔D ≈ B↔D ≫ everything with C. A/B/D coverage
  captures ~99% of observed evidence. If 12 machines are built at once
  this is moot; if phased, phase by pair.
- **Self-pairs (same track on two decks)**: zero observed in 158 D
  rotations. Keep the liberal per-ordered-pair rule but don't spend
  design effort on them yet.
- **Double exits mostly won't emit Takes** (the layer fades back out —
  no incoming persistence) — good; no spurious-take flood. The
  engagement grouping (issue 11) matters mainly for rolling-double
  chains, where one continuous engagement emits a pairwise Take per
  half-swap.

### Transition editor (issue 12: arbitrary pair as roles)

- Validated: role-pairwise (outgoing/incoming) covers everything
  observed; no n-ary editor need.
- Physical-pair priority for the picker: A↔D and B↔D.
- Note for the issue: a Take detected under a running double carries the
  third deck's audio across its ENTIRE window (the common case for
  D-era material, not an edge blip); the role-pair lanes won't reproduce
  the layer on audition. Acceptable, but say so in the editor's
  contract.

### Set construction (issues 13–14: dynamic deck pool)

- **The A→B→C→D dynamic pool is over-provisioned for this style**: pure
  ping-pong reproduces ~89% of rotations; a three-deck pool (A/B/D
  pattern) covers ~99%. The grace-fade-when-all-four-occupied rule will
  essentially never fire for sets authored from this material. Fine to
  build as designed — but it is not where the style's fidelity lives.
- **The actual gap for authored sets is the double**: a sustained
  (24–105s) third-deck layer attached to a track's reign — often
  entering during one transition and, in the chained case, persisting
  through the next — doesn't fit the linear pair-transition model at
  all. If Sets should reproduce this user's real style, the deferred
  Cameo concept (issue 09's deferral) is the missing piece, and it is a
  LAYER SECTION on a Set entry (optionally spanning a transition), not a
  stab. The D-interlude rotation pattern, by contrast, needs nothing: it
  is already linear rotation.

## Numbers caveat

Handover counts here are a liberal span-overlap approximation (they
overcount vs the detector's settlement criteria — e.g. 602 A/B
approximations vs ~260 detected Takes on the same data). Treat ratios and
patterns as the signal, not absolute counts.

Analysis scripts were throwaway (session-data replay via
`backend/session_audibility.py`); regenerate from this description if
needed.
