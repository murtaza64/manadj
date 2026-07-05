# 02: Tag editor popover on the deck

Status: done (landed with perf-layout: 02-tag-editor-popover)

The TRACK zone's tag pills (and "+" button) open the existing `TagEditor` in
a popover anchored to the tag row, per the grilled decision (reuse, not
rebuild).

- Read/write the deck's track through the `['track', id]` query cache
  (`useDeckTrack` pattern); invalidate `tracks`/`playlist` like other PERF
  edits.
- Keyboard: the popover must swallow keys while open (performance key hub
  claims most of the keyboard); Escape closes.
- Mirrored deck B: popover anchors/aligns right.

## Comments

- Implemented as `TagPopover` (performance/TagPopover.tsx) — reuses the
  TagEditor's tag-toggling idiom (instant per-toggle saves, filter +
  ↑/↓/Enter, add/remove glow) but NOT the whole panel: title/artist/energy/
  BPM already live on the TRACK zone, so mounting TagEditor would duplicate
  controls. Deviations: Enter keeps the popover open (multi-tagging);
  key-swallowing via the focus-held filter input (the perf hub guards
  typing targets) + stopPropagation.
