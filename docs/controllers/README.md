# Controller mappings

One page per supported Controller: which hardware control drives which
manadj action, the lights the app writes, and what is deliberately left
unbound. Wire-level facts and verification history live in
`docs/research/`; the code is `frontend/src/midi/mappings/`.

| Controller | Decks | Page | Code | Hardware-verified |
|---|---|---|---|---|
| AlphaTheta DDJ-GRV6 | 4 (layered sides, 4-channel mixer) | [ddj-grv6.md](ddj-grv6.md) | `ddjGrv6.ts` | yes |
| Hercules DJControl Inpulse 300 MK2 | 2 | [inpulse-300-mk2.md](inpulse-300-mk2.md) | `inpulse300mk2.ts` | mostly |
| Pioneer DDJ-SB3 | 4 (layered sides AND mixer strips) | [ddj-sb3.md](ddj-sb3.md), [user guide](ddj-sb3-guide.md) | `ddjSb3.ts` | no |

## Conventions

- MIDI channels are 1-based here (as in manufacturer lists); code is 0-based.
- "SHIFT+X" means the device's own shift layer: shifted controls send
  distinct messages, so a shifted function is just another binding.
- Detection: the MIDI port name contains the mapping's match string; the
  first match wins.
- Absolute controls (faders, knobs) use soft takeover: a mismatched control
  does nothing until it reaches the app's value.
- **Layered controls**: on devices whose DECK buttons switch a side between
  two Decks, the physical controls that move with the layer re-arm soft
  takeover for both Decks of the pair on every switch (rekordbox-style
  pickup) — no jump when returning to a Deck whose value changed, or when
  the control moved while the other Deck was active.
- Repurposing: a control may drive any action whose gesture shape and scope
  match, regardless of its printed label (CONTEXT.md, Mapping).

## Adding a mapping

1. Capture wire facts in `docs/research/<device>-hardware.md` (official
   MIDI list first; `/midi-inspect` to learn or confirm).
2. Write `frontend/src/midi/mappings/<device>.ts` + test; register it in
   `MidiControllerBridge.tsx`.
3. Add a page here and a row to the table.
