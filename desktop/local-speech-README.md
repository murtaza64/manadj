# Local Speak integration, compiled OFF

The shell registers a main-frame-only bridge with `local-speech-target.js` fixed
OFF. Disabled capability/start calls never spawn, prompt or capture. The
preload exposes only capability/start/stop and text/status subscription, not
paths, locales, audio or arbitrary commands. FeedbackEntry selects the local adapter when this bridge exists and never
falls back to a browser service after local denial. The OFF capability keeps
Start disabled. Do not call this working Speak.

`local_speech_bundle.py` builds a dedicated ad-hoc-signed helper application
with both usage strings. macOS assembly now places it at the fixed runtime path before signing the
outer app. Packaging never probes or starts it, and the runtime target stays
OFF. Ad-hoc signing does not prove stable identity or TCC attribution.

## Boundary

- macOS Speech only. Require `supportsOnDeviceRecognition` and set `requiresOnDeviceRecognition = true` before constructing the task. No network fallback, third-party transcription endpoint, raw-audio file or renderer audio bridge.
- A nonprompt `--probe locale` reads local capability/permission state without requesting authorization or accessing a microphone. `--start locale` is the only path that can prompt or capture.
- Start requires both microphone and Speech usage strings in the helper's actual bundle/embedded plist. Apple requires the Speech purpose string even for forced-local recognition.
- One utterance, final editable text only, at most 60 seconds. Parent supervisor limits bytes, validates a closed protocol and kills on stop, dispose, timeout, invalid output or process error. No automatic restart. No automatic report send.
- Main-process supervisor owns a fixed helper path. The renderer must never choose executable paths, command arguments, arbitrary locale text or session ownership. The bridge validates local main-frame identity and session binding, with navigation/close teardown.

## Still required

1. Existing isolated helper native compilation passed. Complete integrated bundle CI and independent lifecycle/security review, including denied permission, unavailable locale/model, permission prompt cancellation, interrupted capture and shutdown.
2. Build helper into a dedicated signed application identity with truthful purpose strings. Verify actual macOS TCC attribution, signing and parent-child lifetime. Dev attach mode must not claim support without this helper.
3. Verify integrated feedback UI capability, cancellation generation and local-only wording with actual pixels and native permission states. Preserve Type/Speak availability and truthful unsupported state on Windows/Linux or missing local model.
4. Real personal-Mac on-device validation, no work computer access. Check no network audio, no persistent audio/transcript logs, capture indicator, stop/close prompt cancellation and playback CPU/audio impact. CI/no-microphone mocks cannot prove these.
5. Full integration tests and actual UI pixels before enabling. No release cut is authorized by preparation work.

## API evidence

- https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition
- https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition
- https://developer.apple.com/documentation/bundleresources/information-property-list/nsspeechrecognitionusagedescription
- https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription
- https://www.electronjs.org/docs/latest/api/system-preferences
