# 04 — Routing picker + persistence

Status: ready-for-human

## Parent

`.scratch/headphone-cue/PRD.md`

## What to build

Product UI over issue 01's plumbing:

- A routing picker in the app chrome (top bar or the performance view's
  middle strip — implementer's choice of the two): Master bus device and
  Cue bus device, each any enumerated output (Mac speakers, Mac-jack
  headphones, Inpulse interface, "off" for cue).
- Persistence: device id + label per bus survive restarts; on boot,
  re-resolve by id — missing master device falls back to the system
  default, missing cue device disables the Cue bus. Audio must never be
  dead because a saved device is gone.
- Mid-session device disappearance tears the bridge down safely (master
  never at risk); picking it again rebuilds.

## Acceptance criteria

- [ ] Both buses routable from the picker; changes take effect live
- [ ] Restart restores the routing; unplugged saved cue device → cue
      disabled, master on default, no errors
- [ ] Unplugging the cue device mid-session: master keeps playing
- [ ] Routing-resolution edge cases under vitest (extends issue 01's pure
      function)
- [ ] typecheck, eslint on touched files, vitest green

## Blocked by

- 02-cue-bus-pfl-end-to-end

## Comments

- (hpcue lane, change ytqykolk) Implemented:
  - `frontend/src/playback/routingStore.ts` — module-level store (like
    connectionStore): persists `{master, cue}` device id+label under
    localStorage `manadj-audio-routing`, re-resolves via `resolveRouting`,
    applies to the Mixer, replaces a stable snapshot for
    useSyncExternalStore. `devicechange` → re-resolve, so unplugging the
    cue device tears the bridge down mid-session and replugging restores
    it; master apply failure falls back to default. Boot skips enumeration
    (and thus the permission path) when nothing is saved; the picker
    enumerates on open instead.
  - `parseRoutingPrefs` joined routing.ts (pure): malformed persisted blobs
    degrade per bus, never throw at boot — tested alongside the resolution
    edge cases (12 routing tests total).
  - `AudioRoutingBridge` (headless, App.tsx beside the MIDI registrars)
    hands the Mixer to the store.
  - `AudioRoutingPicker` in the top bar (app chrome, reachable from any
    view): OUT button → popover with MASTER (System default / devices) and
    CUE (Off / devices) selects. Missing saved device stays listed as
    "(missing)" + a note line; button turns green when routed, red when
    degraded. Desktop shell: popover explicitly opted out of the titlebar
    drag region (TopBar.css).
  - 432 vitest green; tsc, eslint, prod build clean.
- READY-FOR-HUMAN (change ytqykolk): route MASTER→Mac speakers, CUE→
  Inpulse; both live without reload. Restart → routing restored. Restart
  with the Inpulse unplugged → master plays on default, OUT red, cue
  "(missing)"; replug → cue comes back (devicechange) or reopen the picker.
  Unplug the Inpulse mid-PFL → master keeps playing. Verify in both plain
  Chrome (expect one mic prompt on first picker-open) and `make app`
  (expect none).
