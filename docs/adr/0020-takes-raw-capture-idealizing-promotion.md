# Takes: raw performance capture with idealizing promotion

Status: accepted (grill 2026-07-05)

This is the "recorded automation" capture method ADR 0010 deferred. Live mixing on
the shared Decks+Mixer is captured **always-on** (no arming): the frontend keeps an
ephemeral rolling log of timestamped control and transport events, and a detector
extracts a **Take** whenever a **Handover** settles (glossary: audibility on the
Master bus passes finally from outgoing to incoming; cross-cuts fold in via a settle
horizon; teases where the outgoing survives are nothing). A Take stores its **raw
event slice** — not cooked lanes — in a backend `takes` table (opaque slice +
queryable pair/window/detector metadata), listed in the **Transition history**,
never in the Transition library.

Promotion — opening a Take in the Transition editor and saving — derives an
ordinary seconds-based Transition from the raw slice ("vectorization") and
**idealizes** on the way:

- **Continuous gestures are discarded**: Nudges and pitch riding collapse into the
  single static alignment (`bInSec`, chosen at the handover's commit point) and the
  static tempo-match. Consistent with the glossary: a Nudge "leaves nothing behind."
- **The crossfader is composed away**: effective per-deck gain (channel fader ×
  crossfader gain) is baked into the `faderA`/`faderB` lanes. The sketch records
  the resulting move, not the fingering; ADR 0010's no-crossfader-lane decision
  stands.
- **Discrete gestures are preserved** as **Jump events** — a new Transition-model
  extension: playback discontinuities of the incoming Track at a mix instant (beat
  jump / hot-cue press mid-mix, e.g. doubling a buildup). Incoming-Track-only for
  now, keeping the Sketch origin invariant (outgoing track time ≡ mix time);
  admitting outgoing-side jumps later would restate that invariant.

## Considered options

- **Cooked Takes** (render lanes at capture time) — rejected: freezes the
  detector's window choice and the vectorizer's output forever. Raw slices let
  detection and vectorization be re-run as heuristics improve — the Transition
  history is explicitly the tuning ground, false positives included.
- **Auto-saving captures as Transitions** — rejected: a practice session would
  spray near-duplicates per pair and corrupt the library's curated "what mixes
  well" signal. Promotion through the editor is the quality gate, reusing the
  existing lazy-persistence save path.
- **Time-varying alignment / pitch lanes** for full fidelity — rejected, as in
  ADR 0010: Transitions are editable sketches of the intended move, not
  recordings; the raw Take retains the truth if exact replay is ever wanted.
- **Armed recording** — rejected: the good take is the one you didn't arm for.

## Consequences

- Detection can only run in the frontend (audibility and control state exist only
  in the Web Audio graph); a tab crash mid-blend loses that Take. Accepted for v1.
- The pre-detection rolling log is ephemeral and never persisted; whole-session
  capture would be a separate future concept.
- Takes are immutable, survive promotion, and reference the Transition they
  produced — promoted-vs-ignored becomes labeled data for detector tuning.
- `arrangementAt`/playback and the editor must learn Jump events; templates do not
  (a recipe with jumps is out of scope until proven wanted).
