# 01 — Retry MIDI access at boot (one failed request bricks the Controller layer)

Status: ready-for-human
Type: task

## What to build

The Web MIDI adapter requests MIDI access exactly once, at mount. If that
boot-time `requestMIDIAccess()` rejects, the whole Controller layer goes
permanently inert: no `statechange` listener ever registers, so replugging
the controller does nothing, and the only recovery is a manual page reload.
The sole trace is a `console.warn`.

Diagnosed live 2026-07-05 (Electron shell, DJControl Inpulse 300 Mk2):
CoreMIDI, Chromium's MIDI backend, permissions, and mapping name-match were
all healthy — the device sat `connected/closed` while the connection store
stayed empty; a plain reload fixed it. Root cause of the individual boot
rejection was not captured (transient Electron/Chromium MIDI-service race
at startup); the durable bug is the adapter's lack of resilience to it.

Fix: retry the access request with backoff (e.g. a handful of attempts over
~30s), keeping the existing behavior on final failure (warn; keyboard and
pointer unaffected). A retry must respect the dispose flag — a disposed
adapter must not keep a retry timer alive or attach late. Log each failed
attempt's error so the next occurrence of the underlying race is captured
(this diagnosis lost it to console scrollback).

## Acceptance criteria

- [ ] A boot-time `requestMIDIAccess` rejection is retried; a later success
      attaches ports and registers `statechange` (hot-plug works from then on)
- [ ] Final failure degrades exactly as today (warn, layer inert, no throw)
- [ ] Dispose during a pending retry cancels it — no timers or late
      attachments after cleanup (StrictMode double-mount stays clean)
- [ ] Each failed attempt logs the rejection reason
- [ ] Healthy-boot behavior unchanged: badge lights, controller works

## Testing Decisions

House style (ADR 0002): the adapter is hands-on-hardware verified, no Web
MIDI mocking — there is **no unit seam for this by design**; do not add
mocks. Agent verification: frontend build + vitest suite green (translator
tests etc. untouched). The failure path can't be reproduced on demand:
request a human smoke test (shell relaunch, badge green, pads work) before
landing — review-gated despite being a bugfix.

## Blocked by

None - can start immediately.

## Comments

**2026-07-05 (opencode, lane midi-boot-retry, change zpnxqvwu)** — Implemented;
ready for human smoke test.

What changed: `frontend/src/midi/adapter.ts` only. The boot-time
`requestMIDIAccess()` now retries on rejection with backoff (1s, 2s, 4s,
8s, 15s — 6 attempts over ~30s). Each rejection is logged with attempt
count and the error; final failure warns and degrades as before. Dispose
clears any pending retry timer and both settle paths re-check `disposed`,
so StrictMode double-mount and late resolutions stay clean.

Agent verification: frontend build green, vitest 919/919, alembic single
head, rebased onto trunk tip. Two-axis code review clean.

Verification walkthrough (lane app running, vite 5303):

- Desktop shell: `npm --prefix /Users/murtaza/manadj/desktop start -- --port 5303`
  (or browser: http://localhost:5303)
- With the Inpulse 300 Mk2 connected, relaunch the shell: the MIDI badge
  should go green within a moment of boot (healthy boot unchanged); pads
  and transport controls work.
- If the boot race recurs, the console now shows
  `MIDI access request failed (attempt N of 6), retrying in Xms:` lines and
  the badge goes green on a later attempt — no reload needed. (Can't be
  forced on demand; the healthy-boot check plus a couple of relaunches is
  the smoke test.)
- Optional: unplug/replug the controller after boot — badge drops and
  returns (statechange path untouched).
