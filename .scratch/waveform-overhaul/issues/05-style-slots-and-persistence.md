# 05 — style slots, persistence, and the tuning surface

Status: resolved (wfproto lane, 2026-07-04 — pending user eye-verify of tuning page)

## Parent

`.scratch/waveform-overhaul/PRD.md`

## What to build

Two persisted Waveform style slots — `full` and `minimap` — stored in localStorage as one versioned key (matching the codebase's UI-preference pattern), each holding a style id + params, defaulting to the tuned B. Surfaces declare which slot they use; changing a slot's style or params takes effect live on every surface using it. The prototype page (`?view=wfproto`, dev-only) is repointed at the production waveform module and becomes the tuning surface: its style switcher and sliders read/write the persisted slots. Absorb the still-relevant content of the prototype's NOTES.md into the PRD/ADRs and delete what's stale (per the prototype skill's capture-then-clean rule); the throwaway `ProtoWaveformGL.ts` is deleted once the page runs on the production module.

## Acceptance criteria

- [ ] Versioned localStorage key with `full` + `minimap` slots; unknown/missing versions fall back to defaults
- [ ] All surfaces read their declared slot; a param tweak on the tuning page is visible live in the library player and Performance view
- [ ] Prototype page runs against the production module; `ProtoWaveformGL.ts` deleted
- [ ] NOTES.md findings absorbed into durable docs; file removed
- [ ] `npx vitest run` and `npm run build` green in `frontend/`

## Blocked by

- `04-full-parity-all-surfaces.md`

## Comments

**2026-07-04 (wfproto lane, change `zmqtonkw`)** — Implemented `styleSlots.ts`: versioned
localStorage key (`manadj.waveformStyles`, v1) with `full` + `minimap` slots, sanitizing
loader (unknown versions/styles/params fall back per-field to defaults), `useStyleSlot`
via useSyncExternalStore — `setSlot` repaints every mounted surface live.
`useWaveformRendererV2` takes a `slot` option ('full' default; WaveformMinimap passes
'minimap'); the issue-04 minimap x1.25 master hack is replaced by the minimap slot's own
default (master 1.0 vs full's 0.78). The prototype directory is deleted wholesale
(`ProtoWaveformGL`, `decodeWfb`, `PrototypeSwitcher`, page, committed .wfb blobs,
`scripts/proto_waveform_blob.py` — absorbed into `backend/waveform_data.py` in issue 01);
its replacement `waveform/StyleTuningPage.tsx` (still dev-only `?view=wfproto`) renders
the REAL `WebGLWaveform` + `WaveformMinimap` components against live library tracks with
audio playback via the tracks audio endpoint, and its sliders edit the persisted slots.
NOTES.md open items absorbed into the PRD's Further Notes. tsc, 197 vitest, build green.
