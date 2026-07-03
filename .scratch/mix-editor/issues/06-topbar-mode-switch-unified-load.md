# 06 — Top bar: mode switch, brand, sync; unified load mechanics in the editor

Status: ready-for-agent (claimed 2026-07-03, in progress)

## Parent

`.scratch/mix-editor/PRD.md` (Re-scope: "the editor is the third top-panel
mode"). User-requested iteration 2026-07-03.

## What to build

- Persistent top bar across the three modes (Library / Performance /
  Transition editor): manadj logo, three-way mode switch, Sync button.
  Replaces the sidebar's logo/sync/▸ header row and the Performance view's
  floating "← Library" button. Sync stays a separate full-screen flow.
- The Transition editor becomes a real App mode (`?proto=mix` still opens it
  directly for `make proto`).
- Editor load mechanics match Performance: hover row buttons load→A/B,
  double-click loads A, ↑/↓ navigate the embedded library, ←/→ load to
  A/B, Enter loads A. The header "load → A/B" buttons and selection-name
  readout are removed (no load lock in the editor — its deck pair is not a
  live surface).

## Acceptance criteria

- [ ] Top bar visible and mode switch works in all three modes; active mode
      indicated
- [ ] Logo + Sync in the top bar; removed from the sidebar
- [ ] Performance and editor layouts fill the remaining height (no 100vh
      overflow under the bar)
- [ ] Editor: hover A/B buttons, double-click→A, arrow-key browse + load work
- [ ] tsc, eslint on touched files, vitest green

## Blocked by

None - can start immediately.
