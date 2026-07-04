# 02 — One BPM control over the projection model

Status: ready-for-human

## Parent

`.scratch/deck-controls/PRD.md` (curation class); ADR 0016.

## What to build

One shared BPM component replacing the three idioms (library `BpmInput`
with octave dropdown; PERF uncontrolled input + ½/×2; editor draft-state
input):

- Displays the PROJECTED BPM (grid-dominant when a grid exists);
  variable grids read `~N (var)` and are not editable.
- Edit commits through slice 01's server op — the client-side
  PATCH→delete→regenerate ritual is deleted from all three call sites.
- Feature union, density-parameterized: octave/suggestion affordances
  (library's) and ½/×2 (PERF's) available where space allows
  (`perf-mini`-style modifier hides the long tail); ±0.03 micro-nudge
  kept (library keyboard parity).
- Effective-BPM readout (base × pitch × bend / editor rate) stays a
  per-surface concern beside the control, not inside it.
- Icons (PRD icon language): BPM step buttons use the grid compress
  (`→←`, up) / spread (`←→`, down) SVG icons — not ±; halve/double
  shortcuts read `1/2` / `x2` (plain text).

## Acceptance criteria

- [ ] Library, PERF deck panels, and editor DeckCards all render the
      shared component; the three old inputs are gone
- [ ] Rapid ±0.03 nudges stay serialized/visible (issue mix-editor/24's
      regression, now guaranteed by the server op — verify by eye)
- [ ] Variable-grid track: readout only, no input, in all modes
- [ ] tsc, eslint, vitest green; component snapshot/behavior tests at the
      commit seam (fake api)

## Blocked by

- 01 (server op).

## Comments

Done (change `msmksuqx`, lane bpmctl): shared `BpmControl` in
`components/deckControls/` (BpmControl.tsx + bpmCommit.ts seam +
bpmCommit.test.ts, 10 tests); grid compress/spread icons in
`components/icons/BpmIcons.tsx`; call sites replaced in TagEditor
(dropdown variant), PERF BeatgridBlock (`dense`, keeps » readout), editor
DeckCard (`dense`, keeps effective/pitch readout, `onCommitted` →
player.setBpm + onBpmSaved); `components/BpmInput.tsx` deleted (only
TagEditor imported it). Projection: grid-dominant tempo (duration-weighted
port of backend `dominant_bpm`), variable grids render `~N (var)` readout
with edit-the-grid tooltip. 409 → console.warn + draft revert.

By-eye checklist for a human:

- [ ] Library: type a BPM (blur/Enter commits), pick a suggestion/octave
      from the dropdown, rapid-click the ±0.03 nudges — value never skips
      backwards (server-serialized; issue mix-editor/24)
- [ ] PERF deck: BPM edits with 1/2, x2, nudges; effective `»` readout
      follows pitch/bend; waveform grid re-tempos after edits
- [ ] Editor deck cards: BPM edit updates tempo-match (player.setBpm) and
      the effective/pitch readout
- [ ] Variable-grid track shows `~N (var)` readout (no input) in all three
      surfaces; tooltip explains
- [ ] Nudge icons read as grid compress (up) / spread (down) at 11px
