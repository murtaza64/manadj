# Native phone critique — #365

Reviewer: OpenAI gpt-6-astra. Support only; no app edits, emulator use, issue claim, or landing.

## Closure — 2026-10-13

**Ready for human trial. Original blockers 1–7 are resolved sufficiently for this prototype trial; no remaining blocking correction identified.** This is not production acceptance, audio certification or landing approval. Twin deck remains the recommended baseline. Earlier findings below are historical; optional concepts are not handoff requirements.

Current evidence: [review page](http://127.0.0.1:5190/review.html). Downloaded APK bytes independently hash to `4ce91c2dc871b70c1bd4bdf1a41d2d3c0c3bfa75d8cf659acb5e95986b56f56b`.

| Original blocker | Closure evidence |
|---|---|
| 1. FX ownership | Current `DjModel.kt:125–126,159–165` has separate A/B delay buffers, half-beat at each deck's base BPM; `chooseFxTarget` defers while captured. `fxTargetSelectionWaitsForHeldDepthRelease` passes. Audio isolation is source-verified, not independently heard/measured. |
| 2. Precision blackout/reset | Published `native-filter-hold-overlay.png` shows local `A / FILTER`, START value/ghost and RESET without a scrim; transports/XF remain legible. Overlay Y is bounded to viewport. Reset-version rebasing is implemented and its instrumentation test passes. |
| 3. Multitouch/cancel | Feedback is keyed by originating deck/control; unrelated release removes only its entry. Passing tests cover FILTER+XF, FILTER+B CUE, two CUE fingers, and ACTION_CANCEL restoration. Read manual Home screenshots (74%→50%) and rotation screenshots (held CUE→released). These support the author's manual account, not an independently reproduced lifecycle test. |
| 4. Landscape targets | Current MIX/LOOP/FX 800×360/1.3× screenshots have playable rows without clipping/scrolling; compact captions removed. Read both all-bank portrait/landscape test logs and latest XML: ten tests, zero failures/errors. Tests check continuous controls and representative primary button heights across all five banks, not every possible target/variant/device. |
| 5. Ambiguous cuts/direction | Published compact MIX/FX/PADS show `CUT A` / `CUT B`, vertical tile indicators and ↕ labels; XF shows ↔. Compact hint text truncates on narrow EQ tiles but direction/value remain visible; not a trial blocker. |
| 6. Hidden state | Published `native-loop-fx-state-persist.png` shows `L4 FX` on A while PADS is selected. No output meter is present; playing must not be interpreted as audible. EQ remains UI-only. |
| 7. Stale splash | Fetched the exact current review-page URL `native-compact-final-360x640.png`: now a mounted cockpit, not splash. Also fetched current compact MIX/FX, precision and landscape bank links. |

Reviewed current source and `NativeGesturesTest.kt`, `.lane-tmp/native-connected-tests-allbanks-{portrait,landscape}.log`, and `app/build/outputs/androidTest-results/connected/debug/TEST-phone_365(AVD) - 15-_app-.xml`. Screen sizes/font settings are author-reported and corroborated by screenshots; test logs do not independently encode those settings. Downloaded current `native-demo-365.mp4` and inspected sampled frames: native fixed canvas/transport/bank state; approximately 20 seconds, no audio stream. Video is supplementary, not proof of every gesture test.

Untested limits: no physical-phone touch/occlusion trial, no measured audio latency or frame timing, no independent listening or audio-output capture. Extreme overlay positions and every simultaneous gesture combination are not exhaustively verified. Generated audio, UI-only EQ, absent output metering/headphone routing/local library/desktop sync remain prototype limits. No new required scope.

Closure delivered to author mail #34 and project mail #41. Parent durable input `android-astra-365-closure-4ce91c2d` promoted as `msg_136e72657001PQriZQrlYT2pRh`.

## Initial review (superseded by closure above)

## Direction

**Keep the fixed twin-deck cockpit; not ready for human acceptance yet.** Both transports remain visible, the workspace has explicit A/B ownership, and relative tile capture is the right direction. Native compilation is not interaction evidence. The current presentation still reads as a button grid plus miniature horizontal faders; the vertical gesture is hidden in INFO.

| Option | Judgment |
|---|---|
| Twin deck | Recommended baseline: stable A/B locations in portrait and landscape. |
| Focus | Do not lead with this. Selecting B physically swaps the transport locations (`MainActivity.kt:314–315`), undermining motor memory. Keep the safety rail fixed if retained. |
| Split | Optional landscape comparison. Portrait spends a large rectangle on empty demo timelines while narrowing track labels and transport buttons. |

## Before human handoff

1. **Fix FX ownership, not just its labels.** `DjModel.kt:136–138` applies echo to summed A+B audio; TARGET A/B only chooses whose depth value drives that master echo. `MainActivity.kt:249–255` also changes FX target immediately during a held depth gesture; `RelativeTile.kt:37,80` then uses the updated setter, so the same finger can begin editing another deck. Either implement true deck targeting and defer target changes until release, or explicitly present MASTER ECHO with one master depth. The fixed delay is 0.5 seconds (`DjModel.kt:104`), not the advertised half beat at 120/126 BPM. Verify isolated A/B input and target changes during capture.

2. **Replace the blackout precision overlay with nonmodal, deck-labelled feedback.** The hold screenshot visibly hides both transports, status and crossfader under a 91%-opaque scrim (`MainActivity.kt:262–274`). Show `A FILTER` / `B ECHO DEPTH`, current value, neutral and touch-down ghost in an offset callout; leave the cockpit legible and second-finger targets available. Clamp above/below the finger within safe bounds, not merely a minimum Y. RESET must rebase the still-held gesture; currently it clears the readout without changing the gesture baseline, so subsequent motion can undo the reset. Test near top/bottom and while B CUE is held.

3. **Make precision feedback pointer-owned.** Every relative control writes one global `model.precision`; releasing *any* relative control clears it (`RelativeTile.kt:62,81,90`). Holding filter then dragging/releasing XF can erase filter feedback while filter remains held. Keep per-capture feedback or an explicitly selected primary readout that unrelated releases cannot remove. Verify two continuous controls, plus CUE; not just independent PLAY taps. Verify ACTION_CANCEL, Home/background and rotation release momentary cue and restore cancelled continuous edits without stale pending switches. The source has coroutine-finally cleanup, but no demonstrated lifecycle test here.

4. **Measure every landscape bank, not only PADS.** At 800×360 with assumed 24dp top/bottom insets: 312 usable − header48 − rail48 = 216; center − tabs48 − bank padding8 − deck selector48 = 112. MIX/FX/LOOP then divide the remainder between two rows, top/gaps and a caption: approximately 44dp per row, below 48. Reclaim the redundant caption/status allocation or use an explicit secondary page; do not shrink targets or add scroll. Latest 360×640 twin portrait budget is approximately 66dp per MIX row and is **not** the earlier compact failure. Verify actual bounds at 1.0×/1.3× font scale, all five banks, with real insets.

5. **Remove ambiguous hard-cut A/B buttons.** CrossRail's `A` and `B` instantly set crossfade to 0/1 (`MainActivity.kt:152–154`), while identically coloured A/B chips below select workspace ownership. Label them `CUT A` / `CUT B` if intentional performance actions, or make endpoints noninteractive identity marks. Preserve relative no-jump drag on the rail. Put a visible `↔` on XF and `↕ SWIPE · HOLD FINE` on MIX/FX; replace the little horizontal-slider appearance on vertical controls with a value/tick indicator. Users should not have to infer direction or open INFO.

6. **Keep live effects/loop state visible outside its bank.** Compact `DeckStrip` hides loop state with the noncompact subtitle (`MainActivity.kt:113–115`); FX ON/target disappears when leaving FX. Reserve a short persistent `A LOOP 4 · FX` state row/chip; show actual output activity or explicitly mark metering absent. Do not imply playing equals audible when XF or channel gain cuts that deck. This matters more than enlarging empty timeline rectangles. EQ remains clearly UI-only; do not claim audible EQ testing.

7. **Replace the compact “final” evidence.** At inspection, `native-compact-final-360x640.png` is the Android launch splash, not the cockpit. Wait for app readiness, capture again, and visually inspect the actual PNG. Publish current MIX, FX and precision frames as well as PADS. Identify older focus/split/gesture images as historical rather than proof of latest geometry.

## Optional concepts — choose at most one next

- **Pinned performance pair:** use surplus tall-screen pad height for two persistent, labelled 48dp relative tiles: `A FILTER` and `B FILTER`. Both remain operable while the bank shows pads/jump/loops; keep the other mixer controls banked. Compare “A filter sweep + B cue + XF” without bank changes. Cost: less pad/timeline space; compact mode needs a deliberate reduced pad page.
- **Temporary filter throw:** an explicitly named momentary FILTER THROW tile springs back to its touch-down value on release; normal FILTER stays latched. Hold opens the same offset fine readout. Never overload ordinary filter release with surprise reset. Test a phrase-long sweep while the other hand cues B.
- **Neutral catch:** give bipolar tiles a narrow center detent, a visible ghost of the starting value, and one haptic on entering neutral. Deliberate further travel exits; no permanent sticking. This is more useful than adding knob artwork. Current 0.025 snap band has no tactile/discoverable state.

## Decisions for the human, after blockers

- Default twin deck; keep focus/split only as comparisons, or remove them?
- Spend spare height on eight pads for one deck, or four pads plus a pinned A/B filter pair? Recommend the latter as the next comparison, not a silent replacement.
- Are explicit instant crossfade CUT actions wanted? Recommend ordinary no-jump rail first; add cuts only if intentional.
- A/B-only, generated audio and UI-only EQ remain prototype boundaries, not architecture decisions. No latency/performance claim from screenshots or compilation.

## Evidence and verification limits

Read all eight requested author-lane PNGs: compact-final (splash), normal 390×844, landscape 800×360, focus/split 360×640, filter tap, relative swipe and hold overlay. Read author `DESIGN.md`, support `android-touch-performance-design-365.md`, README, and current Compose/model sources. Line references above are to `prototypes/android-performance/app/src/main/java/dev/manadj/phonelab/` at review time; author is editing concurrently.

Square geometry, bundled Ubuntu Mono and saturated A/B identity fit manadj. No screenshots were generated by this reviewer; no audio, hardware multitouch, frame time or latency measurements were made. Tap/swipe stills plus baseline-relative source support the no-down-jump design, not empirical certification of the whole gesture lifecycle. Author owns emulator-5580 and all final capture/testing.

Initial author mail's estimate of ~39dp latest compact-portrait rows was withdrawn immediately; the report's landscape estimate supersedes it. Session guard reported trunk drift; support report only, no merge or landing attempted.

## Delivery / follow-up

Author received findings in lane mail #27–30; parent notified in project mail #32 and durable input `android-astra-critique-365-complete-20261013` (promoted, message `msg_136c2ad6b001xQce0u0kAZT9Kp`). No human attribution or approval.

Author subsequently reports 3/3 emulator instrumentation tests passing and source fixes for isolated FX, deferred target selection, local precision feedback and landscape row sizing; rebuild/capture pending. These are author reports, not reviewer re-verification. Existing tests do not establish two-relative-control precision ownership, reset rebasing or cancellation behavior. Re-reading the exact compact-final PNG still showed the splash; replacement remains required. Parent/author own final correction verification before human handoff.
