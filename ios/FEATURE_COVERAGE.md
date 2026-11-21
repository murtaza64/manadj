# Android → iOS feature coverage

Baseline: personal `murtaza64/manadj` main at `d137e2d7` (piracy-removal merge). This map uses current source modules, not only the older Android README's pending labels. It is not approval to remove or defer Android features permanently.

## Apple runtime checkpoint

At `e11a802f`, unsigned simulator and arm64 device-SDK builds passed. Core package 23, audio bridge 4, native simulator 7 and UI 3 tests passed with zero failures on regular iPhone16 / iOS18.5. [Run](https://github.com/murtaza64/manadj/actions/runs/44586424500), [evidence](https://github.com/murtaza64/manadj/actions/runs/44586424500/artifacts/14563685819). Actual portrait, library, pitch and keyboard-search pixels were inspected. The real desktop loopback pair/sync/download/offline test, common generated codecs and long-stream seek/EOF checks passed. A test-fixture teardown hang was diagnosed from xctest samples and fixed with bounded termination observation; no test assertions were removed. A live waveform accessibility getter and ready-transport waits retain playing/paused checks.

These are generated-fixture simulator checks, not physical-device, local-Wi-Fi, audio-quality or complete Android-parity acceptance. Both PR merges remain held. Recording controls remain centered between faders; cue pins, bottom pitch clearance and library accepted/refused load paths pass the unchanged guards. The actual UI-runner recording includes test relaunches and first-use keyboard UI; it is not a polished demo or a frame-smoothness guarantee.

## Status key

- **Host-tested**: relevant Swift/C bridge behavior ran on Linux. Not iOS runtime proof.
- **Source only**: implementation exists, but Apple build/runtime validation is missing.
- **Core only**: model/engine behavior is available, but the iOS application does not expose the complete feature.
- **Missing**: not implemented in this slice. It remains an Android-parity gap.

| Area | Android source basis | iOS state and remaining work |
|---|---|---|
| Native interface | `app/Layouts.kt`, `Theme.kt`, `Controls.kt` | **Partly simulator-checked.** SwiftUI launches. Historical C/D selection passed before the A/B rewrite, not in the current UI. Current portrait, pitch, library and keyboard pixels are inspected. Standard A/B mixer gestures, pitch/bottom clearance, accepted/refused loads and keyboard-search preservation pass the latest UI suite. Native Files/share sheets and full touch-cancel paths remain unverified. |
| Four decks | `PlayerModel.kt`, `Deck.kt` | **Source only.** Four engine decks. Current Android-structure rewrite exposes A/B only. C/D selection regressed from the first prototype and remains a tracked gap. Not a port of Android's complete L1/L3 layouts. |
| One-handed layouts | `onehand/*` | **Missing.** Focus/chords/rings variants are not recreated. Requires interaction design and device checks, not a web-view substitute. |
| Playback/DSP engine | `audio-engine/src/main/cpp/Engine.*` | **Host-tested seam.** Compiles the existing engine unchanged. C bridge tests render synthetic audio and check position/seek. Apple callback and basic transport pass the native simulator test; device latency and sound quality remain unverified. |
| Native decoding and load ownership | `audio/AudioEngine.kt`, decoder classes | **Source only + host-tested C protocols.** AVAudioFile mono/stereo 8–192 kHz; one serial worker/deck; superseded loads cannot write a new load. No Ogg/codec parity claim. Generated WAV decoding passes the native simulator test. Synthetic MP3/M4A/FLAC/AIFF decode and transport pass on the simulator; real-collection codec accuracy remains unverified. |
| Memory and long files | Android full/range decode and ring APIs | **Source only.** Up to 64 MiB decoded PCM/deck uses the shared full-track buffer; larger files stream through the bounded ring. No duration rejection/truncation. Ring backpressure, sample-rate conversion, seek refill and EOF pass host tests. A synthetic 360-second CAF also passes native simulator streaming, late seek, EOF and backward-resume checks. Android's priority/range-fill optimization is not ported. |
| Play, pause, cue and hot cues | `Deck.kt`, shared `Op` handlers | **Source only + host-tested engine.** Cue/gated hot cues, set/clear and saved snapshot marks load into the engine. iOS touch cancellation and interruption timing need device tests. No cue write-back/persistence. |
| Seek, pitch and bend | `Scrubber.kt`, `PitchPanel.kt` | **Source only.** Native seek, ±8% pitch/reset and Android-style bend rail, touch starts ±2%, drag adds up to ±8%, release/cancel resets. The revised rail remains pending Apple runtime and physical-device review. No platter scratch parity. |
| Jump, loop and quantize | `JumpLoopRow.kt`, `Keys.kt`, shared engine | **Source only.** Beat jumps, half/double loops, loop toggle and Grid quantize. Heard quantize/calibration UI is missing. Current app uses first saved tempo segment, like the basic Android load path; no full grid editor. |
| Key lock | shared Signalsmith engine path | **Source only.** Toggle reaches unchanged engine. Fully decoded tracks can use key lock; streamed tracks explicitly fall back to varispeed. No iOS runtime/audio parity claim. |
| Channel mixer | `Mixer.kt`, `FilterSettingsPanel.kt` | **Source only.** Three-band EQ, filter position, channel fader, PFL, global cue blend and crossfader. Trim is now exposed. Advanced/custom filter-settings application is missing. |
| Beat FX | shared `BeatFx.h`, app controls | **Source only.** Echo, low-cut echo, reverb, flanger, trans and roll, target/depth/beats/on. Full settings/hold semantics and automation are not ported. |
| Output and interruptions | `OutputPanel.kt`, `PlaybackService.kt` | **Source only.** Fixed 48 kHz source with AVAudioEngine output conversion, playback category, background audio declaration, stereo and split mono. Route changes stop output; interrupted recordings remain partial. Quad USB output, remote controls, automatic media-services rebuild and real route tests are missing. |
| Master recording | `MasterRecordingBar.kt`, `MasterRecordings.kt`, `MasterRecorder.h` | **Host-tested engine + source-only app.** Finalized stereo PCM16 WAV, no microphone access, completed-file sharing. Host test checks RIFF and byte length. Native interruption/overflow/storage/end-to-end sharing must still be exercised. No session event recording. |
| Pairing | `library/Pairing.kt`, `DesktopDiscovery.kt` | **Host-tested HTTP client + source-only UI/Keychain.** Request/match-code/approval token; token header takes priority, redirects rejected. Device-only Keychain storage. Composed desktop listener pairing/snapshot/audio/offline reopen passes a native loopback test. This is not physical Wi-Fi transfer. Desktop address entry only; LAN discovery/mDNS and older pairing-code UI are missing. |
| Snapshot and offline cache | `SnapshotJson.kt`, `Store.kt`, `LibraryRepository.kt` | **Host-tested.** Versioned models, tags/categories/playlists/grids/cues/evidence/settings, atomic last-good snapshot and revision-keyed cache. Duplicate/malformed identities rejected before acceptance. Concurrent syncs are rejected; cache audio must be a nonempty regular file matching its expected length. Unreadable saved snapshots are preserved separately so a fresh sync can proceed. Cache pruning, download queue UI and service continuation remain missing. |
| Audio downloads | `SyncClient.kt`, `LibraryDownloadService.kt` | **Host-tested HTTP + source-only app.** URLSession streams to a temp file; response revision and length checked before same-directory atomic rename. Load-on-demand/all-audio flow; bulk skips tracks with no audio revision. Background download service and progress/resume UI are missing. |
| Library browsing | `Library.kt`, `Query.kt`, `browse/*` | **Core host-tested by fixtures and ported Android FilterTest/PlaylistTest expectations; UI source only.** Search, null-last sorting, playlist order, any/all tag/filter logic, energy/BPM/key/downloaded gates. Current UI exposes search, playlist/sort, one tag, exact energy, downloaded-only. Full filter controls and browser marking/highlight parity remain open. |
| Follow | `Follow.kt`, golden resources | **Host-tested.** Exact order, labels and compatible scores across 49 desktop/Android cases, 1,996 output rows; BPM-gate fixtures. UI supports a loaded-deck or selected-track reference. Multi-reference selection/explanation UI is missing. |
| Waveforms | `Waveforms.kt`, `WaveformStyles.kt`, `WaveView.kt` | **Host-tested formats + source-only overview.** Checked MWF1/MPK1 parser, gamma dequantization, header timing and three-band grouping. Native display-clock detail/overview painter now uses actual cached8-band MWF data, Android column grouping and99th-percentile fill gain, shared pinch zoom, grid/cue/loop overlays and scrubbing. Real simulator motion is recorded, not a60fps/latency guarantee. Cue flag geometry and latest portrait/minimap pixels pass the simulator checkpoint. Detail fetch/tiles, heard history, live-EQ lobe behavior and waveform editing remain missing. |
| Track edits and sync journal | `Edits.kt`, `edit/*`, backend `/edits` and `/received` | **Missing.** No title/tag/energy/grid/mark editor, change journal, newest-wins application or received-change log. Do not claim two-way sync. |
| Full grid/metric ladder behavior | `GridMath.kt`, `Hypermeter.kt` | **Core models only.** Saved grid/ladder parses. Full variable-tempo grid math, metric ruler/ladder editing and hypermeter UI are missing. |
| Session recording | `session/SessionRecorder.kt`, `SessionRecording.kt` | **Missing.** Master audio recording is not a substitute for event-session capture. |
| Session list/replay/timeline | library/app `session/*` | **Missing.** No local/desktop/peer-session fetch, reducer, frame-stamped replay driver, timeline tiles or replay heard-history view. Shared engine supports underlying scheduling, but that alone is not a port. |
| Trusted/group exchange and replay | library `group/*`, `session/PeerSessions.kt` | **Missing.** No group authority/bindings/bundles/history/replicas, peer exchange or group replay. Source-module presence is not an assertion that every Android path is publicly exposed. |
| Stems | Android stem download/decode, shared `StemGain` | **Missing app integration.** Four-stem engine code exists unchanged, but C/Swift loader and UI do not load stems or expose gains. |
| Scratch and sync groups | shared `Scratch*`, `SetSyncMembers`, `PhaseAlign` | **Engine only.** No iOS control/worker/UI port. Shared implementation does not establish iOS feature availability. |
| Persisted decks/imports | `DeckPersistence.kt`, `MediaSources.kt` | **Partial source only.** Imported files are app-owned and cached library survives. No saved-imports browser or deck-state restoration. Performance edits are local to the current run. |
| Visualizers | `viz/*` | **Missing.** Not replaced with decorative/synthetic waveform data. |
| Android self-update | `update/*` | **Not portable as-is.** No iOS updater or distribution channel selected. App Store/TestFlight/direct-device distribution requires a separate decision. No Apple enrollment or paid service activated. |
| Removed downloading | base merge #493 | **Intentionally absent.** No Soulseek or SoundCloud download feature revived. SoundCloud likes/wishlist is not part of this slice. |

## Next gates, not approved scope cuts

1. Expand the successful Apple build/native test/portrait screenshot checkpoint to loaded tracks, landscape, a smaller iPhone and an iPad.
2. Exercise interruption/headphone-route changes, repeated loads, long-file seeking/EOF, key-lock/fallback truth, memory pressure and master-recording failure/finalization on an iPhone.
3. Port the edit journal and full grid/waveform behavior, then session/group replay and remaining performance controls, using Android's existing fixtures wherever available.
4. Resolve the iOS deployment floor and distribution approach with the owner before committing to a release policy.

## Deferred device backlog

Owner priority, November18 2026: standard-size iPhone first.

- Compact iPhones: support remains requested but is not part of the current fidelity acceptance gate. The iPhone SE (3rd generation) test exposed pitch at y743..778 on a667pt screen, outside the usable area. Keep both decks, waveforms and transport visible; the owner approved a tap-open native FX/EQ mixer panel as the preferred compact-layout tradeoff, rather than shrinking every control. Validate actual compact pixels, hit regions, safe areas and larger text before claiming support. The opt-in compact diagnostic is retained with `CHECK_COMPACT_PHONE=1`.
- Future "iphone duo" support: preserve the owner's exact playful term as backlog intent. Device identity, screen sizes, folding behavior and hardware specification are unresolved. Do not implement a guessed device or substitute the SE for that request. Clarify the target when this work becomes active.

## Tonight live-play v0 scope, November18 owner clarification

Session playback and recording may stay under construction. Current priority is direct local-Wi-Fi library transfer from the already-populated laptop, then loading and playing downloaded tracks on the iPhone. This does not authorize cloud relay, library upload, new company-account access or unrelated work-laptop installation. The iOS sync source uses one explicitly entered desktop origin and rejects redirects. The composed desktop listener loopback test proves more than a stub HTTP server, but it does not prove physical LAN access. Real composed-server and generated common-codec checks now pass in the native simulator suite at e11a802f; physical iPhone pairing/network permission, Wi-Fi transfer and audible playback remain separate acceptance checks. Only the laptop's present files can transfer; absent originals must not be advertised as downloaded. The code does not implement audio transcoding for unsupported formats.


## Device divergence: implemented behavior versus design exploration

Checked November 19 against personal desktop main `4fe1d5f8` and iOS `e11a802f`. Desktop/Android sync files are unchanged between these bases. The iOS client is pull-only: its library repository has no edit journal, upload to `/edits`, or pull-diff report to `/received`. Cue changes in the current iOS player remain engine-local. Do not describe this as two-way iPhone library sync.

Android and desktop already implement a journaled two-way subset in `backend/device_edits.py`, `backend/routers/device_sync.py`, `android/library/src/main/kotlin/dev/manadj/library/Edits.kt` and `LibraryRepository.kt`:

- Each cue slot is one value containing time, label and color. Main cue, each tag membership, title, artist, energy and key are also editable fields.
- Saved beatgrid is one whole grid value, reset marks one whole list, and each synced performance setting one whole JSON object. They are not merged element by element.
- Phone applies a journal overlay locally, then pushes before pulling. Unanswered edits remain pending; answered UUIDs leave the journal even when superseded or rejected.
- Desktop applies automatically if its value still matches the phone's old value, or if the phone edit wins its timestamp comparison. Otherwise the outcome is superseded. Track timestamps are coarse for scalar fields, main cue and some missing/deleted-row cases. Future phone times are capped at receipt; clock skew is not eliminated. There is no per-field version vector or preflight three-way resolver.
- The desktop Device change log offers post-sync row/batch revert, not approval before overwrite. Revert writes a previous value over the current value as a new logged change, with no stale-resolution compare-and-swap check. Edits are committed individually, not as one atomic multi-field batch.
- Archived/deleted desktop tracks reject pending phone edits. Two-way playlists, audio mutations and library deletion/restoration are not covered by this journal.

New conflict-specific mockups are design exploration, not existing functionality or approval to write a real library. They should distinguish cue-slot positions, grid/tempo structure, scalar/tag edits, playlist membership/order and delete-versus-edit. Show whose value and which revision is compared, preserve unresolved alternatives, and recheck for changes before applying a reviewed resolution. Playlist and delete resolution require new protocol work. Session/group immutable conflicts are separate from ordinary library-field divergence.


## November19 browser filter progress

At `aa568cec`, the expanded native filter drawer, multiple ANY-tag chips and explicit BPM-reference action pass a new regular-iPhone16 input story. Actual tag/BPM/keyboard screenshots were inspected. The current Android app browser uses absolute ±6 after folding the candidate BPM; its separate library package uses percentage windows. The iOS browser now matches the app behavior while preserving the package percentage API and its tests. [Run](https://github.com/murtaza64/manadj/actions/runs/44654404986), [evidence](https://github.com/murtaza64/manadj/actions/runs/44654404986/artifacts/14592598943). 24 core, 4 bridge, 7 native and 4 UI tests pass; unsigned simulator/device builds pass. This is not merge-hold acceptance or physical-device evidence.

Next branch slice adds an explicit select-row accessory and highlight for the BPM reference while preserving existing tap-to-load and swipe-load routes. Its Apple/pixel verification remains pending. Android's nested source navigation, edit affordance, metadata density and selected-row interaction are not yet equivalent. No real-library writes are authorized by this preparation.

## November20 isolated playlist draft prototype

`PlaylistDraftStore` is a pure local, durable planning experiment, not a mobile
playlist editor or sync implementation. It stores a reviewed base and proposed
name/member order under an explicit paired-library identity. It never modifies
the saved snapshot, uploads changes, or resolves competing edits. A different
library, changed/missing playlist, or missing desired track holds the draft. No
create/delete policy is selected. There is no UI or transport consumer yet.
The integer playlist/track IDs are explicitly source-scoped, not stable global
playlist/entry identities. Stable identity, tombstones, causal propagation,
acknowledgements and approved operation/conflict semantics remain future work.
Fixture tests cover persistence, discard, stale-source holds, validation and
save failure without erasing pending work. Apple/Swift verification is required
before treating the new prototype as tested. No real library was used.

## November20 shake-to-report feedback prototype

Shake → capture → review → file feedback, ported from the desktop feedback
loop (`frontend/src/feedback`, `backend/feedback.py`) rather than Android.
Core payload/scrub/outbox logic is Foundation-only in ManadjCore with fixture
tests; the desktop accepts reviewed phone reports through one scoped write,
POST /api/device-sync/feedback, filed by the paired desktop's own credentials
through the existing FeedbackService. The full loopback feedback router is
not exposed on the LAN. Screenshots and context stay in the desktop's local
feedback store; the GitHub issue is text-only with a report marker, and the
review sheet says so. Shaking never sends anything by itself. Offline or
unpaired explicitly filed reports save on-device. REVIEW SAVED REPORTS makes
each saved report inspectable with text, image, context and current destination.
Only an explicit per-report reviewed-send can transmit it later; re-pairing,
launching, shaking and filing another report never drain the outbox.
Apple build/runtime verification, simulator pixels and physical-device shake
checks are pending; treat as untested until those land.
