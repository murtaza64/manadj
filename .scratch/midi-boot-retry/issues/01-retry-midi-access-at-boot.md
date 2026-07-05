# 01 — Retry MIDI access at boot (one failed request bricks the Controller layer)

Status: done (approved and landed 2026-07-05, change zpnxqvwu)
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

**2026-07-05 (opencode, lane midi-boot-retry) — root cause captured; design
revised.** Human smoke test of the first cut: retry ran but every attempt
failed (`[object DOMException]` — the shell's console pipe flattens
objects); a later run failed with NO logs at all and cmd+R fixed it. The
second observation was the tell: the boot `requestMIDIAccess()` doesn't
(only) reject — it can HANG unsettled, which a rejection-only retry never
sees. Revised design, all in `adapter.ts`:

- Per-attempt watchdog (4s): an unsettled attempt is treated as failed and
  the next attempt starts; the dangling promise keeps racing — first
  success wins, late losers are dropped.
- Errors logged as `name: message` (survives the console pipe).
- Success is logged too (attempt number, port counts, port names) — a hung
  boot was previously indistinguishable from "granted but no match".
- Sticky-failure backstop: after 3 dead attempts, reload the page once
  (sessionStorage loop guard; ~3-17s after mount, before anything plays).
  Post-reload boots run the full schedule then degrade as before.

Live confirmation during agent sanity boot (shell attached to lane app,
Inpulse connected): attempt 1 hung and was watchdogged, attempt 2 granted
access and attached the controller — recovery without reload:

    MIDI access request failed (attempt 1 of 6), retrying in 1000ms: request did not settle within 4000ms
    MIDI access granted (attempt 2): 1 inputs, 1 outputs — DJControl Inpulse 300 Mk2

Agent verification: build + vitest 919/919 green. Smoke test unchanged
(relaunch shell, badge green, pads work) — expect a `MIDI access granted`
info line every healthy boot now.
