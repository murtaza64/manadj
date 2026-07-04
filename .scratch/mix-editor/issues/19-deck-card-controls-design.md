# 19 — Deck card grid/nudge controls: layout and design

Status: closed (implemented change `rmmoxzso`; user-verified 2026-07-04.
Segmented pairs also wrap the slide/jump gesture cluster.)

## Parent

`.scratch/mix-editor/PRD.md`. Design-language pass companion to issue 17
(an agent may sensibly take both together).

## What to build

Redesign the deck cards' control cluster (currently: disconnected
`track ◀` `▶` / `grid ◀` `▶` / `downbeat @ playhead` buttons with the
label living inside the left button of each pair — unclear pairing,
inconsistent widths, visually noisy).

- **Segmented pairs**: each ◀/▶ pair becomes one control — shared 1px
  border, label as a non-interactive prefix segment (`track ‹ | ◀ | ▶ ›`
  reading as a single unit), player-button idiom (transparent, bold,
  square, catppuccin functional colors per group).
- Consistent control height and horizontal rhythm across the whole card
  row (BPM spinner, pairs, downbeat button all on one baseline grid).
- `downbeat @ playhead`: keep the explicit label but visually weight it as
  an action distinct from the nudge pairs.
- Deck B mirrors deck A's layout (right-aligned) with identical metrics.
- Show each nudge pair's step where it has one (grid nudge ±10ms) as part
  of the label or a title tooltip — no new inputs.
- Iterate live with screenshots; exact spacing/proportions are taste, the
  grouping/idiom above is the requirement.

## Acceptance criteria

- [ ] Each ◀/▶ pair reads unambiguously as one grouped control with its
      label; no orphan arrow buttons
- [ ] Uniform heights/alignment across the deck card control rows; A and B
      mirror exactly
- [ ] Styling consistent with player-button controls elsewhere on the site
- [ ] eslint on touched files green; NOTES.md iteration entry (screenshot
      round with the user before closing)

## Blocked by

None - can start immediately. Coordinate with issue 17 (shared CSS) and the
deck-slide controls (issues 11/12) which will add to this cluster —
grouped-pair styling should be reusable for their beatjump/hotcue rows.
