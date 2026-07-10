# Rekordbox performance-data write (spike findings)

Issue: `performance-data-sync/09`. Environment: Rekordbox 7 (v6-format
library), macOS, no cloud sync, pyrekordbox 0.4.4. Method: minimal test
library swapped in via `scripts/spike_rekordbox/rblib.sh`; every write
verified in the RB UI and re-diffed after RB sessions.

## Verdict

Headless in-place export of hot cues, memory cues, key, and beatgrids to
an existing RB7 library is **feasible**. Cues + key are plain DB rows;
grids are one hand-built ANLZ tag. RB adopts out-of-band rows without
rejection, healing, or corruption.

## Where performance data lives

| Data | Store | Notes |
|---|---|---|
| Hot cues, memory cues | `djmdCue` only | local ANLZ `PCOB`/`PCO2` stay EMPTY even for RB-authored cues; no `djmdSongHotCueBanklist` involvement |
| Key | `DjmdContent.KeyID` → `djmdKey` | lookup by `ScaleName` |
| Beatgrid | ANLZ `.DAT` `PQTZ` only | not in DB; `DjmdContent.BPM` = scalar ×100; local `.EXT` has `PQT2` (staleness probe pending) |

## Write recipes (verified)

Cue row (RB7 shape): `Kind` 0=memory; hot cue pads A–H = Kinds
1,2,3,5,6,7,8,9 (self-labeling experiment — Kind 4 is a legacy type that
RENDERS AS A MEMORY CUE; never write or read it as hot). `InMsec`,
`InFrame=InMsec×150/1000`, `OutMsec=-1`, `Color=-1`, extras NULL,
`ContentUUID`=content.UUID, fresh row UUID, `rb_*`=0, `usn` NULL —
RB assigns `rb_local_usn` itself on next launch. Write via pyrekordbox
session + `db.commit()` (refuses while RB runs). Add/move/hard-delete all
verified in UI. Mirroring rule (issue 08): one manadj hotcue → hot cue
row + memory cue row.

Key: point `KeyID` at existing `djmdKey` row (verified); new rows carry
`Seq=None` (creation verified in DB, UI check pending).

Grid (`PQTZ`): entries `(beat u16 1-4, tempo u16 = BPM×100, time u32 ms)`,
24-byte header with `entry_count`. pyrekordbox can only mutate in place;
from-scratch authoring = rebuild `construct` containers and fix lengths
by hand (`tag.struct.len_tag = 24 + 8n`; `AnlzFile.update_len` no-ops on
tags, `build()` validates file length). Both verified in UI: mutated
grid (+200 ms shift) and authored variable grid (172→86 BPM, new entry
count — beat-jump follows it; stale `.EXT` `PQT2` leaks nowhere visible).

Deletes: `rb_local_deleted=1` (soft) verified — cue disappears from UI;
prefer over hard delete. New `djmdKey` rows: `Seq=None` (RB shape),
verified rendering. Colored/named cues (CORRECTED from earlier drafts):
RB7's shape is simply `Comment=<label>` + `Color=<palette index>` —
0 pink, 1 red, 2 orange, 3 yellow, 4 green, 5 aqua, 6 blue, 7 purple
(probe-verified). The old real-library shape (Color=255 +
ColorTableIndex, zeroed extras) is RB5/6-era and RB7 silently does not
render it. Canonical mapping code: `rekordbox/cue_mapping.py`.

RB's ad-hoc "CUE" point is not persisted anywhere track-addressable
(no DB row, no ANLZ/edb write). Memory cues are the only cue
persistence; a future Main-cue sync maps to a memory cue or nothing.

## Decode-frame offsets (exp F/G, definitive)

Same-content transcodes of one flac; RB analyzed each; offset = shift of
RB's own PQTZ grid vs the flac's (466 beats, 1 ms spread). ffmpeg frame
(manadj's: `ffmpeg -ac 1 -ar 44100 -f f32le`) by sample-accurate
cross-correlation.

| Class | export offset: RB_ms − manadj_ms |
|---|---:|
| flac / lossless | 0 |
| mp3, no Xing header | **−2** (≈0) |
| mp3, Xing, no LAME tag | **+23** |
| mp3, LAME tag (CRC irrelevant) | **+49** |
| m4a, no iTunSMPB (ffmpeg-encoded) | **+23** |
| m4a, iTunSMPB (CoreAudio/iTunes) | **+48** |

Export rule: `RB_ms = manadj_ms + offset(class)`. RB ignores LAME CRC
validity, collapsing mixxx-utils' C/D distinction. Classification code:
mixxx-utils `encoder_tools.py` pattern (Xing/LAME/CRC via eyed3;
iTunSMPB via mutagen). Library census: m4a 100% ffmpeg-class; mp3 26 no-
Xing / 116 Xing-only / 94 LAME.

WebAudio (exp H, Electron/Chromium `decodeAudioData` vs ffmpeg frame):
identical except no-Xing mp3s, which play **13.3 ms early** — manadj-
internal issue (waveform clicks vs playback-set cues disagree on 26
library files), independent of RB export.

## RB behaviors that shape sync design

- **Re-analysis clobbers exported grid AND key** (cues survive). Export
  is not one-shot; re-analysis is a recurring divergence source.
- RB never rewrites local ANLZ in normal use (byte-identical across
  sessions); the DB is authoritative for cues/key.
- RB assigns USNs to foreign rows on launch; no USN bookkeeping needed
  beyond pyrekordbox's `commit()`.
- Writes require RB closed (enforced by pyrekordbox).

## Pending

- Colored/named cue re-verify after NULL→0 normalization
- USB-export probe: do DB cues materialize into exported ANLZ for CDJs
- XML path (fallback): untested, deprioritized — headless works

## Artifacts

`scripts/spike_rekordbox/`: `rblib.sh` (library slots/snapshots),
`rbstate.py` (DB+ANLZ dump/diff), `exp_b_cues.py`, `exp_c_grid.py`,
`exp_i_author_grid.py` (writers), `exp_d/e/f/g` (offset measurement),
`exp_h_webaudio.js` (Electron frame probe). Test library preserved in
`~/Library/Pioneer/rekordbox-slots/`; snapshots in `rekordbox-snapshots/`.

## Post-implementation notes (2026-07-10)

The full export feature shipped as `rekordbox-perf-export` 01–05 (key,
mirrored hot+memory cues with labels/colors, authored beatgrids,
per-field confirm verbs, additive auto tier). Implementation-era
discoveries folded back here:

- Grid-extent trap: an authored grid's end must come from the track
  LENGTH, never from the current PQTZ's last tempo-change start (RB
  analysis wobble makes that a run boundary) — a truncated grid feeds
  its own truncation back.
- Lane-app uvicorn watches `backend/` only: changes under `rekordbox/`
  need an app restart before UI verification (cost us one false mapping
  conclusion).
- Rekordbox `Rating` is plain 0–5 stars in the DB; energy exports 1:1.

Still open: USB/CDJ export probe (do DB cues materialize into exported
ANLZ; stale local `PQT2`) — tracked in performance-data-sync/09.
