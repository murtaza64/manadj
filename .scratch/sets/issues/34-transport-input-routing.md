# 34 — Transport input routing: controller = decks, spacebar = Conductor

Status: done (human-approved + landed 2026-07-06, merge `oksyuznn`, lane conductor)

## Parent

.scratch/sets/PRD.md (discussed + decided 2026-07-05)

## Problem

The Controller's play button currently drives the Set toolbar's transport. That violates the gesture-class model: deck transport is a deck-class gesture (ADR 0013), and the Conductor is not an Audible surface (ADR 0024) — its transport is a view-level control. It also undermines takeover coherence: hands on the physical deck controls should always mean the decks.

## Decisions

1. **Controller transport always controls the Decks.** During conduction, controller play/pause is a takeover trigger, exactly like the on-screen deck buttons (the original 04 rule). The Controller gets NO Conductor access in v1 — no hijacked buttons; if ever added, it's an explicit Mapping entry (dedicated pad), never deck play. Transport LEDs mirror deck state (Feedback mirrors on-screen deck reality), not Conductor state.
2. **Spacebar drives the mix-level transport of the current context**:
   - Editor mounted → audition toggle (unchanged)
   - Otherwise, a Set selected (in the mounted browse view) → **Conductor**, including in the Performance view — the set wins over the focused deck; per-deck keys keep deck toggles
   - Otherwise → existing behavior (library deck)
3. **Space resolves statefully, in priority order**: conducting → pause; paused mid-set → resume; stopped with Pickup lit → **pick up**; else → play from start. Pickup outranks restart deliberately: mid-flow recovery is common, accidentally restarting a two-hour set is the worse failure. (Play-from-selected-row stays on the row ▶ buttons; space never targets a row.)

## Acceptance criteria

- [ ] Controller play/pause acts on decks in every mode; during conduction it takes over (Conductor stops, audio continues)
- [ ] No Mapping entry drives the Conductor; transport LEDs follow deck state during conduction
- [ ] Space in the editor: audition toggle, unchanged
- [ ] Space with a Set selected (library and Performance): pause / resume / pickup / play-from-start per the priority order
- [ ] Space with no Set selected: unchanged from today
- [ ] Keyboard focus rules unchanged (no space handling while an input/textarea/contenteditable is focused — the keyboard-focus conventions)

## Notes

- Touches: keyboard dispatch for the browse/Set surfaces, the MIDI dispatch's transport routing (undo whatever wired play→Conductor — find it via the 04/22 changes), conductorStore transport entry points (pickup-lit state already exposed for the toolbar button). No planner/model changes.
- Sequencing: keyboard/MIDI dispatch is app-wide — check `.lanes/` (editor-midi and perfui lanes have historical claims); coordinate if any input-layer lane is active at dispatch time.

## Blocked by

- Soft: 24-live-replan in flight on the Conductor-owning lane (transport entry points may shift under it) — dispatch after 24 parks

## Comments

**2026-07-06 — implemented (change `vkwnvxvv`, lane conductor). Parked ready-for-human.**

What was built:

- **Controller = decks** — `Conductor.activate`'s surface registration no longer exposes a Conductor transport (the sets 04/22 wiring, undone): it registers a PASS-THROUGH to the shared surface's own transport handlers (`sharedTransport()`, new accessor in `playback/audibleSurface.ts` — guards included). The engine emit lands outside the self-op guard, so controller play/pause/cue hits the deck AND reads as a manual gesture → takeover, exactly like the on-screen deck buttons. `transportState` removed from the registration — `audibleTransportOverride` never applies during conduction, so transport LEDs mirror on-screen deck reality. No Mapping entry drives the Conductor (grep-clean in `midi/`).
- **Spacebar = mix-level transport of the context** — new pure seam `sets/spaceTransport.ts`: `resolveSetSpaceVerb(status, pickupLit)` (playing→pause, paused→resume, idle+lit→pickup, idle→play-from-start; pickup outranks restart) + `dispatchSetSpace()` (claims the key whenever a Set is selected — `setStore.getSelectedSetId()`, which Library keeps in sync with the sidebar selection — even while the plan is still assembling, so space never surprise-toggles a deck). Pause/resume go through `conductorTogglePlay`; the idle verbs execute via a registered adapter.
- **`sets/SetSpaceTransport.tsx`** — headless App-level feed (ConductorPlanFeed's pattern, same deliberately-shared query keys): while a Set is selected, assembles its plan (`useSetPlan`) and registers the adapter (pickup evaluates `evaluatePickup` against a fresh snapshot at the keypress — poll-free; `pickupSetPlayback` re-checks and no-ops when unlit, never falling through to a restart).
- **Wiring**: library hub (`useKeyboardShortcuts.ts` space case — Set wins over the focused deck, legacy toggle otherwise) and `PerformanceView.tsx` (space was deliberately unbound; now dispatches the Set context, stays unbound with no Set selected). Editor untouched — its capture listener keeps space = audition. Focus guards untouched in both hubs (isTypingTarget / isGuardedKeyEvent run first).
- `conductorStore.ts` grew `getConductorState()` (non-hook snapshot read).

**MIDI-dispatch coordination note for lane setui (33, controller browse/load):** NOTHING in `midi/dispatch.ts`, `midi/controlRegistry.ts`, `Library.tsx`, or `SetDetailPane.tsx` was touched. The controller change lives entirely in `sets/Conductor.ts` (surface registration) + a new `sharedTransport()` accessor appended in `playback/audibleSurface.ts`. Browse-surface routing is untouched; no conflict with 33's `registerBrowseSurface` gating expected.

Gate on the change: `npx vitest run` 1128 ✓ (new `spaceTransport.test.ts`, Conductor.test.ts "controller transport during conduction"), `npm run build` ✓, eslint clean on touched files. No backend/python changes; no migrations (heads: `0022`).

**Verification walkthrough** (lane app running):

- Open **http://localhost:5343** (or desktop shell: `npm --prefix /Users/murtaza/manadj/desktop start -- --port 5343`). Sandbox DB has Sets "post-forest" (18 tracks) and "FUCKBOY SUMMER VOL 1".
1. Library → Sets → **post-forest**. Press **Space** → the set plays from the start (toolbar shows conducting). Space → pause. Space → resume.
2. While conducting, click a deck's on-screen play/pause (takeover — conducting stops, audio continues). The decks keep sounding where the set left them → press **Space** → **Pickup**: conducting resumes from the live deck state, no restart. (Space only restarts from the top when Pickup is unlit — e.g. after pausing both decks and seeking them away.)
3. Switch to the **Performance** view with the set still selected in the embedded browse → Space drives the same Conductor transport there. d/k still toggle the individual decks (takeover as before).
4. Select a **playlist** (not a Set) → Space back to legacy: library view toggles the focused deck; Performance view does nothing.
5. Transition editor → Space auditions, unchanged.
6. Controller (if attached): during conduction, the hardware play button toggles the DECK and stops the Conductor (audio continues); play LEDs mirror the decks, not the set.
