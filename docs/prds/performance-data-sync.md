# PRD: Performance data import from Engine DJ

Status: ready-for-agent

## Problem Statement

As a DJ, my Hot Cues, Beatgrids, and Main cues get set where the DJing happens — often in Engine DJ at a gig — but manadj is the Library's source of truth and has no way to bring that work home. A standalone script backfilled hot cues and beatgrids once, but it lives outside the app: no visibility into what differs, no way to review a conflict, main cues were never imported at all, and Engine's key analysis (better than manadj's) can only be pulled field-by-field in a separate flow. When both sides have data, I have no way to *see* which grid or cue set is right before choosing.

## Solution

Performance data becomes part of the unified sync view. Hot Cues, Beatgrid, and Main cue join title/artist/key/bpm/energy/tags as Diverged-comparable fields per Surface, with per-cell External Import. A bulk "import performance data from Engine" action (per track or per group) pulls Hot Cues, Beatgrid, Main cue, and key together: anything filling a blank applies automatically; anything overwriting saved info is listed and individually confirmable — never silent. Confirmation is informed by an overlay diff viewer: the track's waveform with both sides' grids and cue markers drawn color-coded on the same timeline, zoomable to beat level, so "which one is right" is a visual judgment, not a leap of faith.

## User Stories

1. As a DJ, I want Hot Cues, Beatgrid, and Main cue compared between the Library and the Engine Surface in the sync view, so that work done at a gig is visible the same way diverged titles and BPMs are.
2. As a DJ, I want a track whose Engine hot cues differ from manadj's to show as Diverged with a per-cell import, so that pulling gig cues is the same gesture as pulling a corrected title.
3. As a DJ, I want hot cue sets compared as whole sets — slot occupancy, position (within tolerance), label, and color — so that a renamed or recolored cue counts as a real difference.
4. As a DJ, I want a bulk "import performance data from Engine" action on a single track, so that one gesture pulls cues, grid, main cue, and key together.
5. As a DJ, I want the same bulk action at group scope in the sync view, so that a whole gig's worth of tracks imports in one pass.
6. As a DJ, I want the bulk action to fill blanks automatically — hot cues where manadj has none, a grid where manadj has only a placeholder, a main cue where none is saved, a key where manadj's is empty — so that the common backfill case needs no clicking.
7. As a DJ, I want anything that would overwrite saved info listed per track and field for explicit confirmation, so that nothing I curated is ever silently replaced.
8. As a DJ, I want to choose between "fill empty slots" and "replace all" when both sides have hot cues, so that I can merge a gig's new cues into my practice cues or take Engine's set wholesale.
9. As a DJ, I want an overlay diff viewer — one waveform, both beatgrids and both cue sets drawn color-coded — so that I can visually judge which side is right before confirming.
10. As a DJ, I want to zoom the diff viewer to beat level, so that I can see which grid actually sits on the transients.
11. As a DJ, I want hot cue markers in the viewer to show slot number, color, and label for both sides, so that I can tell my practice cues from the gig's cues at a glance.
12. As a DJ, I want the viewer to be read-only comparison plus pick-a-side, so that grid editing stays on the Deck panels where it belongs.
13. As a DJ, I want only Engine main cues the DJ actually moved (Engine's overridden flag) treated as importable, so that Engine's auto-placed defaults don't masquerade as saved work.
14. As a DJ, I want an imported main cue to behave exactly like one I set on a Deck, so that CDJ cue behavior is identical regardless of where the cue was born.
15. As a DJ, I want variable-tempo beatgrids imported rather than skipped, so that live recordings and old vinyl rips get their correct grids.
16. As a DJ, I want a clear "variable grid — N tempo changes" flag on such tracks at import time, so that I know manadj's rendering only honors the first tempo change for now.
17. As a DJ, I want manadj's auto-generated placeholder grids treated as absent — imported over without confirmation — so that I'm not nagged to "confirm overwriting" a grid nobody made.
18. As a DJ, I want grids I've edited (set downbeat, nudge, BPM correction) always confirmation-gated, so that curation survives any import pass.
19. As a DJ, I want Engine's key included in the performance-data bundle, so that trustworthy key analysis arrives in the same gesture as cues and grids — while key stays an ordinary Track attribute everywhere else.
20. As a DJ, I want a diverged key overwrite to sit in the same confirm list as everything else, so that the no-silent-overwrite rule has no exceptions.
21. As a DJ, I want re-running an import after nothing changed to report everything in sync and do nothing, so that import is a safe, repeatable habit rather than a one-shot migration.
22. As a DJ, I want imported hot cues to land at Engine's exact positions, not snapped to manadj's beatgrid, so that cues set by ear at a gig are preserved sample-faithfully.
23. As the developer, I want the Engine blob decoders moved out of the standalone script into the enginedj package with tests, so that the format knowledge lives in the adapter layer, regression-guarded.
24. As the developer, I want beatgrid origin recorded (generated / edited / imported), so that "is this saved info?" is a stored fact, not a lossy structural heuristic.
25. As the developer, I want the divergence comparison for the new fields to live behind the existing sync-status seam, so that it's tested with fake surface readers like every other field.

## Implementation Decisions

- **Scope**: Engine DJ → manadj, import direction only. Hot Cues, Beatgrid, Main cue as new Diverged fields; key rides the bulk bundle but remains a Curation-domain Track attribute with its existing scalar divergence — it is not reclassified as performance data.
- **Divergence model**: the three new fields join the sync-status field vocabulary; the Engine surface reader decodes performance-data blobs to supply them. Hot Cues compare as a whole set (occupancy, time within a tolerance of ~1 ms — a tunable constant — plus label and color). Main cue compares by time within the same tolerance; only an Engine main cue with the overridden flag set participates (Engine auto-defaults are ignored — manadj computes its own defaults live and never persists them). Beatgrids compare by tempo-change structure with a small BPM/offset epsilon.
- **Beatgrid origin**: new column on the Beatgrid model — `generated` (lazily auto-created from track BPM), `edited` (any set-downbeat/nudge/BPM edit flips it), `imported`. A `generated` grid is a *placeholder*: treated as absent by divergence and overwritten without confirmation. `edited` and `imported` grids are saved info. This replaces the script's structural "looks auto-generated" heuristic. Alembic migration; existing rows backfilled by the old heuristic once, at migration time.
- **No silent overwrites — unconditional**: import operations run two tiers. Automatic tier fills blanks only (no hot cues → import set; placeholder/absent grid → import grid; unset main cue → import overridden cue; empty key → import key). Confirm tier covers every overwrite of saved info, listed per track × field, individually applicable — including diverged keys, with no per-field exceptions.
- **Hot cue import verbs**: when both sides have cues, the confirm step offers *fill empty slots* (merge) or *replace all*. Imported cues bypass manadj's set-cue beat-quantization — Engine positions are ground truth.
- **Main cue import**: writes through the normal main-cue persistence path, so an imported cue is subsequently indistinguishable from one set on a Deck; the whole-field equality check makes re-imports no-ops.
- **Variable-tempo grids**: imported in full (storage already holds a tempo-change list). The sync row and confirm step display a "variable grid — N tempo changes" flag. manadj's renderers and beat math honoring only the first tempo change is a known, pre-existing limitation and stays a follow-up — except the diff viewer's own overlay math, which must compute beat positions from the full tempo-change list from day one (false misalignment in the viewer would poison exactly the decisions it exists to inform).
- **Bulk action**: "Import performance data from Engine" at track scope and at group scope in the sync view, reusing the existing scope-confirm pending-action pattern. Library-wide = group action on an unfiltered view; no separate button.
- **Overlay diff viewer**: opens from a diverged performance-data row in the sync flow. One waveform (the sides describe the same audio) with two color-coded overlay layers: both grids as tick/line overlays, both cue sets as markers (slot, color, label), both main cues. Zoomable to beat level. Read-only comparison plus pick-a-side actions — not a grid editor; set-downbeat/nudge stay on Deck panels. Uses the track's existing 3-band waveform data. Ships as its own slice after the fields/bulk land (they work with textual diffs in the interim).
- **Decoder relocation**: the qCompress/beat-data/quick-cues parsers move from the standalone script into the enginedj package as its performance-data decoding surface. The standalone backfill script retires once the in-app path lands.
- **Glossary/ADR**: Beatgrid entry sharpened (placeholder vs saved), Diverged entry widened (new fields; set-valued comparison; placeholder-as-absent). No new ADR — the decisions are cheap to reverse and follow the existing sync model.

## Testing Decisions

- Good tests assert observable comparison and import outcomes — divergence statuses out of the aggregator, database state after an import request — never decoder internals or UI wiring.
- **Existing seam — sync status aggregator** (fake surface readers, extending the current sync-status tests): whole-set hot cue comparison incl. tolerance boundaries, label/color divergence, placeholder-grid-as-absent, edited/imported grids diverging, main-cue overridden-only rule, variable-grid flag, in-sync no-op cases.
- **Existing seam — API routers** (TestClient + in-memory DB, prior art in the acquisition router tests): automatic vs confirm tiers, fill-slots vs replace-all, origin transitions (generated → imported; edits flip to edited), quantization bypass, key bundling, idempotent re-import.
- **New seam — blob decode in the enginedj package**: bytes in, decoded structures out. Per ADR 0004, no real Engine blobs are committed: tests decode blobs *synthesized* by a test-local builder implementing the documented format (qCompress framing, grid marker layout, cue slot layout, overridden flag). Correctness against real Engine bytes was established empirically (992 tracks, 0 parse errors) and remains a manual dry-run practice.
- **Frontend**: the viewer's pure overlay math (beat positions from a full tempo-change list, marker layout) on the existing vitest pure-module seam; the viewer's rendering stays eye-verified, per house style.

## Out of Scope

- Export direction — manadj → Engine performance data (no blob encoder exists anywhere yet)
- Rekordbox performance data, either direction
- Loops (no manadj model or glossary term — its own feature)
- Waveform transfer (glossary: Waveforms are internal to manadj, never transferred by Sync)
- Full multi-tempo support in deck/waveform renderers and beat math (beatjump, quantization) — known pre-existing limitation, flagged at import time, fixed in a later pass
- Grid or cue *editing* in the diff viewer
- Reclassifying key as performance data — it keeps its Curation-domain definition and existing scalar sync behavior

## Further Notes

- Subsumes the import half of `issues/01-sync-hotcues-beatgrids.md` (the script backfill is done; this PRD reifies it into the app and resolves the main-cue precedence question that issue deferred). The export half of that issue remains future work.
- Design session recorded in glossary edits on jj change `performance-data-sync: grill (docs)`: Beatgrid placeholder distinction, Diverged widening.
- Deferred items carried from the script era: the 2 constant grids with >0.05 BPM drift vs Engine's analyzed BPM (investigate individually); renderer multi-tempo support (32 known variable-grid tracks).
- The Engine surface reader will decode performance blobs during sync-status computation (~1k tracks, zlib + light parsing); if status latency suffers, decode lazily or cache by track — implementation detail, not a contract change.

## Comments

**2026-07-04 — Implemented** (workspace perfdata, jj changes `svxqoxor`→`qszpkwpq`, issues 02–07 all done — see each issue's Done comment). Two-axis code review run post-implementation: no hard standards violations; spec gaps fixed on `qszpkwpq` (viewer cue labels, shared frontend value types, single frontend tolerance constant mirroring `CUE_TIME_TOLERANCE`, bulk reports `maincue_no_waveform` instead of silently dropping, exact-boundary tolerance tests; `HOTCUE_TIME_TOLERANCE` renamed `CUE_TIME_TOLERANCE`). One spec-review finding rejected: per-cell fill-empty applies without confirmation — the PRD's automatic tier explicitly makes fill-empty unconfirmed; issue 04's wording was over-strict.

Review follow-ups deferred (judgement calls, not blockers):
- Viewer opening directly from bulk-confirm-list entries (today: open the row's Visual diff)
- Consolidate duplicated test fixtures (`make_client`, fakes, helpers) into conftest
- Collapse `bulk.py`'s four per-field fill/compare/pend blocks into a per-field strategy
- Type beatgrid `origin` as a `Literal` instead of bare `str`

**2026-07-04 — Post-merge fixes** (jj change `nqzsvywt`, rebased onto the main line — it is now the tip above `zuopmqvq`; base future work on it). User-reported issues fixed:
1. Diff viewer rendering: 3-band coloring matching the deck renderer (low maroon / mid green / high sky), per-pixel-column peak aggregation (was one rect per peak — jank at full zoom), zoom/pan now ref-based + rAF-throttled with no React re-renders, and wheel zoom uses a native non-passive listener + `overscroll-behavior` so the page no longer scrolls under the viewer.
2. Textual divergence resolution: grid summaries show BPM at stored resolution (4 decimals, trimmed) and start times at milliseconds (`fmtBpm`/`fmtCueTimeMs`); maincue cells at milliseconds; cue chips get ms tooltips. Previously "175.00 BPM from 0:00.3" could render identically on both sides of a real divergence (display rounding was 10× coarser than the comparison tolerances).
3. Tiering: maincue-only rows demoted to a new lowest-priority collapsed "Main cue diverged" group; "Beatgrid / hot cues diverged" keeps the high slot; BPM/key ranks above maincue-only. Bulk-import group action available on both perf groups.

Still open for eye-verification by the user: viewer smoothness/colors at deep zoom against a variable-grid track.
