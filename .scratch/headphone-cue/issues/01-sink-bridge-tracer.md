# 01 — Sink + bridge tracer

Status: ready-for-agent

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
