# 08 — Connection indicator: MIDI badge in the top bar

Status: ready-for-human (implemented, change orxoukxq; checks green — hardware eye-verify pending)

## Parent

`.scratch/midi-controller/PRD.md`

## What to build

A small always-visible badge at the top right of the top bar showing whether
a mapped Controller is connected: bright green + device name (title) when a
matched input port is attached, dim when not. Driven by the adapter's
port-attach/detach lifecycle (including hot-plug), so it reflects reality —
not just permission state.

## Acceptance criteria

- [ ] Badge visible in every mode (top bar is persistent)
- [ ] Plug in the Inpulse → badge lights, device name in the tooltip
- [ ] Unplug → badge dims without reload
- [ ] Ports that match no Mapping do not light the badge
- [ ] make typecheck, eslint on touched files, vitest green

## Blocked by

None (rides the adapter from 01).

## Comments

- New `midi/connectionStore.ts`: module store (id → port name) with
  subscribe/snapshot for useSyncExternalStore; the adapter publishes on
  mapped-port attach/detach and on dispose. TopBar renders the badge from
  the store — no new MIDI access, no polling.
