# 25 — Pickup during an editor audition creates dual deck drivers (choppy Deck B)

(Renumbered from 24, 2026-07-05 — parallel filing collided with 24-live-replan.)

Status: done (implemented + auto-landed 2026-07-05, change `kqsnsvxs`, lane setlist; bugfix policy)

## Parent

.scratch/sets/PRD.md

## Problem (diagnosed 2026-07-05, live incident)

Symptom: in the Transition editor, Deck B audibly rubber-bands — few-ms
jumps, "speeding up/slowing down repeatedly". Performance mode clean;
tempo match irrelevant; appears after having used Set playback; cleared
by hard refresh; not casually reproducible.

Root cause — three facts that compose:

1. The Pickup predicate checks deck/mixer state only — it never consults
   the audible-surface holder. Editor auditions play Set tracks audibly
   through the shared decks, so the Pickup control LIGHTS during an
   editor audition (the Set pane sits under the editor).
2. `Conductor.pickup()` activates with `silencePrevious: false` (by
   design — adopt the live state), so the displaced holder is never
   silenced.
3. The Transition editor has no displacement stand-down: unlike the
   Conductor (whose `subscribeAudible` hook stands it down when another
   claimant takes the holder), a displaced-without-silence MixPlayer
   keeps its rAF loop conducting.

Result: two conductors drive the shared decks. Pickup's anchor-deck
contract (anchor untouched) concentrates the fight on the NON-anchor
deck — hence B-only wobble: Conductor enforces plan position + pickup
pitch ramp; MixPlayer enforces its arrangement; B gets alternating
seeks and rate writes.

Repro: Play set → stop → open the editor on a pair that is in the Set →
play the audition → press Pick up in the Set pane below → B wobbles.

## What to build

Two fixes — the semantic one and the invariant one; do both:

1. **Pickup refuses non-performance holders.** The predicate is unlit
   (with reason, per the Pickup glossary entry's reason-teaches-the-fix
   pattern: e.g. "editor is auditioning") whenever the audible-surface
   holder is not the shared performance surface. You cannot "pick up
   from" an editor audition — its deck state is mix-timeline semantics,
   not a live performance.
2. **The editor stands down on displacement.** TransitionEditor
   subscribes to holder changes (exactly like the Conductor's own
   stand-down hook) and pauses its MixPlayer when another surface takes
   the holder. This restores the invariant for ALL future claimants:
   at most one driver conducts the shared decks, ever, regardless of
   silencePrevious semantics.

## Acceptance criteria

- [x] Pickup control unlit during editor auditions, with a displayed reason
- [x] A displaced editor's MixPlayer pauses (no rAF driving after holder change)
- [x] Regression test at the arbiter seam: editor claims + plays, conductor
      pickup attempted → either refused or editor demonstrably stops
      conducting; the fake decks receive commands from at most one driver
      (harness prior art: `mixPlayerSteadyState.investigation.test.ts` on
      the chopb lane, change syonswzu — fake engines with action logs)
- [ ] Ear check on the repro recipe above: no B wobble (residual — human;
      structurally covered by the seam repro test, see Done comment)

## Notes

- `Conductor.ts` / pickup territory is lane `setlist`'s (issues 21/22 in
  flight there) — route this to that lane; coordinate before touching.
- The investigation harness (chopb lane) also established MixPlayer's
  steady-state is clean and pure clock skew is too slow to explain the
  symptom — worth folding the zero-corrective-actions assertion into the
  editor's test suite while in there.

## Blocked by

- Coordination only: lane setlist's in-flight 21/22 (same files)

## Comments

**2026-07-05 — second symptom traced to the same root.** "Occasional
failure to apply envelopes during transition audition" is this bug twice
over: (a) during the dual-driver fight, the Conductor's tick writes plan
lanes (fader open, EQ flat between windows) through `setAutomation` every
frame — last-writer-wins buries the editor's drawn envelopes; (b) when
the dual-driver Conductor exits by any path with `disengage: true`
(stop, 'ended', takeover), it disengages the automation overlay out from
under the live editor session — the overlay engage/disengage is a bare
boolean, so MixPlayer's per-tick `setAutomation` writes go nowhere until
the editor remounts. Add a third fix to the two above:

3. **Overlay ownership token**: `engageAutomation()` returns/records an
   owner; `disengageAutomation()` is a no-op for non-owners (or asserts).
   A session that no-opped its engage (already engaged) must not be able
   to lose the overlay to the prior owner's teardown. Cheap invariant,
   protects every current and future engager pair.

Acceptance addition:
- [x] With the editor auditioning, a Conductor stop/end/takeover never
      disengages the editor's overlay (envelopes keep applying)

**Implemented (2026-07-05, jj change `kqsnsvxs`, lane setlist — built on 21's lazy-claim lifecycle `xlmtsrpk`):**

All three fixes:

1. **Pickup refuses non-performance holders.** `PickupSnapshot` gained
   `holder` (read from `audibleHolder()` in `readPickupSnapshot` — the
   predicate stays pure, consuming it as snapshot data). `evaluatePickup`
   refuses any non-`'shared'` holder first, with reason
   `'not-performance'` and a teaching message ("The editor is
   auditioning — stop the audition and the button lights"). The Set
   pane's poll and the executor's fresh re-read both flow through it —
   the button is unlit with the tooltip reason, and a stale click is a
   pure no-op (no Conductor, no engine writes, no claim). CONTEXT.md's
   Pickup entry updated.
2. **The editor stands down on displacement.** TransitionEditor's
   registration effect adds a `subscribeAudible` hook (mirror of the
   Conductor's): holder moves off `'editor'` → `player.pause()`. Belt
   and suspenders: MixPlayer's tick pauses itself when `audible()` goes
   false — the rAF loop is the driver, so the at-most-one-driver
   invariant is enforced at the loop for any future claim path that
   skips silence().
3. **Overlay ownership token.** `Mixer.engageAutomation()` returns an
   owner token; the LAST engager owns (an engage over a live overlay
   adopts it — mirroring the arbiter's last-claim-wins).
   `disengageAutomation(owner)` is a warned no-op for non-owners.
   Conductor and TransitionEditor thread their tokens through teardown.

Interaction matrix (21 × 25), verified at the seams: Conductor playing →
enter editor (keeps playing, 21) → editor play (Conductor stands down;
editor's engage adopts the overlay) → Pick up in the Set pane: UNLIT,
reason shown (fix 1) → stop audition → Pick up lights when the deck
state maps (companion regression test).

**Verification (agent, 2026-07-05):** `npx vitest run` 1065 passed —
incl. new: pickup.test.ts non-performance-holder describe;
pickupDualDriver.test.ts (arbiter-seam repro: editor claims + plays,
pickup attempted → refused, no Conductor, action-log fake decks receive
zero commands from the attempt, audition keeps playing; companion: same
deck state lights and executes once the editor releases);
MixPlayer.test.ts displacement backstop + steady-state
zero-corrective-actions (chopb's assertion folded in per Notes);
mixer.test.ts owner-token describe (incl. the issue-25 interleave:
editor overlay survives a stale Conductor teardown, envelopes keep
applying). `uv run -m pytest` 666 passed; frontend build clean;
`alembic heads` → one (0022); eslint clean on touched files. Ear check:
not performable by the agent — replaced structurally (the repro's
button is unlit/disabled and its executor refuses; the wobble requires
two drivers, and the regression test pins at most one) — flagged as the
one residual human check.
