# 08: Unified interaction vocabulary

Status: done (approved in-session, landed lpsvkryx 2026-07-05; lane perfui stays open)

Performance-mode controls used seven different hover/press treatments
(audit 2026-07-05): dim, brighten, hue-shift, fill, scale, opacity, none —
plus box-shadow glows on some on-states. Unified (grilled in-session,
no-glow revision) to:

- **Rest**: white text/icon on a quiet grey border (`--surface1`) — the
  base `.player-button` white border is gone app-wide. Accent controls
  (CUE, paused PLAY, set energy, set hot cues, deck load buttons) rest in
  their accent color.
- **Hover**: border brightens to white + bg tint (`--surface0`) — the
  joined-panel idiom. Accent controls keep their accent border; the tint
  carries the feedback. Set hot cues brighten their tint 12%→25%; unset
  pads preview the slot color on the border.
- **Press**: one fill step up (`:active` → `--surface1`; load buttons
  `--surface2`).
- **Engaged/held**: solid inverted fill in the accent (PLAY green, LOOP
  green, PFL/keylock green, CUE-held orange, strip toggles yellow, nudge
  held yellow, previewing hot cue in its cue color). No glows anywhere.

Implementation notes:

- HotCue: all states derive from a `--cue-color` custom property (slot
  palette per `.cue-N`; stored colors override the property inline instead
  of overriding border/background/color) — state rules apply uniformly.
- Scale-on-hover and every interaction box-shadow removed. Remaining
  box-shadows are structural (popover drop shadow, sticky-column shadow).
- Segmented panels: cluster hover border now brightens to `--text`
  (matches the standalone idiom); segment hover fill unchanged.

Testing Decisions: visual review by the human (lane app); frontend build +
vitest as regression floor. Review-gated.

## Comments

- Scope extended (2026-07-05, user request): same vocabulary applied to
  the transition editor (switcher, fit, jump marker glow removed, take
  banner, jump popover de-hardcoded, deckcard rows with alignment/action
  accent pins, lock/mute/star/templates-open inverted, laneclear/savetpl
  feedback added) and library filtering (FilterBar rebuilt on CSS classes
  — search field, x-buttons, key/bpm triggers with inline accent pins,
  follow toggles inverted in deck colors, Clear All, ANY/ALL, tag pills
  inverted in tag color; energy squares on an --energy-color property;
  sort headers tint instead of hue-shift; resize handle tokenized;
  BpmModal/CoF buttons; playlist sidebar rows/CTAs via new
  PlaylistSidebar.css). sets/SetsSidebarSection.tsx deliberately skipped —
  frontend/src/sets/* is lane setlist's claimed area; mirror the
  PlaylistSidebar patterns there once that lane lands.
- Deliberate exceptions: link-toggle opacity reveal; editor lane-strip
  inset accent edges (structural, not controls); sorted header = mauve
  text (inverted fill overweights a table header); row selection =
  surface0 (not a button engaged state); .editor-fit keeps its crust
  backdrop (floats over the timeline).
