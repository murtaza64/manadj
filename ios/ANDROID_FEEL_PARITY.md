# Android-to-iOS feel parity, working checklist

This is a review ledger, not release acceptance. Android is a baseline, not a requirement to copy its rough edges. Both existing iOS PRs remain on hold.

## Evidence baseline

- Production Android source: d137e2d7, debug 0.1.0-rc.8. Reference branch changes only workflow and instrumentation.
- Clean Android portrait and Collection screenshots: run 44414066045. Generated 24-second PCM tones and actual decoded/analyzed waveforms, no commercial music.
- That run verified injected touchscreen Play, Pause and Browse with native playing-state assertions. It then failed an extra navigation step because Collection was already selected. It is not an all-pass exploration run.
- Current Apple baseline: Xcode 16.4 / iOS 18.5 simulator. No signed physical iPhone check.

## Motion and input

| Android behavior | Native iOS implementation direction | Verification still needed |
| --- | --- | --- |
| Frame-clock waveform redraw, extrapolated position; discontinuities snap | CADisplayLink drawing separate from observable UI poll; pure WaveClock port with seek/stop/rate tests | Native build, loop/seek recording, long frame intervals under interaction |
| Heard-time latency correction and stop-tail handling | Not yet implemented on iOS; current predictor is engine-time only | Route-aware output latency model and actual output alignment |
| Immediate 0.93 key press, spring return, 240ms glow release | Native key press compression and spring, UIKit touch-down/cancel handling for gated controls | Compare temporal recordings; glow details remain incomplete |
| Cue/hotcue press begins immediately, release/cancel ends it | UIKit touch-down/up/outside/cancel; haptic call on press | Slide-to-play and cancellation under navigation not yet equivalent |
| Knob chooses dominant horizontal/vertical relative axis, center notch, two-finger fine adjustment | Dominant-axis SwiftUI drag, neutral crossing haptic, double-tap reset | Two-finger fine mode, sticky notch escape distance, fixed numeric popover missing |
| Fader rail/handle semantics, optional double-tap centering | Rail/offset-grab drag, double-tap centering, correct thumb dimensions and local gesture feedback implemented | Pending expanded Apple gesture story and actual pixels, not accepted |
| Pitch opens on down with 240ms slide and 140ms fade | In-place one-deck overlay, native animation | Trigger timing and interruption/cancel path need comparison |
| Hardware haptic events for key, notch, long press, wheels | Native selection and light/medium impact generators | Simulator cannot establish physical strength, timing or feel |

## Waveform fidelity

- Dedicated detail versus minimap rendering is required. The previous all-track overview used as a detail wave was wrong.
- New native painter ports Android's eight-band grouping: FFT half-window alignment, box-filter mean or interpolation, squared companding, 3/2/3 grouping, per-group gains, soft limiting and additive-soft overlap color calculation.
- Cached columns live at absolute track-time coordinates so scrolling translates stable columns instead of resampling every frame.
- Detail playhead is 30% from the left in portrait. Vertical detail time runs downward and uses an 18% top playhead.
- Both decks must share zoom. Track-time span scales with tempo only. Momentary bend changes motion, not scale.
- Beat/bar/16/32/64-beat grid tiers, cue markers, hotcue numbers and active-loop range must remain legible.
- Detail pinch range is 0.75 to 48 seconds, matching Android. Scrub previews should pause and commit on release, cancel without committing and resume prior playback. This is not a scratch implementation.
- Missing: true scratch/vinyl behavior, heard-strip EQ/filter history, per-channel audible top/raw bottom lobe, Android fill normalization, synced waveform-style settings, exact overview brightness/style and output-latency phase alignment. Do not call waveform parity complete.
- Synthetic fixture MWF data is analyzed from the same generated PCM, using Android FFT=1024, band hop=512, peak hop=128 and band edges. It is not a decorative invented waveform.

## Deliberate native departures

- Recording strip: user identified Android's strip as a rough edge. iOS uses compact record/saved controls and a quiet master-format label, not the large outlined Android bar. Needs side-by-side review.
- Secondary controls may use native material. Performance lanes stay black, opaque and high-contrast.
- Apple glassEffect is iOS26+. Xcode16.4/iOS18.5 cannot verify it. Do not label ultraThinMaterial as Liquid Glass.
- Apple advises sparse glass use, preserving content clarity and respecting Reduced Transparency, Increased Contrast and Reduced Motion. True glass work requires an iOS26 SDK/runtime build and pixel check before acceptance.

## Acceptance gates

1. Clean same-fixture Android/iOS portrait, landscape, browser and pitch screenshots, actual pixels reviewed.
2. Native Play/Pause/Cue/hotcue/loop/jump/zoom/seek input paths with state checks and recordings.
3. No accidental full-screen scroll, no hidden performance controls, no keyboard/focus regressions.
4. Frame-callback diagnostics and motion video are simulator evidence, not a guarantee of physical-device frame smoothness or touch-to-audio latency.
5. Physical iPhone session: cue cancellation, scratching, route latency, haptic feel, thermal/audio stability, accessibility settings.
6. No merge until review hold is explicitly lifted. A green compile or unit suite alone is insufficient.

## Sources

- Android source: android/app/src/main/java/dev/manadj/app/Layouts.kt, Controls.kt, Deck.kt, WaveView.kt, Waveform.kt, UiModel.kt.
- Android runtime: https://github.com/murtaza64/manadj/actions/runs/44414066045/artifacts/14478372755
- Apple: https://developer.apple.com/documentation/swiftui/view/glasseffect(_:in:)
- Apple: https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass.md
- Apple accessibility discussion: https://developer.apple.com/videos/play/wwdc2025/219/

## Apple HIG synthesis, November 18 review

Sources checked live: https://developer.apple.com/design/human-interface-guidelines/layout.md , https://developer.apple.com/design/human-interface-guidelines/buttons.md , https://developer.apple.com/design/human-interface-guidelines/accessibility.md .

Apple's general button guidance calls for 44x44pt hit regions, clear custom press states and space between controls. The current accessibility table distinguishes 44x44pt default from 28x28pt minimum, not permission to make every control tiny. Layout guidance requires safe areas and text-size adaptation. Our current dense dual-deck layout has not passed that bar on the smallest phone or large Dynamic Type. A clipped-but-green UI test is not acceptance. Small-phone capture is now a separate test destination, and compact-layout tradeoffs must be visible in review rather than quietly shrinking text or hiding controls.

Broader differences tracked after the first real iOS screenshot: segmented loop/jump capsules, cue timestamps, mirrored SHIFT/stem rows, jump default32, fader rail/handle semantics and level fill, cue/filter color drift, browser navigation/chips/swipe-load structure. The waveform fill normalization matches Android's99th-percentile rule, including its1..3 gain cap. Heard-time alignment, true scratch, EQ-history lobes and physical haptic feel are still missing even after these improvements.

## Current device scope

Owner steering November18 4:00pm: optimize standard-size iPhone first; compact-phone support is backlog. Verification now selects the regular iPhone16 where installed, not the Pro as an unspoken proxy. SE diagnostic remains opt-in (`CHECK_COMPACT_PHONE=1`), with its confirmed off-screen pitch gap recorded, not fixed by dropping the test silently. Owner also requested future "iphone duo" support playfully; no device specification or hardware identity has been assumed for that phrase.

## Iterative polish pass after November18 16:30 review

Source-grounded corrections, not visual acceptance: 1/1.5pt empty/marked pad borders, 2pt transport border, 15/8pt cue label hierarchy, marked pad fill, labels under knobs, fader thumb/travel geometry, real bend rail, and Android-style top-rounded pitch tab. Control drags now keep a local visual value between engine UI polls. Press compression, release spring and haptic calls remain native implementations, not proof of physical feel. Expanded UI story exercises fader drag, loop, held cue, EQ double-tap, bend release and transport recovery. Session/recording completeness is not a tonight-v0 gate per owner; live play and local library transfer take priority.


## November 19 standard-phone checkpoint

At `24bb9012`, seven native and three UI tests pass on regular iPhone 16 / iOS 18.5. The center REC/WAV and saved-recordings controls pass hit/placement assertions between the channel faders. Detail flags use centered 14pt digits; minimaps use small unnumbered pins. Actual portrait, pitch, library and keyboard-search pixels were inspected. The bottom-pitch regression introduced by the recording row was fixed by reserving more vertical clearance, with the existing safe-area assertion retained. [Run](https://github.com/murtaza64/manadj/actions/runs/44484532224).

This checkpoint does not lift either merge hold, establish physical haptic/audio quality, implement session replay or claim compact-phone acceptance. Dynamic Island recording status and saved-mix Now Playing boards are design concepts only. A Live Activity is not a background audio engine. Event-session replay and listening to a rendered recording are distinct features.


## November19 verified runtime recovery

At `e11a802f`, the current [iPhone16 run](https://github.com/murtaza64/manadj/actions/runs/44586424500) passes 23 core, 4 audio-bridge, 7 native and 3 UI tests, plus unsigned simulator/device builds. Actual library search refusal/acceptance, live-mixer recovery and settings/pitch stories pass without removing their playing/paused assertions. The previous stall was a test fixture's Foundation `Process.waitUntilExit`, confirmed by stack sample; bounded termination observation fixes it. This does not identify the earlier accessibility timing failure as a proven single-cause defect.

Fresh portrait/library/pitch pixels and sampled actual UI-runner video frames were inspected. Overall A/B hierarchy aligns with the clean Android reference, but full filter depth, explicit filter/back presentation, waveform overview coloring, stem availability and transport cue icon still differ. Existing iOS playlist/on-phone/tag/energy filters and eight sort columns are implemented; a two-track fixture without tags does not establish their absence. Android clean reference's touch Play/Pause/Browse assertions ran, then its extra Collection step failed because Collection was already selected; it is not an all-pass exploration run. Different browser fixture libraries cannot establish metadata or track-count equivalence.

Physical Wi-Fi pairing/audio transfer, audible output, haptics, interruption/cancellation, heard-time alignment and detailed temporal comparison remain unverified. No merge hold is lifted. Session/replay may remain under construction within the user's live-play-v0 priority; it is still requested coverage, not removed scope.
