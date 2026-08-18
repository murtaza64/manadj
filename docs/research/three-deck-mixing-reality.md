# Three-deck mixing reality (session-data analysis, 2026-08-18)

What the persisted Sessions say about real 3/4-deck play, and its bearing
on four-deck-performance phases 2–4 (issues 09–14). Method: replayed all
20 non-empty Sessions (Aug 13–18, ~10.2h Master-audible time) through the
one audibility definition (`backend/session_audibility.py`), measuring
audible-deck-count over time, per-pair handovers (overlap where the
outgoing goes silent and the incoming persists ≥5s), 3+-audible stretches
and their context, and sustained-track deck-rotation chains.

## The picture

1. **The base texture is a two-deck A↔B conversation.** 97% of audible
   time has ≤2 decks audible (1-deck 37.5%, 2-deck 59.4%, 3-deck 3.1%).
   Four decks were NEVER simultaneously audible in ~10 hours.
2. **The third deck is D, in two distinct roles:**
   - **Rotation deck**: 158 sustained track changes ran through D, all
     with distinct tracks (zero doubles). Rotation chains: A→B 338,
     B→A 323, then D→A 47, B→D 43, A→D 36, D→B 32. The sequences show
     D-interludes: `…ABAB DAD BAB…`, with `ADADADAB` runs in the long
     session. Three-deck rotation is real but bursty — stretches of
     3-deck rotation inside long A↔B runs.
   - **Accent layer**: 102 brief 3-audible stretches (median 10.2s, max
     37.6s; 100/102 under 30s; none held a loop at entry). Plus heavy
     hot-cue/preview stab use on D (253 stabs — audibility-inert by
     design, correctly so).
3. **Deck C is nearly unused**: 8.8 audible minutes total (vs D's 101),
   13 rotations, 20 handovers. Three decks is the practical ceiling of
   this style; the fourth is headroom.
4. **The killer interaction: 101 of 102 accent stretches landed INSIDE an
   in-flight 2-deck blend.** Phase-1's >2-audible self-gate doesn't just
   blind 19 minutes — entering suspension DISCARDS the in-flight
   engagement, so a 10-second D-accent over an A→B blend destroys the
   Take of that blend. Accent-over-blend is not an edge case; it is the
   single most common 3-deck event in the data.
5. **26% of pairwise handovers involve C/D** (214 of 816 approximated;
   194 involve D specifically) — all invisible to the phase-1 A/B
   machine.

## Bearings on the designed work

### Take detection (issues 09–11: 12 ordered pair machines)

- **The pairwise design is validated.** Real 3-deck play decomposes into
  pair handovers plus short accents; nothing n-ary showed up (2 sustained
  triples in 10 hours, longest 38s).
- **The biggest single payoff is killing the global >2 self-gate**, not
  the new pairs: per-pair machines that ignore third-deck audibility
  recover the 101 accent-covered blends AND the 214 C/D handovers. Issue
  10 should state explicitly that the global suspension dissolves (each
  pair machine gates on its own pair), rather than replicating the gate
  per machine.
- **Pair priority**: A↔B ≫ A↔D ≈ B↔D ≫ everything with C. A/B/D coverage
  captures ~99% of observed evidence. If 12 machines are built at once
  this is moot; if phased, phase by pair.
- **Self-pairs (doubles)**: zero observed in 158 D rotations. Keep the
  liberal per-ordered-pair rule but don't spend design effort on doubles
  yet.
- **Accents mostly won't emit Takes** (10s median is under any sane
  incoming-persistence threshold) — good; no spurious-take flood. The
  engagement grouping (issue 11) matters mainly for the D-interlude runs
  where one rotation burst emits 2–3 real pairwise Takes.

### Transition editor (issue 12: arbitrary pair as roles)

- Validated: role-pairwise (outgoing/incoming) covers everything
  observed; no n-ary editor need.
- Physical-pair priority for the picker: A↔D and B↔D.
- Note for the issue: Takes born under an accent carry a third deck's
  audio in their window; the role-pair lanes won't reproduce the accent
  on audition. Acceptable, but say so in the editor's contract.

### Set construction (issues 13–14: dynamic deck pool)

- **The A→B→C→D dynamic pool is over-provisioned for this style**: pure
  ping-pong reproduces ~89% of rotations; a three-deck pool (A/B/D
  pattern) covers ~99%. The grace-fade-when-all-four-occupied rule will
  essentially never fire for sets authored from this material. Fine to
  build as designed — but it is not where the style's fidelity lives.
- **The actual gap for authored sets is the accent**: a ~10s third-deck
  cameo inside a transition doesn't fit the linear pair-transition model
  at all. If Sets should reproduce this user's real style, the deferred
  Cameo concept (issue 09's deferral) is the missing piece — a third-deck
  stab/layer attached to a Transition, not a new Set entry. The
  D-interlude pattern, by contrast, needs nothing: it is already linear
  rotation.

## Numbers caveat

Handover counts here are a liberal span-overlap approximation (they
overcount vs the detector's settlement criteria — e.g. 602 A/B
approximations vs ~260 detected Takes on the same data). Treat ratios and
patterns as the signal, not absolute counts.

Analysis scripts were throwaway (session-data replay via
`backend/session_audibility.py`); regenerate from this description if
needed.
