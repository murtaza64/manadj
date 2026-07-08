# PRD: Soulseek Supplier

Status: ready-for-agent

## Problem Statement

Some Source Items can't be downloaded from SoundCloud (Go+/DRM tracks fail permanently; some likes are removed upstream), and even downloadable ones are capped at lossy quality. There is currently exactly one way to obtain audio for a Source Item, and it is welded to the Source itself.

## Solution

Split demand from supply (CONTEXT.md: **Source** vs **Supplier**) and add Soulseek as a supply-only Supplier via a local `slskd` daemon. On any unfulfilled Source Item, the operator can search Soulseek with the Cleanup-derived query, review candidate files (format/bitrate/duration-delta/queue), pick one, and have the existing acquisition chain finish the job — Correspondence to the SoundCloud item, recorded `soulseek` provenance, cleaned tags embedded, Disk Import.

## User Stories

1. As a DJ, I want to fulfill a DRM'd SoundCloud like via Soulseek, so that Go+ tracks stop being dead ends.
2. As a DJ, I want to search Soulseek for any unfulfilled item (not just failed ones), so that I can choose a lossless rip over SoundCloud's lossy stream.
3. As a DJ, I want the search query prefilled from Cleanup output and editable, so that junk tokens don't poison peer search.
4. As a DJ, I want results showing filename, format, bitrate, size, duration (with delta vs the item's duration), and peer queue state, sorted exact-duration-lossless first, so that the right file is the obvious pick.
5. As a DJ, I want duration mismatches beyond a few seconds rendered loudly, so that wrong recordings don't sneak in.
6. As a DJ, I want my pick to queue a download task and show "downloading via Soulseek" on the item, so that slow peers don't block anything else.
7. As a DJ, I want the downloaded file renamed to the Cleanup basename, tagged with cleaned title/artist, imported, and the item fulfilled — identical to a SoundCloud download from the outside.
8. As a DJ, I want Audio Provenance to record `soulseek` while the Correspondence still points at the SoundCloud item, so that "what is this track" and "where did the bytes come from" stay separate truths.
9. As a DJ, I want downloads that sit queued behind a peer for more than ~24h to fail with a clear message, so that stuck transfers surface instead of hanging forever.
10. As an operator, I want the Soulseek Supplier to vanish cleanly (no UI affordance) when slskd isn't configured, so that the feature is opt-in.
11. As a developer, I want Suppliers behind one protocol with the SoundCloud adapter wrapping today's download and the Soulseek adapter wrapping slskd's REST API, so that the third Supplier is an adapter, not a rewrite.

## Implementation Decisions

- **Domain split** (already in CONTEXT.md): Source = demand (Source Items, Refresh, Correspondence); **Supplier** = supply. SoundCloud is both; Soulseek is Supplier-only. Native Source no longer implies downloadability.
- **Client:** `slskd` daemon (Docker/binary), REST API on localhost. manadj is a thin HTTP client. Rejected: embedded Python Soulseek libraries (P2P lifecycle inside the app process); Nicotine+ (GUI, not automatable). slskd also survives manadj restarts without losing peer-queue positions.
- **Trigger: operator-only for v1.** No automatic SoundCloud→Soulseek fallback; auto-pick (with thresholds like exact duration + lossless + free slot) is an explicit follow-up once the picker has earned trust.
- **Task shape:** picking a result creates a `soulseek-download` task; the worker polls slskd transfer state per tick; TTL ~24h then fail. No blocking waits.
- **Post-download chain reuses the existing one exactly:** move file from slskd staging to the tracks directory under the Cleanup basename (extension from the picked file), embed cleaned title/artist, Disk Import with `derive_provenance=False`, `upsert_confirmed_correspondence`, item fulfilled. Crashed-attempt file adoption applies as-is.
- **Provenance:** recorded (manadj witnessed), label `soulseek`, no URL, no external ID (label-only recorded row — glossary-sanctioned).
- **Config:** `[soulseek]` in `config.toml` (`slskd_url`); `SLSKD_API_KEY` in gitignored `.env`. Unset ⇒ Supplier absent.
- **Supplier protocol:** search + download + transfer-state surface as needed by the picker and task; SoundCloud adapter wraps the current `DownloadableSource` behavior.

## Testing Decisions

- Module-interface tests per ADR-0002: fake at the **Supplier seam** (extend the FakeSource pattern: canned search results, canned transfer-state sequences incl. queued→complete and queued→TTL-expiry), real in-memory DB, real temp files.
- The download-chain tests in tests/test_acquisition_download.py are the prior art; the Soulseek chain gets the same coverage (fulfillment, correspondence repointing, provenance row, adoption on retry).
- The slskd REST adapter itself stays thin and untested for now (ADR-0004 deferral rationale: external system, no fixtures worth committing).
- Endpoint smoke tests (status + shape) for the search/pick routes.

## Out of Scope

- Automatic fallback / auto-pick (follow-up once picker trust is established).
- Wrong-pick recovery: today's answer is delete-and-retry; the real answer is Replace Audio (.scratch/track-identity/issues/02), which this feature raises the value of but does not require.
- Persisting peer username / remote filename (see Caveats).
- Sharing manadj's library back to the Soulseek network; slskd configuration management beyond pointing at it.
- Rate limiting/backoff for SoundCloud (existing issue 08, unrelated).

## Caveats (recorded per grill 2026-07-02)

1. **Peer/remote-filename metadata is deliberately dropped** — logged in the task log only. If bad-pick debugging becomes routine, a provenance detail field is the revisit point.
2. **Label-only provenance is weaker than SoundCloud's** (no URL to click, no external ID to re-derive). Accepted: Soulseek has no stable addresses.
3. **Recovery from a wrong pick is manual** until Replace Audio exists; the picker's duration-delta emphasis is the main guard.

## Further Notes

- The Supplier seam is the acquisition-side sibling of the sync side's SurfaceReader/ExternalLibrary seam — same fakes-at-the-seam testing posture.
- Cleanup query quality directly drives Soulseek search quality; if results are poor, improving Cleanup benefits both Suppliers.
