# 05 — style slots, persistence, and the tuning surface

Status: ready-for-agent

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
