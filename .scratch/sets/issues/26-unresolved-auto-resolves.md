# 26 — Unresolved adjacencies auto-resolve; explicit Hard-cut pin

Status: ready-for-human

## Parent

.scratch/sets/PRD.md (decided 2026-07-05; CONTEXT.md Unresolved + Hard-cut pin + Set playback updated)

## What to build

Model revision: an **Unresolved adjacency resolves at plan time** to the pair's best saved Transition — **favorite first, else the most recently edited** — and hard-cuts only when the pair has no Transitions. Unresolved is deliberately library-live: saving or favoriting a Transition upgrades every unresolved adjacency for that pair, everywhere, immediately (with 24, even mid-playback). Pinning freezes; a new explicit **Hard-cut pin** kind forces a cut even when Transitions exist.

- Resolution lives in the shared adjacency-view / plan-input layer so the ladder, badges, list rows, Conductor, and practice affordance all agree.
- Pin picker gains "hard cut" as a selectable option alongside the pair's Transitions and Takes.
- Persistence: new pin kind on the Set entry (client-authoritative like the rest); no change to Transition/Take pin semantics; Dormant-pin machinery treats a Hard-cut pin like any pin (dormancy round-trips it).
- Badges: the red hard-cut chip (20's styling) appears only when a cut will actually play — no evidence, or explicit Hard-cut pin; an auto-resolved adjacency shows the resolved Transition's chip with a subtle "auto" mark distinguishing it from a pinned one. UNPRACTICED unchanged.
- Auto-fill's role shrinks to what it still adds: bulk-pinning (freezing) auto-resolved choices; the entry rule for actual cuts stays 19's (Hot Cue 1 → start).
- Take pins are untouched: Takes never auto-resolve (unreviewed by definition).

## Acceptance criteria

- [ ] Unresolved adjacency with saved Transitions plays the favorite (else most recently edited) — in the plan, the ladder, and audibly
- [ ] Saving a new Transition for such a pair upgrades the adjacency without any user act (and live, once 24 lands)
- [ ] Hard-cut pin selectable in the picker; forces a cut despite available Transitions; survives dormancy round-trips
- [ ] Red hard-cut chip only on actually-cutting adjacencies; auto-resolved chips visually distinct from pinned ones
- [ ] Pinned adjacencies (Transition/Take) behave exactly as before — resolution never overrides a pin
- [ ] Resolution logic pure + tested at the adjacency/planner seam

## Notes

- Sequencing: touches `SetDetailPane` rows/badges (rows bundle 23/18/20 in flight on setui) and plan-input assembly (25 in flight on setlist) — dispatch after both park/land. Natural home: whichever lane frees first, with the other's landing rebased over.
- Softened invariant, recorded deliberately: unpinned playback may change as the library evolves — the original grill's determinism concern is now scoped to *pinned* adjacencies only (product-owner decision 2026-07-05).

## Blocked by

- Soft: rows bundle (23/18/20) and 25 in flight

## Comments

**2026-07-06 — implemented (lane setrows, change `lmmppypt`); ready-for-human.**

Where things landed:

- Resolution is pure + tested at the shared seam: `resolveTransition`
  (favorite first — most recently edited favorite among several — else
  most recently edited, ties to the later sibling) and `resolvePlanPins`
  in `frontend/src/sets/adjacency.ts`, covered by `adjacency.test.ts`.
  `adjacencyView` applies the same rule for badges/click-through.
- Plan input: `useSetPlanParts` resolves entries before `planSet`, so the
  ladder, list rows, Conductor (via ConductorPlanFeed → live replan) and
  practice all agree. **Seam note for lane conductor:** `PlanInput`'s
  SHAPE is unchanged; entries now arrive with auto-resolved transition
  pins already injected, and the `'hardcut'` pin kind may appear in
  `PlanInput.entries[].pin` (the planner's `resolvePin` falls through to
  a cut for it). `replan.ts`, `Conductor.ts`, conductorStore untouched.
- "Most recently edited": `Transition.updated_at` now rides the GET wire
  → pairStore (`SavedTransition.updatedAtMs`), stamped locally on
  value-changed saves so recency is live within a session.
- Hard-cut pin: `{ kind: 'hardcut' }` (no uuid) across store/wire/schema;
  picker gained "✕ Hard cut — play no transition"; unpin relabeled
  "Unpin (auto-resolve from the library)". Migration `0023_lmmppypt`
  relaxes `set_dormant_pins.pin_uuid` to nullable (dormancy round-trips
  hard-cut pins); single alembic head verified.
- Badges: red `✕ hard cut` chip only when a cut actually plays (explicit
  pin, or zero evidence); auto-resolved shows `◇ name · auto` (dimmer,
  hollow diamond) vs the pinned `◆ name`; per-row `↳ pin` freezes the
  choice; header Auto-fill = bulk freeze. Dangling Take pins degrade to
  the cut chip (a broken manual act is never auto-swapped).
- Gate: pytest 675 ✓, vitest 1174 ✓, build ✓, ruff (touched) ✓, one head ✓.

**Verification walkthrough** (lane app running: http://localhost:5363):

1. Open a Set with tracks whose pairs have saved Transitions. Any
   unpinned adjacency with evidence now shows a dim green `◇ … · auto`
   chip instead of red — the ladder shows a real window there, and the
   overlap-time cell fills in. Red `✕ hard cut` remains only on pairs
   with no Transitions.
2. Click an auto chip → picker: pick "✕ Hard cut — play no transition".
   The chip turns red+bold despite available Transitions; the ladder
   shows the cut blade. Reorder the pair apart and back — the hard-cut
   pin survives (dormancy round-trip).
3. On an auto adjacency, click `↳ pin` — chip goes solid `◆` (frozen).
   Then in the editor favorite a DIFFERENT sibling of that pair: the
   pinned chip must NOT change; a neighboring auto chip for the same
   pair (if any) re-resolves to the new favorite immediately.
4. Live upgrade: play the set through an auto-resolved handover's pair,
   then save/favorite a new Transition for an upcoming unpinned pair —
   the plan recomputes live (ladder window appears mid-playback, sets 24).
5. Header Auto-fill now reads as "freeze" (count = auto-resolved rows);
   clicking it pins every `◇` chip solid.

**2026-07-06 — review follow-up (amended into `lmmppypt`).** Take-available
indicator: an adjacency that will CUT while the pair has recorded Takes now
grows a mauve `● take available — pin?` chip (Takes never auto-resolve, so
this was the one invisible manual option) — click opens the pin picker.
Shown only on unresolved cuts: suppressed when a Transition plays (the
counts cell already shows `· N tk`), on explicit Hard-cut pins (a
deliberate cut is not nagged), and while the fresh-take offer is showing
(one mauve chip at a time). Walkthrough addition: find an adjacency whose
pair has Takes but no Transitions — the red cut chip sits beside the mauve
offer; click it and pin the Take from the picker.
