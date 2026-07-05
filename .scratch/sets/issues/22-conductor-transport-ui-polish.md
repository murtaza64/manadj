# 22 — Conductor transport UI polish

Status: needs-triage

## Parent

.scratch/sets/PRD.md (follow-up to issues 04/16 — filed from 16's review, 2026-07-05)

## What to build

The Set toolbar's Conductor transport (▶ Play set / ⏸ / ⏹ / ⤴ Pick up)
grew organically as small inline-styled buttons in the header's right
cluster. Three asks from review:

1. **Respect the site-wide button style.** The app has a shared button
   system (`frontend/src/styles/utilities.css`: `.btn`, `.btn-primary`,
   `.btn-success`, `.btn-danger`, `.btn-secondary`); the toolbar buttons
   (transport, Pick up, Auto-fill, Suggest) are hand-rolled inline
   styles. Migrate to the shared classes (variants as appropriate).
2. **Center the transport in the viewport.** Play / Pick up / Pause
   should sit centered (media-player convention), not tucked into the
   right-side toolbar cluster with the pin/suggest actions.
3. **More visual weight.** The transport is the view's primary action —
   make it bigger/bolder than the secondary toolbar actions.

## Notes

- Bright, fully saturated colors per AGENTS.md (no pastels).
- Pick up's lit/unlit + reason-tooltip behavior (sets 16) must survive
  the restyle: disabled state with teaching `title`, lit state visually
  distinct.
- Triage should pin down: centered in which container (Set detail pane
  header vs. a floating transport bar), and what happens on narrow
  widths.

## Acceptance criteria

- [ ] Transport buttons use the shared button classes (no bespoke inline styles)
- [ ] Play/Pick up/Pause centered in the Set view's viewport
- [ ] Transport visually dominant over Auto-fill/Suggest
- [ ] Pick up lit/unlit + tooltip reasons unchanged

## Blocked by

—
