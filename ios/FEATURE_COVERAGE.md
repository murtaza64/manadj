# Android → iOS feature coverage

Baseline: personal `murtaza64/manadj` main at `d137e2d7` (piracy-removal merge). This map uses current source modules, not only the older Android README's pending labels. It is not approval to remove or defer Android features permanently.

## Apple runtime checkpoint

At `7457bf24`, Xcode 16.4 unsigned build and all 3 native/UI tests passed on iPhone 16 Pro / iOS 18.5 simulator. Native WAV decode and basic engine transport passed; actual empty-workspace/Settings portrait screenshots were inspected. [Evidence](https://github.com/murtaza64/manadj/actions/runs/44392249847). This narrow result does not validate every control, real audio quality, loaded-library behavior or physical-device routing. In the table, **Source only** means the individual feature still lacks runtime proof, even though the app builds and launches.

## Status key

- **Host-tested**: relevant Swift/C bridge behavior ran on Linux. Not iOS runtime proof.
- **Source only**: implementation exists, but Apple build/runtime validation is missing.
- **Core only**: model/engine behavior is available, but the iOS application does not expose the complete feature.
- **Missing**: not implemented in this slice. It remains an Android-parity gap.

| Area | Android source basis | iOS state and remaining work |
|---|---|---|
| Native interface | `app/Layouts.kt`, `Theme.kt`, `Controls.kt` | **Partly simulator-checked.** SwiftUI launches; C/D selector and Settings navigation pass UI tests. Actual empty-workspace/Settings portrait screenshots inspected. Native Files/share sheets and hold/release/cancel still need interaction checks. |
| Four decks | `PlayerModel.kt`, `Deck.kt` | **Source only.** Four engine decks, A/B and C/D workspace selector, two-column layout above 760 points. Not a port of Android's complete L1/L3 layouts. |
| One-handed layouts | `onehand/*` | **Missing.** Focus/chords/rings variants are not recreated. Requires interaction design and device checks, not a web-view substitute. |
| Playback/DSP engine | `audio-engine/src/main/cpp/Engine.*` | **Host-tested seam.** Compiles the existing engine unchanged. C bridge tests render synthetic audio and check position/seek. Apple callback and basic transport pass the native simulator test; device latency and sound quality remain unverified. |
| Native decoding and load ownership | `audio/AudioEngine.kt`, decoder classes | **Source only + host-tested C protocols.** AVAudioFile mono/stereo 8–192 kHz; one serial worker/deck; superseded loads cannot write a new load. No Ogg/codec parity claim. Generated WAV decoding passes the native simulator test. Long files and the codec matrix remain unverified. |
| Memory and long files | Android full/range decode and ring APIs | **Source only.** Up to 64 MiB decoded PCM/deck uses the shared full-track buffer; larger files stream through the bounded ring. No duration rejection/truncation. Ring backpressure, sample-rate conversion, seek refill and EOF pass host tests. Android's priority/range-fill optimization is not ported. |
| Play, pause, cue and hot cues | `Deck.kt`, shared `Op` handlers | **Source only + host-tested engine.** Cue/gated hot cues, set/clear and saved snapshot marks load into the engine. iOS touch cancellation and interruption timing need device tests. No cue write-back/persistence. |
| Seek, pitch and bend | `Scrubber.kt`, `PitchPanel.kt` | **Source only.** Native seek/tempo sliders, reset, held ±4% bend, ±8% pitch. No platter scratch/drag-bend gesture parity. |
| Jump, loop and quantize | `JumpLoopRow.kt`, `Keys.kt`, shared engine | **Source only.** Beat jumps, half/double loops, loop toggle and Grid quantize. Heard quantize/calibration UI is missing. Current app uses first saved tempo segment, like the basic Android load path; no full grid editor. |
| Key lock | shared Signalsmith engine path | **Source only.** Toggle reaches unchanged engine. Fully decoded tracks can use key lock; streamed tracks explicitly fall back to varispeed. No iOS runtime/audio parity claim. |
| Channel mixer | `Mixer.kt`, `FilterSettingsPanel.kt` | **Source only.** Three-band EQ, filter position, channel fader, PFL, global cue blend and crossfader. Trim UI and advanced/custom filter-settings application are missing. |
| Beat FX | shared `BeatFx.h`, app controls | **Source only.** Echo, low-cut echo, reverb, flanger, trans and roll, target/depth/beats/on. Full settings/hold semantics and automation are not ported. |
| Output and interruptions | `OutputPanel.kt`, `PlaybackService.kt` | **Source only.** Fixed 48 kHz source with AVAudioEngine output conversion, playback category, background audio declaration, stereo and split mono. Route changes stop output; interrupted recordings remain partial. Quad USB output, remote controls, automatic media-services rebuild and real route tests are missing. |
| Master recording | `MasterRecordingBar.kt`, `MasterRecordings.kt`, `MasterRecorder.h` | **Host-tested engine + source-only app.** Finalized stereo PCM16 WAV, no microphone access, completed-file sharing. Host test checks RIFF and byte length. Native interruption/overflow/storage/end-to-end sharing must still be exercised. No session event recording. |
| Pairing | `library/Pairing.kt`, `DesktopDiscovery.kt` | **Host-tested HTTP client + source-only UI/Keychain.** Request/match-code/approval token; token header takes priority, redirects rejected. Device-only Keychain storage. Desktop address entry only; LAN discovery/mDNS and older pairing-code UI are missing. |
| Snapshot and offline cache | `SnapshotJson.kt`, `Store.kt`, `LibraryRepository.kt` | **Host-tested.** Versioned models, tags/categories/playlists/grids/cues/evidence/settings, atomic last-good snapshot and revision-keyed cache. Duplicate/malformed identities rejected before acceptance. Concurrent syncs are rejected; cache audio must be a nonempty regular file matching its expected length. Unreadable saved snapshots are preserved separately so a fresh sync can proceed. Cache pruning, download queue UI and service continuation remain missing. |
| Audio downloads | `SyncClient.kt`, `LibraryDownloadService.kt` | **Host-tested HTTP + source-only app.** URLSession streams to a temp file; response revision and length checked before same-directory atomic rename. Load-on-demand/all-audio flow; bulk skips tracks with no audio revision. Background download service and progress/resume UI are missing. |
| Library browsing | `Library.kt`, `Query.kt`, `browse/*` | **Core host-tested by fixtures and ported Android FilterTest/PlaylistTest expectations; UI source only.** Search, null-last sorting, playlist order, any/all tag/filter logic, energy/BPM/key/downloaded gates. Current UI exposes search, playlist/sort, one tag, exact energy, downloaded-only. Full filter controls and browser marking/highlight parity remain open. |
| Follow | `Follow.kt`, golden resources | **Host-tested.** Exact order, labels and compatible scores across 49 desktop/Android cases, 1,996 output rows; BPM-gate fixtures. UI supports a loaded-deck or selected-track reference. Multi-reference selection/explanation UI is missing. |
| Waveforms | `Waveforms.kt`, `WaveformStyles.kt`, `WaveView.kt` | **Host-tested formats + source-only overview.** Checked MWF1/MPK1 parser, gamma dequantization, header timing and three-band grouping. UI draws cached broadband preview and actual playhead only. Detail fetch/tiles, spectral styles, beat rulers, heard history and waveform editing are missing. |
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
