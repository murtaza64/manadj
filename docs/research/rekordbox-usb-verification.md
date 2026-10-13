# USB Export Verification

2026-09-16. Issue #265, continuing #94. Rekordbox 7.2.14 on macOS;
250 GB SANDISK USB, FAT32. Classic Device Library, not OneLibrary.

## Results

- Direct export of `dnb set 7`: 74 tracks, 222 DAT/EXT/2EX files, 290 hot cues.
- Unmounted/remounted the physical stick, reopened Rekordbox, declined OneLibrary conversion.
- Browsed the classic device playlist with all 74 tracks in source order.
- Loaded and played `Head 2 Toe` (MP3) and `Carry The Fire` (M4A/AAC).
- Both players showed 174.00 BPM and grids; playback timers advanced.
- AAC hot cue C recalled 44.161 seconds, with label and color intact.
- `Limitless (Arcando Extended Remix)` loaded at 169.95 BPM; hot cues B and E
  selected the 134.18 and 170.00 BPM segments respectively.
- Main cues and hot-cue memory mirrors matched the sandbox DB on read-back.
- All 74 audio SHA-256 hashes matched source files. All 222 analysis files
  remained byte-identical to staged output after Rekordbox inspection.
- 94 focused tests passed, including golden-corpus round trips and desktop
  grid/cue/offset regressions. Ruff passed; one Alembic head.

Evidence stays local under `data/usb-verification/`: `source-check.json`,
`final-mp3.png`, `final-aac.png`, `final-hotcue.png`, and
`final-variable-{slow,fast}.png`. Browser evidence: `final-browser-previews.png`
and `final-previews-last.png`. Earlier device trees were preserved there.

## Failure Mechanisms

1. **Corrupt device library:** zero-filled PDB index bodies. Replacing only
   their bodies with native free-space headers and sentinel arrays made the
   existing stick readable. Each table also now reserves its own empty page;
   data-page free-space accounting includes every row group.
2. **Audio loads without analysis:** malformed DAT content. A native DAT
   restored analysis with our PDB unchanged. Generated DATs then worked after
   correcting PCOB order (hot, memory), last-memory-index sentinels, and cue
   constants. PVBR was also four bytes short. Fixing PVBR alone, adding an
   analysis date, and adding a native EXT had not restored grids.
3. **Duplicate beat timestamps:** near-identical segment-boundary beats rounded
   to one millisecond. The new segment now owns that timestamp.

The old row-reading oracle ignored index bodies and accepted invalid cue
constants. Tests now check those invariants and parse bounded ANLZ sections
with a second parser. Read-back rejects cycles, incomplete analysis, missing
audio, and non-increasing grids.

Waveforms derive from manadj's peak/spectral data, generating PWAV/PWV2,
PWV3/PWV4/PWV5, and PWV6/PWV7. They are not copies of Rekordbox's analysis algorithm.
Hot-cue colors use ANLZ palette codes, distinct from desktop DB color indices.

## Reproduce

From the USB-export working copy, with its sandbox DB:

```sh
uv run -m rekordbox.device.export_cli --playlist "dnb set 7" --dest /path/to/fresh-export --verify
uv run -m rekordbox.device.verify "/Volumes/SANDISK USB"
uv run -m scripts.debug.usb_source_check --dest "/Volumes/SANDISK USB" --staged data/usb-verification/final --playlist "dnb set 7"
```

The export destination may be a fresh FAT32 mount. Quit Rekordbox before
writing it. This rebuilds classic library files; it does not reconcile an
existing OneLibrary or prune old audio. Source audio inside the destination
and output symlinks escaping it are rejected. Tracks use separate ID directories
to avoid FAT32 filename collisions.

`scripts/debug/rekordbox_ui.py` provides macOS accessibility checks, screenshots,
and a brief `playcheck` that leaves playback paused. It requires an unlocked
desktop and accessibility/screen-recording permission. `expect 174.00` is a
loaded-player assertion; absence of a corruption dialog alone is not success.

## Browser Preview Follow-Up

The initial walkthrough checked the deck waveform but missed the blank browser
Preview column. In the active 3Band display mode, the browser requires the `.2EX`
three-band preview (`PWV6`); it does not fall back to DAT/EXT waveforms.

- Adding only a native, path-corrected `.2EX` for `Head 2 Toe` enabled that row's
  preview while all other rows remained blank. Pixel check: 0/373 -> 326/373
  columns with waveform contrast in the same browser cell.
- Changing only the PDB analysis-update counter or PWV4 header did not fix it.
- The exporter now generates 1200-column PWV6 and 150 Hz PWV7 in `.2EX`, using
  mid/high/low channel order. No borrowed native analysis or PWVC tag is needed
  for the verified browser behavior. PWV4's separate header word is now zero,
  matching native exports rather than inheriting the detail-waveform rate.
- After rebuilding and remounting, previews rendered before deck loading for
  the visible first, middle and final playlist pages, including the reported
  `Till Death We Do Art` row. All 222 analysis files matched staged output afterward.
- Reloaded that track in PERFORMANCE mode: its deck overview also uses the
  three-band waveform rather than the earlier monochrome fallback.
- Regression coverage checks presence, dimensions, channel order, silence and
  offset padding. Read-back now rejects missing `.2EX` files and malformed
  preview dimensions.

## Remaining Gates

- CDJ/XDJ playback and per-codec decode offsets still require standalone hardware.
- No OneLibrary writer, incremental sync, device UI,
  or foreign-device import in this change.
- Main cue is exported as a memory point; automatic load-to-main-cue behavior
  on standalone players remains unverified.
- Feature work remains parked pending review, including the earlier writer changes.

## References

- [DeviceSQL index pages](https://djl-analysis.deepsymmetry.org/rekordbox-export-analysis/exports.html#_index_pages)
- [ANLZ sections](https://djl-analysis.deepsymmetry.org/rekordbox-export-analysis/anlz.html)
- [rekordcrate PDB implementation](https://github.com/Holzhaus/rekordcrate/blob/a93b99f42d919481378feb32b3ab7599646bb6e3/src/pdb/mod.rs)
- [ANLZ hot-cue palette](https://github.com/Deep-Symmetry/beat-link/blob/3c41b3deb50bb5b347fbfe52aa7c9ae35c7637d3/src/main/java/org/deepsymmetry/beatlink/data/CueList.java)
