# 02: Tag editor popover on the deck

Status: ready-for-agent

The TRACK zone's tag pills (and "+" button) open the existing `TagEditor` in
a popover anchored to the tag row, per the grilled decision (reuse, not
rebuild).

- Read/write the deck's track through the `['track', id]` query cache
  (`useDeckTrack` pattern); invalidate `tracks`/`playlist` like other PERF
  edits.
- Keyboard: the popover must swallow keys while open (performance key hub
  claims most of the keyboard); Escape closes.
- Mirrored deck B: popover anchors/aligns right.
