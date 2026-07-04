# Transitions are seconds-based drawn automation

Status: accepted (amended — see below)

A Mix's Transitions are stored as drawn automation lanes (piecewise-linear breakpoints) over per-channel mixer controls, with anchors and durations in **seconds** — not beats, and not recorded performance. Beat-snapping, beat guides, and tempo-matching are editing affordances layered on top; the model itself is time-based and works for un-gridded tracks, ambient blends, and cuts. Transitions are **pairwise**: at most two Tracks ever sound simultaneously, so playback needs exactly two deck instances alternating through the sequence.

## Considered options

- **Beats-based model** (every mainstream DJ tool) — rejected for the model, kept as affordance: beat anchoring excludes un-gridded tracks and non-rhythmic transitions, and manadj's Mixes are ideation sketches, not quantized productions.
- **Recorded automation** (perform the transition on two decks, capture control events) — deferred, not rejected: drawing is more editable and doesn't require performing well with keyboard+mouse. Recording becomes a future *capture method* that emits the same lane format.
- **Crossfader lane** — eliminated from the model: two independent channel-fader lanes are strictly more expressive; the crossfader remains a live Performance-view control only.
- **Pitch lanes** — no: tempo-matching is a per-Transition setting (with a gentle post-transition ramp back to native BPM), not a curve.

## Consequences

- Transition templates are duration-normalized (lanes on a 0→1 axis, stretched to each Transition's length).
- Deterministic playback evaluates lanes at mix-time *t* via the existing ramped channel setters (animation-frame rate — ample for drawn fades); sample-accurate `AudioParam` scheduling is only relevant to a future offline render.
- Every Transition is inherently a track-pair association ("A mixes into B at these points") — the planned transition-library/track-association features are an index over saved Transitions, requiring no model change.

## Amendment: the Transition is the first-class artifact

Prototyping inverted the original containment: the **Transition** (ordered Track pair + anchors + lanes + tempo-match) is the persisted, named artifact — a pair usually has one, occasionally several, with zero-ceremony editing (an auto-created "Transition 1", edits autosave). The **Mix** (an ordered sequence whose adjacencies reference saved Transitions) is deferred to a later feature composed from them. This surfaces the track-association goal in the core object instead of a future index. The editor is a third top-panel mode beside the library and Performance views, audio-isolated from the shared decks: entering it pauses other surfaces and offers to adopt their loaded tracks. Templates are deferred.

## Amendment 2: templates are beat-domain recipes

Transition templates (grill 2026-07-03) store beat-domain anchor rules — per-side (cue slot + beat delta), a length in beats (fixed or scalable), normalized lanes — and translate to seconds at apply time via the tempo-matched beatgrids. This refines the first Consequence above (templates are more than duration-normalized lanes) without touching the model: the produced Transition is ordinary seconds-based data; beat-based application is an editing affordance, exactly as this ADR classifies beat-snapping. Beat templates imply tempo-match at instantiation (beat equivalence across the pair is what makes mid-transition alignment hold). Design details: `.scratch/mix-editor/PRD.md` (Transition templates).

## Amendment 3: prototype graduated (2026-07-04)

The two-track editor prototype answered its questions (drawing feel, playback conviction — NOTES Verdict, archived at `.scratch/mix-editor/NOTES.md`) and is production code as of the 2026-07-04 consolidation merge. Rename map: `frontend/src/prototype/` → `frontend/src/editor/`; `MixEditorProto` → `TransitionEditor`; `MixProtoPlayer` → `MixPlayer`; `mixProtoModel` → `mixModel`; types `ProtoTransition` → `Transition` and `ProtoMix` → `EditorMix` (**not** `Mix` — the glossary reserves Mix for the future sequenced concept); CSS `mixproto-*` → `editor-*`; localStorage `PROTOTYPE-transition-editor-pairs`/`-last` → `manadj-transition-pairs`/`manadj-last-pair` (one-time migration on load); entry deep-link `?proto=mix` → `?view=transition` (legacy alias kept). Remaining prototype-era affordances kept deliberately: localStorage persistence (DB persistence is the named graduation slice that unblocks templates), the `?protoperf` frame-time readout (user-requested), and the in-memory transition index (rebuild-on-save is fine at library scale).
