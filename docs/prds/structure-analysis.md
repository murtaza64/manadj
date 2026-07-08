# PRD: Structure analysis (drops, buildups) and Energy estimation

Status: ready-for-agent
Blocked by: harness verdict gates all backend/frontend integration (human calls the promotion)

## Problem Statement

Every new Track's cue ladder (Cue-slot convention: 4 = drop, 3/2/1 walked back) is set by hand — scrub, listen, place, repeat, across a backlog of hundreds of Unprocessed tracks. Energy (1–5) is likewise hand-assigned, so Compatible and Follow mode are blind on unrated tracks. The audio already tells us where the drop is; nothing reads it.

## Solution

A new Analysis output: the Track's **Structure** — a partition into labeled **Sections** (intro, buildup, drop, breakdown, outro, other), boundaries snapped to the Beatgrid's downbeats — plus an **Energy estimate** (1–5) calibrated against hand-rated Tracks. Consumers use a two-rung read: curated value (Hot Cue slot 4 / curated Energy) if set, else the analysis opinion. Real cue slots are only ever written by an explicit **Ladder stamp** gesture. Detection candidates are developed and scored offline in the harness (ADR 0024 methodology) against a corpus built from the ~500 already-laddered tracks; integration is gated on a winning candidate.

## User Stories

1. I want new Tracks analyzed for Structure automatically in the background, so drop and buildup locations are known without me listening.
2. I want to stamp a Track's cue ladder from its Structure in one act, so slots 1–4 land on the buildup and drop without scrubbing.
3. I want a bulk Ladder stamp over selected/un-laddered Tracks, so the backlog gets ladders in one pass.
4. I want a Ladder stamp to fill empty slots only, so cues I placed deliberately are never overwritten.
5. I want stamped cues to be ordinary Hot Cues, so they Export to Engine DJ and sit on my controller pads like any cue.
6. I want detected Sections overlaid on waveforms, so I can see a track's shape at a glance while browsing or performing.
7. I want multi-drop Tracks to show all their drops, so I can pick the one I care about.
8. I want an Energy estimate on every analyzed Track, so Compatible and Follow mode work across the whole library, not just hand-rated Tracks.
9. I want estimated Energy visually distinct from curated Energy, so I never mistake an opinion for my verdict.
10. I want to set Energy or a cue by hand and have that win everywhere, so analysis never argues with my curation.
11. I want re-analysis (better model, tuned thresholds) to replace Structure and Energy estimates wholesale without touching any curated data, so improving detection is always safe.
12. I want Transition template application to fall back to Structure when ladder slots are unset, so templates anchor sensibly on un-laddered Tracks.
13. I want gridless Tracks to skip snapping and Ladder stamping gracefully, so analysis never manufactures nonsense cues.
14. As the developer tuning detection, I want candidates scored against my own slot-4 ground truth with a headline drop-hit-rate, so the shipped analyzer is chosen by measurement, not vibes.
15. As the developer, I want heavy model dependencies import-guarded, so the app never pays for the harness's experiments.

## Implementation Decisions

- **Section**: an Analysis-produced labeled span; vocabulary is a closed set — intro, buildup, drop, breakdown, outro, other. Buildup is relational: it ends where a drop begins (a buildup with no following drop is a detector error by definition). Detector-label mapping (e.g. Harmonix labels → this vocabulary) and all thresholds are tunable heuristics, not part of the definition.
- **Structure**: the Track's full partition into Sections. Boundaries snap to the Beatgrid's downbeat lattice at analysis time; gridless Tracks keep unsnapped boundaries. Stored per Track, replaced wholesale on re-analysis. Internal to manadj — never transferred by Sync (Waveform-data precedent).
- **Authority**: Structure is pure re-runnable analysis opinion — not hand-editable, no origin ladder, no divergence tracking. The correction surface is the cue ladder: consumers wanting "where is the drop" read Hot Cue slot 4 if set, else Structure (the two-rung read, stated once, lives with consumers).
- **Ladder stamp**: explicit gesture, single-track and bulk. Slot 4 = first drop's start; 3/2/1 walked back per the Cue-slot convention (8/8/16 bars), clamped to track start; fills empty slots only, skipping set ones. Stamped cues become ordinary Hot Cues with no memory of their origin. Analysis never writes cue slots itself; auto-stamp is rejected (a wrong auto-cue exported to Engine is accidental curation).
- **Energy estimate**: per-Track 1–5 analysis opinion, drop-centric (keyed on drop-Section intensity; whole-track features as fallback and for gridless Tracks), fit against the library's hand-rated Tracks. Never exported. Two-rung read: curated Energy else estimate; UI marks estimates.
- **Harness first (hard sequencing)**: everything is prototyped offline in the harness before any backend/frontend integration. Corpus from ~laddered tracks: slot 4 is headline truth (firmest convention rung), slots 1–3 secondary, provenance-filtered like gold/disputed tiering. Candidates: (1) DSP baseline — novelty + band-energy jumps over the existing waveform blob, snapped to the 8/16-bar lattice; (2) allin1 (All-In-One music structure analyzer) with label mapping and grid re-snap; (3) hybrid — allin1 activations as features into the lattice-snapped picker; (4) optionally the Zehren cue-point CNN. Winner ships as the production analyzer.
- **Headline metric**: drop hit rate — best drop boundary within ±1 bar of slot 4 (beats, not seconds). Secondary: multi-drop recall, boundary-count sanity, buildup-start distance to slot 1. Energy estimate scored by exact-match and off-by-one rate against curated ratings.
- **Integration phase (gated on harness verdict)**: production analyzer runs on the task system (waveform-task pattern: enqueue on Track creation + startup sweep); Structure and Energy estimate stored as analysis artifacts alongside the existing analysis tables; waveform overlay, Ladder stamp UI, estimate display, template-apply fallback upgrade.
- Prior art consulted: Mixed In Key (energy 1–10, cue suggestions), Rekordbox Phrase analysis (grid-locked phrases; term deliberately avoided), allin1/Harmonix Set, Yadati et al. ISMIR 2014 (EDM drop detection), Zehren et al. 2022 (DJ cue-point detection), librosa/MSAF novelty segmentation. Structural edge over all of them: snapping to manadj's own verified Beatgrids.

## Testing Decisions

- Detection quality is tested by the harness scoring itself (ADR 0024 pattern: corpus, tiering, headline metric, report) — no pytest assertions on model accuracy.
- Import hygiene: heavy deps (torch, allin1, demucs) importable only inside candidate methods, enforced by the existing import-hygiene/heavy-dep-guard test pattern.
- Integration phase, external behavior only: Ladder stamp (empty-slot skipping, walk-back arithmetic, clamping, gridless refusal), two-rung reads (slot-4-else-Structure, Energy-else-estimate), wholesale replacement on re-analysis leaving curated fields untouched. Prior art: existing analysis/task-system tests.

## Out of Scope

- Hand-editing Sections, origin ladders, or divergence machinery for Structure (the cue ladder absorbs correction).
- Auto-stamping cues on analysis; any analysis write to curated fields (cues, Energy).
- Syncing/exporting Structure or Energy estimates to external libraries.
- Slot 5–8 conventions and second-drop ladder placement.
- Set planning and phrase-aligned Transition suggestions consuming Structure (future consumers; the artifact is designed so they can).
- Importing Rekordbox Phrase data.
- Vocal/instrument detection, per-Section tempo, non-EDM structural grammars.

## Further Notes

Grilled 2026-07-06. Glossary entries (Section, Structure, Energy estimate, Ladder stamp) added to CONTEXT.md in the same session. Domain is currently dnb + 4/4 dance genres, nearly all Quantized tracks — the relational buildup→drop grammar assumes this; revisit vocabulary if the library's genre spread widens. Compute is a non-concern: analysis rides the task system; even minutes-per-track models clear the library in days of background churn.

## Comments

**2026-07-06**: Correction: the session ID in this file's creating commit (ses_0c9c87818ffeURyyt4e2di9oh5) is not a real session — the session-identity plugin was absent and the ID was erroneously fabricated by the agent. Treat attribution as 'unknown session, 2026-07-06 grilling session'.

**2026-07-06**: Retraction of the previous comment: ses_0c9c87818ffeURyyt4e2di9oh5 IS the real session ID — it is injected by the session-identity plugin into every bash execution; the agent misidentified it as fabricated. The creating commit's attribution stands. (The plugin injects the export inline rather than via env, which is what caused the confusion.)
