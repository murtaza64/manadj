# PRD: SoundCloud Acquisition

Status: ready-for-agent

## Problem Statement

I like tracks on SoundCloud as I discover music, then later download them by hand with yt-dlp (pasting URLs one at a time with an OAuth token) and import them into manadj. There is no view of which liked tracks I already have, no way to bulk-download the missing ones, no record of which local Track came from which SoundCloud track, and the raw SoundCloud titles/uploaders need manual cleanup. Mixes and clips clutter the likes and shouldn't be downloaded at all.

## Solution

manadj gains an Acquisition pipeline for SoundCloud as its first Source. A Refresh pulls my likes into persisted Source Items. Heuristics attach a Classification (track/mix/clip/other) so mixes and clips are hidden by default. Fuzzy matching against my existing library proposes Source Correspondences so already-downloaded likes show as fulfilled. The rest can be queued — individually or "all visible" — onto a new generic background task system that downloads via yt-dlp, runs Cleanup on title/artist, lands files in the tracks directory through the normal Disk Import path, records the Source Correspondence and Audio Provenance, and leaves the new Track as an Unprocessed track for normal curation. The UI lives as an Acquisition section inside the existing Sync view.

## User Stories

1. As a DJ, I want to trigger a Refresh of my SoundCloud likes, so that manadj knows about every track I've liked.
2. As a DJ, I want each like persisted as a Source Item with title, uploader, duration, stable SoundCloud ID, and permalink, so that decisions about it survive restarts and re-Refreshes.
3. As a DJ, I want Refresh to only ever add Source Items, so that unliking a track upstream never destroys local state or history.
4. As a DJ, I want each Source Item to carry a heuristic Classification (track, mix, clip, other), so that non-tracks are filtered out of my way.
5. As a DJ, I want suspected mixes and clips hidden by default but visible via a filter toggle, so that false positives are recoverable and nothing is silently discarded.
6. As a DJ, I want to override a Source Item's Classification, so that a 20-minute prog track misclassified as a mix can still be acquired.
7. As a DJ, I want the classification heuristics (duration bounds, title keywords) configurable in config.toml, so that I can tune them to my library.
8. As a DJ, I want manadj to propose Source Correspondences between my likes and Tracks already in my library using cleaned title/artist and duration, so that previously-downloaded likes don't show as needing download.
9. As a DJ, I want exact matches (normalized title/artist plus agreeing duration) auto-accepted, so that I don't hand-confirm hundreds of obvious pairs on first Refresh.
10. As a DJ, I want fuzzy (non-exact, above-threshold) matches presented side-by-side for accept/reject, so that I control ambiguous associations.
11. As a DJ, I want to manually link a Source Item to a Track (and a Track to a SoundCloud URL), so that below-threshold or missed matches have an escape hatch.
12. As a DJ, I want a Source Item whose Correspondence exists to show as fulfilled, so that the "needs download" view is a true set difference.
13. As a DJ, I want a like fulfilled by audio bought elsewhere (e.g. Bandcamp WAV) to count as fulfilled via its Correspondence, so that provenance and correspondence stay distinct.
14. As a DJ, I want to mark Source Items ignored, so that tracks I'll never want stop appearing.
15. As a DJ, I want to queue a single Source Item for download, so that I can acquire one track on demand.
16. As a DJ, I want to queue all visible (filtered) Source Items at once, so that catching up after a listening binge is one action.
17. As a DJ, I want queued downloads executed by a background task system with observable state (pending/running/done/failed), so that the app stays responsive and I can see what's happening.
18. As a DJ, I want download tasks to survive an app restart, so that a long queue doesn't evaporate.
19. As a DJ, I want failed downloads (dead links, geo-blocks) to show their error and offer retry, so that transient failures aren't dead ends.
20. As a DJ, I want download concurrency limited (1–2), so that SoundCloud rate limiting doesn't break the pipeline.
21. As a DJ, I want downloads authenticated with my OAuth token from config.toml, so that I get the best available quality and access to my account's content.
22. As a DJ, I want downloaded files named by Cleanup output as `Artist - Title.ext` in the tracks directory, so that files follow the library's existing convention.
23. As a DJ, I want a filename collision to fail the task for manual resolution, so that a probable missed correspondence is surfaced instead of papered over with a suffix.
24. As a DJ, I want completed downloads to flow through the normal Disk Import path, so that acquisition doesn't grow a parallel track-creation code path.
25. As a DJ, I want the resulting Track to record its Source Correspondence and Audio Provenance (source, SoundCloud ID, download date), so that I always know where a Track came from.
26. As a DJ, I want rule-based Cleanup (junk-token stripping, `Artist - Title` splitting, uploader-as-artist fallback) applied at Track creation, so that titles and artists start sane.
27. As a DJ, I want Cleanup's junk-pattern list configurable in config.toml, so that new junk conventions are a config edit, not a code change.
28. As a DJ, I want newly acquired Tracks to be Unprocessed tracks, so that they enter my normal curation workflow rather than being trusted blindly.
29. As a DJ, I want the Acquisition UI inside the existing Sync view as a clearly-labeled section, so that all library-manipulation flows live where I expect them.
30. As a DJ, I want per-item download status and a failed-task strip in the Acquisition section, so that in-progress and failed work is visible without a separate task manager.
31. As a DJ, I want Track duration stored (read from the audio file), so that matching and clip detection have a reliable signal.

## Implementation Decisions

- **Domain vocabulary** (all in CONTEXT.md — use it): Source, Source Item (lifecycle: new → queued → fulfilled/ignored), Classification, Refresh, Source Correspondence, Audio Provenance, Cleanup, Acquisition. Avoid generic "sync" in module/endpoint names (see `.scratch/code-naming/issues/01`); the UI tab keeps its broad "Sync" label.
- **Source boundary**: a SoundCloud source interface with exactly two operations — list Source Items (metadata only) and download a Source Item to a target path. Real implementation wraps yt-dlp as a Python library with the OAuth token from config.toml. This is the feature's single new seam.
- **Likes enumeration**: mechanism pending research issue 01 (yt-dlp user-likes extractor vs SoundCloud API v2 favorites). Resolve before or during implementation; the interface above insulates the rest of the feature from the answer.
- **Source Items** persisted in the app DB with SoundCloud's stable ID as the natural key; Refresh upserts new items and never deletes. Manual Refresh trigger only.
- **Classification** stored on the Source Item, heuristic-assigned (duration bounds, title keyword patterns from config.toml), user-overridable; it filters views but never auto-ignores.
- **Correspondence engine**: three tiers — exact normalized title/artist + duration agreement auto-accepts; above-threshold fuzzy similarity creates a proposal requiring confirmation; below threshold stays unmatched. Manual linking from either end. Normalization shared with Cleanup.
- **Audio Provenance** recorded when manadj performs the download (source, external ID, timestamp); a Correspondence can exist without Provenance.
- **Task system** (ADR-0003): generic task rows in the app's SQLite DB (type, payload, state pending/running/done/failed, error, timestamps), in-process worker inside the FastAPI app, per-type concurrency limits, retry action, startup recovery of interrupted `running` tasks. Built generic; only the download task type ships in this PRD (migration of existing workers is `.scratch/task-system/issues/01`).
- **Download task chain**: yt-dlp download to tracks directory (Cleanup-derived filename; collision → task fails) → Disk Import → Correspondence + Provenance → Source Item fulfilled → Track is an Unprocessed track.
- **Track duration**: new Track attribute, read from the audio file; backfill for existing Tracks needed for matching.
- **API**: new endpoints for Refresh, Source Item listing/filtering, Classification override, ignore, queue (single + bulk-visible), proposal accept/reject, manual link, task listing/retry. Specific-term naming, not "sync".
- **UI**: an Acquisition section within the existing Sync view, using the **review-split layout** chosen via UI prototype (2026-07-02, variant C of three): a left sidebar with Refresh button, per-state counts acting as filters, and Classification checkbox filters (mixes/clips unchecked by default); a main Source Item list (title, uploader, duration, Classification chip — clickable to override — state badge, match score when a proposal exists); a detail panel for the selected item showing error detail for failures, the side-by-side SoundCloud-vs-library-Track comparison with similarity score for proposals (accept/reject), and manual-link affordances; a sticky bottom action bar with visible-count and queue-all-visible. Failed items highlighted in the list. Bright, fully saturated colors per project convention. The prototype code was throwaway — reimplement properly.
- **Config**: OAuth token, classification thresholds/keywords, junk-pattern list, fuzzy-match threshold, download concurrency — all in config.toml.

## Testing Decisions

Follow ADR-0002 (tests exercise module interfaces, not mocks) — note it currently lives in the track-metadata jj workspace and lands with that change.

- Good tests assert external behavior at a module's public interface with real internals; no mocking library. Substitute only at the one true seam: a fake SoundCloud source returning canned Source Item metadata and "downloading" by copying committed tiny audio fixtures (`tests/fixtures/`, m4a/mp3/flac/wav) into the target path.
- Primary coverage at the acquisition module's interface: Refresh persistence and idempotency, classification, three-tier correspondence (auto-accept / proposal / unmatched), queue → task → file → Track chain including collision failure, ignore/override flows, provenance recording.
- Task system tested through its own module interface with a synchronous "run pending tasks" entry point — no live-thread races in tests; restart-recovery covered by re-instantiating the worker over the same DB.
- Pure logic unit-tested directly: Cleanup rules, matcher scoring/normalization, classification heuristics.
- Thin FastAPI TestClient smoke tests (status + shape only) for the new routers.
- DB fixture per the settled harness: in-memory SQLite (`StaticPool`), `Base.metadata.create_all`, small factory helpers. Keep the analysis stack (essentia/tensorflow/madmom/librosa) out of the import chain; the heavy-dep guard test must stay green.
- Prior art: the pytest harness being established in the track-metadata workspace (phase 0 of that plan). If it hasn't landed when this is picked up, establish the harness per the handoff decisions rather than inventing a new one.

## Out of Scope

- LLM-assisted Cleanup (`.scratch/metadata-cleanup/issues/02`)
- Re-running Cleanup on existing Tracks (`.scratch/metadata-cleanup/issues/01`)
- Migrating waveform/Analysis work onto the task system (`.scratch/task-system/issues/01`)
- Other Sources (Bandcamp, YouTube) — the Source vocabulary generalizes, but only SoundCloud ships
- Scheduled/background Refresh polling; SoundCloud playlists, reposts, or anything beyond likes
- Download progress granularity beyond task state (revisit per yt-dlp library hooks)
- A global task-manager UI panel
- Writing anything back to SoundCloud

## Further Notes

- Research issue: `.scratch/soundcloud-acquisition/issues/01-investigate-likes-scanning.md` (likes enumeration mechanism).
- ADRs: 0001 (manadj is the source of truth), 0003 (in-process task system), 0002 (testing posture, in track-metadata workspace).
- Coordinate with the track-metadata workspace: it establishes pytest and may land a `track_metadata` module owning title/artist/key/BPM writes; Cleanup output should feed whatever that module exposes rather than duplicating write logic.
- First Refresh against the real account is the acceptance test that matters: most likes should end fulfilled via auto-accepted correspondences, the rest queueable in one action.
