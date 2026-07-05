# 01 — Sink + bridge tracer

Status: ready-for-human

## Parent

`.scratch/headphone-cue/PRD.md`

## What to build

De-risk ADR 0017 end-to-end before any mixer work builds on it: prove that
we can enumerate audio output devices, point the primary AudioContext's sink
at a chosen master device, and deliver a second signal to a *different*
device over a MediaStreamDestination → second-AudioContext bridge.

- Device enumeration incl. the permission caveat (labels/ids may need a
  grant; the desktop shell can pre-grant — record what was needed in the
  issue's comments).
- A dev-only trigger is fine (e.g. a test tone or a master copy on the
  bridge); no product UI yet.
- Capture measured bridge latency and any glitch behavior in comments —
  the cue/mix design (ADR 0017) rests on "constant-ish tens of ms".

## Acceptance criteria

- [ ] Master audio audibly follows a sink change (e.g. Mac speakers →
      Inpulse outs) without reload
- [ ] A bridged signal plays on a second device simultaneously
- [ ] Unplugging the bridge's device kills only the bridged signal; master
      unaffected
- [ ] Routing-resolution logic (device present/missing → chosen sinks) as a
      pure function under vitest
- [ ] typecheck, eslint on touched files, vitest green

## Blocked by

None - can start immediately.

## Comments

- (hpcue lane, change qospplnr) Implemented:
  - `frontend/src/playback/routing.ts` — `resolveRouting` pure seam +
    `routing.test.ts` (7 tests): master falls back to default when its saved
    device is gone, cue disables; unset cue is "off", not "missing".
  - `frontend/src/playback/audioDevices.ts` — `listAudioOutputs()` with the
    permission unlock (throwaway `getUserMedia({audio})`, tracks stopped
    immediately, re-enumerate) + `onAudioDevicesChanged`.
  - `frontend/src/playback/cueBridge.ts` — `CueBridge` (ADR 0017):
    MediaStreamDestination in the main graph → MediaStreamSource in a second
    context → `setSinkId(cue device)`. `setSink`/`stop`/`latencyInfo`.
  - `Mixer.setMasterSinkId(sinkId|null)` — stored, reapplied on graph
    revival (failure → warn + default, master never dies).
  - `frontend/src/playback/webAudioSink.d.ts` — `AudioContext.setSinkId` is
    missing from TS 5.9's lib.dom; global interface merge until it lands.
  - Dev tracer `frontend/src/dev/audioRoutingTracer.ts`, lazy-installed from
    DeckContext in dev only: `__routing.devices() / setMaster('inpulse') /
    setMaster(null) / startCue('label-substr') / stopCue()` (440 Hz tone
    over the bridge; logs base/output latency for both contexts).
- Permission findings (code-level; browser-verify below): Chrome hides
  output labels AND non-default device ids until a media-capture grant.
  Desktop shell now pre-grants `media` + `speaker-selection`
  (desktop/main.js GRANTED set) so neither `enumerateDevices` nor
  `setSinkId` prompts; plain-Chrome dev gets one mic prompt on first
  `listAudioOutputs()`.
- 4-channel caveat (from PRD/handoff): the bridge targets the DEFAULT
  stereo pair of the selected sink. If the Inpulse enumerates as one
  4-channel device (outs 1/2 rear RCA, 3/4 front headphone jack) rather
  than separate stereo pairs, front-jack delivery will need
  `channelCount`/ChannelMergerNode handling on the cue context —
  investigate at the hardware smoke test; single-context 4-channel routing
  stays a later optimization per ADR 0017.
- READY-FOR-HUMAN — verify with the physical device (change qospplnr, or
  after landing):
  1. `__routing.devices()` — Inpulse listed? One 4-ch device or two stereo
     pairs? Any prompt (browser vs `make app`)?
  2. Play a track, `__routing.setMaster('inpulse')` then
     `setMaster('macbook')` — master follows live, no reload.
  3. `__routing.startCue('inpulse')` with master on Mac speakers — tone on
     the Inpulse (which jack?), master unaffected; note logged latencies
     and any glitches/dropouts over a minute.
  4. Unplug the Inpulse mid-tone — tone dies, master keeps playing.
