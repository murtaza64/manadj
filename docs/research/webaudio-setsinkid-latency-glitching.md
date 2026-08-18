# Web Audio: setSinkId, latencyHint, sample-rate & macOS HDMI glitching

Research into Chromium/Electron `AudioContext` output behaviour. Sources are
Chromium source (googlesource `main`), the W3C Web Audio 1.1 spec, MDN, and the
Chromium issue tracker. Line references are to `main` at time of writing.

## TL;DR

- `setSinkId()` does **not** use a fundamentally different, glitchier output
  path than the constructor. Both tear down and re-create the same platform
  `AudioDestination` (new `media::AudioOutputDevice`). The device's buffer size
  and latency come from the same per-device negotiation. What differs is the
  *device* you land on: a non-default device (HDMI/DisplayPort, aggregate,
  Bluetooth) can have a larger/less forgiving hardware IO buffer and a different
  hardware sample rate, both of which change the glitch profile.
- `latencyHint` is **construction-only**. No API changes it on a live context;
  changing it requires a new `AudioContext`.
- A `sampleRate` that differs from the output device's hardware rate **does**
  insert a `MediaMultiChannelResampler` stage in Blink's `AudioDestination`, and
  it raises the algorithmic-latency floor. It is a real, avoidable cost — match
  the device rate to skip it.
- macOS has an explicit "buffer too small at high sample rates → glitching"
  rule, and a shared-device buffer-size constraint (crbug 428706) that can
  prevent enlarging the IO buffer for a device that already has an
  active smaller-buffer stream. HDMI/DisplayPort devices commonly run at 48 kHz;
  the safety-offset problem bites hardest at >48 kHz and on aggregate devices.

---

## 1. setSinkId output path vs default-device path; glitching on macOS HDMI

### Is the code path different?

No separate "slow path." `AudioContext.setSinkId()` → Blink
`RealtimeAudioDestinationNode::SetSinkDescriptor()` →
`RealtimeAudioDestinationHandler::SetSinkDescriptor()`, which **re-creates the
platform destination** (a fresh `blink::AudioDestination`, hence a fresh
`media::AudioOutputDevice`) pointed at the new sink. The constructor path
(`new AudioContext({sinkId})`) reaches the same handler code. On sink-open
failure Chromium falls back to the default device
(`audio_context.cc`: "Fallback to the default device due to an invalid audio
device change").

Source:
- `third_party/blink/renderer/modules/webaudio/realtime_audio_destination_node.cc`
  (`SetSinkDescriptor` → handler).
- `third_party/blink/renderer/modules/webaudio/audio_context.cc`
  (`setSinkId`, default-device fallback).

So the buffer-size / latency selection is identical logic; only the target
device's *properties* differ. Both the default and non-default paths go through
the audio service (`media::AudioOutputDevice` IPC to the audio process) — the
constructor's default sink is not a special in-renderer fast path that setSinkId
bypasses. There is a separate render-side FIFO buffering stage
(`AudioDestination` `PushPullFIFO`, default size `128*128 = 16384` frames) on
both paths; a runtime flag `WebAudioBypassOutputBuffering` exists but is a test
knob, not tied to setSinkId.

### Why non-default (HDMI/DisplayPort) devices glitch on macOS

The glitch driver is the target device's **hardware IO buffer size** and
**hardware sample rate**, selected in `media/audio/mac/audio_manager_mac.cc`:

- `ChooseBufferSize(is_input, sample_rate)` → `GetMinAudioBufferSizeMacOS()`.
  At >48 kHz the base 128-frame buffer is deemed too small and is scaled up
  (see §5). HDMI at 48 kHz gets the 128-frame default; an aggregate/hi-res HDMI
  path at 96/192 kHz gets 2×/4×.
- `MaybeChangeBufferSize()` reads/sets `kAudioDevicePropertyBufferFrameSize`.
  Crucially, if another stream is already active on the same device with a
  **smaller** requested buffer, Chromium will **not** enlarge the IO buffer
  (comment cites `http://crbug.com/428706`). A device shared with a
  low-latency capture/output stream can therefore be stuck at a too-small buffer
  for a heavier WebAudio graph → underruns/stutter.
- `GetIOBufferFrameSizeRange()` clamps the requested size to the device's
  supported `[minimum, maximum]`; CoreAudio silently limits invalid sizes
  (e.g. 4410 → 4096 on most devices).

Underruns surface in `blink::AudioDestination::Render()` as FIFO-underrun glitch
accounting; the code explicitly references large-buffer Bluetooth devices
(100–150 ms) and demotes a hard CHECK to DCHECK for suspend/resume races
(`crbug.com/528653884`, and the older FIFO-not-ready `crbug.com/692423`).

Related setSinkId tracker items (device-change robustness, not glitch-specific):
- crbug **333163673** — Windows crash after `setSinkId` when no speaker present.
- Chromium CL threads "Handle sink failure for AudioContext.setSinkId"
  (feature-media-reviews) — the fallback-to-default machinery.

No single canonical crbug says "setSinkId to HDMI on macOS underruns"; the
behaviour is emergent from the per-device buffer/rate negotiation above plus the
shared-device constraint (428706).

---

## 2. latencyHint → buffer size / total latency on macOS

Mapping happens in two layers.

### Blink: latencyHint category → `media::AudioLatency::Type`
`interactive` (default) → `kInteractive`; `balanced` → also treated as the
interactive/low bucket in practice; `playback` → `kPlayback`; a numeric value →
`kExactMS`. (Enum: `media/base/audio_latency.h` — `kExactMS=0, kInteractive=1,
kRtc=2, kPlayback=3, kUnknown=4`.)

### media: Type → callback buffer size (`media/base/audio_latency.cc`)

- **`interactive`** → `GetInteractiveBufferSize(hardware_buffer_size)`.
  On desktop macOS this just returns the **hardware buffer size** unchanged
  (the LCM/`kWebAudioRenderQuantumSize` logic is Android-only). So callback size
  = the device's CoreAudio IO buffer, typically **512 frames** (CoreAudio
  default since OS X 10.9), or **128** for a low-latency-capable device, up to
  `kMaxAudioBufferSize`.
- **`balanced`** — no distinct macOS buffer formula; resolves to the same
  low-latency/interactive sizing. (`balanced` is not given its own larger buffer
  on macOS the way `playback` is.)
- **`playback`** → high-latency path, `GetHighLatencyBufferSize(sample_rate,
  preferred)`. On non-CRAS/non-Win/non-Fuchsia platforms (incl. macOS) it is the
  nearest power-of-two ≥ 20 ms:
  - ≤6400 Hz → 128; ≤12800 → 256; ≤25600 → 512; ≤51200 → 1024;
    ≤102400 → 2048; ≤204800 → 4096.
  - At 44.1/48 kHz → **1024 frames** (~21–23 ms), then `max(preferred, that)`.
- **numeric seconds** → `kExactMS` → `GetExactBufferSize(duration, sample_rate,
  hardware_buffer_size, min, max, max_allowed)`. Rounds the request to
  `duration*sample_rate`, then to a multiple of the hardware buffer (clamped to
  `min_hardware`..`max_allowed`). On macOS min/max hardware buffer are
  128/4096 (`media/base/limits.h` `kMinAudioBufferSize=128`,
  `kMaxAudioBufferSize=4096`; `kMaxWebAudioBufferSize=8192`).

### Total output latency
`baseLatency ≈ callbackBufferSize / sampleRate`. `outputLatency` adds the FIFO
delay + hardware output latency (device-reported; HDMI/BT can add tens of ms).
Approx at 48 kHz:
- interactive: 512/48000 ≈ **10.7 ms** (or 128 → ~2.7 ms on capable devices)
- playback: 1024/48000 ≈ **21.3 ms**
- exact: whatever you asked, snapped to a hardware-buffer multiple within
  [2.7 ms, 85 ms] (128..4096 frames).

Read the true value from `AudioContext.baseLatency` / `outputLatency` after
construction — the hint is advisory (MDN, spec §7.1).

---

## 3. Can latencyHint change on a live context?

No. It is a construction-time member of `AudioContextOptions` only. There is no
setter, and the spec/IDL expose no method to change it. MDN and the Web Audio
1.1 spec (`#dictionary-audiocontextoptions-members`) treat `latencyHint` as a
constructor option; the resulting `baseLatency` is a read-only attribute. To
change it, create a new `AudioContext`. (`setSinkId` changes the *device*, not
the latency category — though re-creating the destination for a new device does
re-run the buffer-size selection for that device.)

---

## 4. Does sampleRate mismatch add a resample stage? Is it implicated in glitching?

Yes to the resampler; it is a latency/CPU cost more than a direct glitch cause,
but it interacts with glitching.

In `third_party/blink/renderer/platform/audio/audio_destination.cc`
constructor: if `context_sample_rate_ != web_audio_device_->SampleRate()` (and
the `WebAudioRemoveAudioDestinationResampler` feature is not enabled), Blink
builds a `MediaMultiChannelResampler` (`SincResampler`) with
`scale_factor = context_rate / device_rate`. It logs
`"=> (resampling from X Hz to Y Hz)"`. When rates match it logs
`"=> (no resampling: context sample rate set to X Hz)"`.

Consequences called out in-source:
- The `SincResampler` needs at least `kMinRequestSize` input frames, creating an
  **algorithmic-latency floor**: the graph must buffer
  `RoundUpToMultiple(kMinRequestSize, renderQuantum)` frames before producing
  resampled output. Small render quanta pay a larger relative latency penalty.
- Extra per-callback CPU on the render thread. If the graph is already near the
  real-time deadline, the resampler's added work raises underrun probability —
  so mismatch is *implicated* in glitching indirectly (more work per callback),
  not as a distinct artifact.
- UMA: `WebAudio.AudioContextOptions.sampleRate` /
  `.sampleRateRatio` record the mismatch; a resampler removal experiment
  (`kWebAudioRemoveAudioDestinationResampler`) exists, indicating active work to
  drop this stage.

Practical guidance: construct `AudioContext` **without** `sampleRate` (inherits
the device's preferred rate) or match it to the target sink's hardware rate to
avoid the resampler entirely. Note the device rate can change when you
`setSinkId` to a different device, so a fixed `sampleRate` that matched the old
device may start resampling on the new one.

---

## 5. macOS safety-offset / IO-buffer issues with HDMI

- **High-sample-rate buffer bump** (`audio_manager_mac.cc`
  `GetMinAudioBufferSizeMacOS`): the default (128) buffer is "too small for
  higher sample rates and may lead to glitching." It scales:
  ≤48 kHz → 128; 48–96 kHz → 256 (2×); 96–192 kHz → 512 (4×). HDMI/DisplayPort
  audio typically negotiates 48 kHz (→128, no bump); high-res/aggregate outputs
  at 96/192 kHz get the larger buffers automatically.
- **Shared-device enlargement block** (`MaybeChangeBufferSize`, cites
  `crbug.com/428706`): you cannot raise the IO buffer above the smallest
  requested size of any already-active stream on the same device. A WebAudio
  context that needs a bigger buffer for an HDMI device also feeding a
  low-latency stream can be pinned too small → underruns.
- **CoreAudio clamping** (`GetIOBufferFrameSizeRange`): requested sizes are
  clamped to the device's `[min,max]`; CoreAudio silently rounds invalid sizes
  (4410 → 4096). Aggregate/HDMI devices can report narrow ranges.
- **Reported hardware output latency**: `AudioDestination::Render` reads
  CoreAudio's playout `delay`; HDMI/receivers add real output latency (video
  sync/processing), inflating `outputLatency` (not underruns per se, but timing
  drift for sync).
- Chromium constants: macOS min/max audio buffer = 128 / 4096 frames
  (`media/base/limits.h`).

The classic macOS CoreAudio "safety offset" (`kAudioDevicePropertySafetyOffset`,
extra frames CoreAudio requires before the read/write head) is a real HDMI/USB
pain point at the CoreAudio level, but Chromium does not expose or special-case
it; it manifests to Chromium as the device advertising a larger minimum IO
buffer / higher reported latency, which the above logic then respects.

---

## Source index

- Spec: Web Audio API 1.1 — https://webaudio.github.io/web-audio-api/
  (`#AudioContextOptions`, `#dom-audiocontext-setsinkid`, §7.1 Latency,
  §7.4 Audio Glitching).
- MDN: `AudioContext()` constructor, `AudioContext.setSinkId()`,
  `AudioContextLatencyCategory`, `baseLatency`, `outputLatency`.
- Chromium `main`:
  - `media/base/audio_latency.cc`, `media/base/audio_latency.h`
  - `media/base/limits.h`
  - `media/audio/mac/audio_manager_mac.cc`
  - `third_party/blink/renderer/platform/audio/audio_destination.cc`
  - `third_party/blink/renderer/modules/webaudio/realtime_audio_destination_node.cc`
  - `third_party/blink/renderer/modules/webaudio/audio_context.cc`
- Tracker/CLs: crbug 428706 (shared-device buffer size), 692423 (FIFO not
  ready), 528653884 (suspend/resume underrun DCHECK), 333163673 (setSinkId
  crash, no device); feature-media-reviews "Handle sink failure for
  AudioContext.setSinkId".
