# Engine DJ write path (spike findings)

Spike: `library-sync-button/08` (2026-07-10, Engine DJ desktop, schema
3.0.1 / user_version 4194305, macOS). Method: blank-library swap
(`enginelib.sh` slots), user adds tracks in Engine UI, before/after JSON
dumps (`enginestate.py`), then direct-write experiments verified in the
Engine UI. Sibling of `docs/research/rekordbox-performance-write.md`.

## Verdict

**Both gaps feasible.**

1. **Direct track ingestion into m.db works.** The historic blocker
   (pre-ADR-0006 attempt: rows render blank/unplayable) is a single
   NULL: **`Track.albumArtId` must reference an AlbumArt row** — an
   empty one (`hash=''`, `albumArt=NULL`) suffices. Everything else in
   the deleted implementation was presumably fine. ADR 0006's RBXML
   detour is obsolete for track export.
2. **In-place perf-blob writes to existing tracks work.** Hot cue add +
   beatgrid rewrite via read-modify-write of `quickCues`/`beatData`,
   verified in the Engine UI (originals preserved, playback fine).
   Byte-exact codecs for all five blob columns, round-trip-proven over
   994 real-library tracks.

## The rendering gate (exp A–D bisection)

A metadata-only Track row with `albumArtId=NULL` renders as a blank,
unplayable row (title/artist/length all empty in UI despite being set in
the DB). Bisection over 12 insert variants:

- blobs all-NULL: renders (no minimap/preview; main waveform computed on
  deck load)
- `isAnalyzed=False`: renders; Engine **auto-analyzes on load/add**
- `bpm`/`bpmAnalyzed`/`key` NULL: renders
- `albumArt` URI string NULL: renders
- **`albumArtId` NULL: blank — the only failing single removal**

## Write recipes (verified)

### Track insert (minimal)

1. `INSERT INTO AlbumArt (hash, albumArt) VALUES ('', NULL)` (or reuse a
   dedup-matched row; Engine dedups by content hash)
2. Insert Track: `path` (POSIX, **relative to the Engine Library dir**,
   e.g. `../Tracks/x.mp3`), `filename`, `fileType`, `fileBytes`,
   `length` (int seconds), `bitrate`, tag metadata as available,
   `albumArtId` from step 1, `rating=0`, booleans false except
   `isAvailable`/`isMetadataImported`, `dateCreated` (file mtime),
   `dateAdded`/`lastEditTime` (now), `streamingFlags=0`, `pdbImportKey=0`.
   Leave `originDatabaseUuid`/`originTrackId` NULL.
3. Schema triggers do the rest: `fix_origin` stamps self-referential
   origin (leave NULL — copying another row's origin violates the
   uniqueness constraint), `insert_performance_data` creates the
   PerformanceData row, `check_id` forbids id recycling (never reuse
   ids). Timestamp triggers maintain `lastEditTime` on later updates.
4. With `isAnalyzed=False`, Engine analyzes the track itself on
   add/load: grid, BPM, key, waveforms, trackData all appear (exp dJ).

### Track insert carrying manadj's own performance data

As above plus: write `beatData`, `quickCues`, `trackData`, `loops` (see
formats) and set **`isAnalyzed=True`** — `False` triggers re-analysis
which **rewrites beatData/quickCues/trackData** (exp cD; the Engine
sibling of RB's re-analysis clobber). Gap: `overviewWaveFormData` format
is unknown (Mixxx wiki TODO); without it the track has no minimap/preview
strip and Engine does NOT backfill it for `isAnalyzed=True` rows (exp
cA). Options: reverse the overview format (~3KB blob, ~15B/s — tractable
sibling task) or accept missing minimaps.

Partial blob sets produce zombie states (exp cA/cB: deck load lazily
writes trackData + an empty quickCues; a blobless "analyzed" row got a
default 120 BPM grid). **Write complete sets or nothing.**

### Perf update on an existing track (the sync-export operation)

Read blob → parse → mutate → encode → `UPDATE PerformanceData ... WHERE
trackId=?` (Engine closed). Preservation contract held byte-exact for
everything untouched. `trigger_PerformanceData_after_update_Track_timestamp`
bumps `Track.lastEditTime` — sync's Engine-side change detection keeps
working after our own writes.

## Blob format corrections (vs the Mixxx wiki)

Wiki (old Engine Prime 1.6 schema) is accurate except:

- **beatData carries a 9-byte tail** after the two grids: 1 flag byte
  (`00` or `03` in the wild, once `00` + f64 −1600.0) + 8 bytes. Opaque;
  preserve verbatim on rewrite, write `00`*9 for fresh grids.
- **trackData has a 68-byte variant** (44B + 3 extra f64s, newer
  analyzer): sr f64 BE, length u64 BE, key u32 BE, then 3 or 6 f64 BE
  loudness values.
- Beatgrid marker's unknown u32: values 0/1/7–12/24576 + occasional
  garbage (uninitialized?); treat opaque, preserve on rewrite, 0 fresh.
- `loops` is raw little-endian (u64 count + per-loop label/start/end/
  set-flags/ARGB), not qCompress-framed — wiki right, our decoder's
  assumption wasn't.
- Compression: qCompress = u32 BE uncompressed-length + zlib. Engine
  accepts any valid zlib stream (byte-exactness only needed on payload).

Codecs + corpus harness: `scripts/spike_enginedj/blob_encode.py`
(`encode(parse(x)) == x` for beatData/quickCues/trackData/loops over
994 tracks + test library).

## Engine behaviors that shape sync design

- **Auto-analysis on add** (preference-dependent): inserted tracks get
  analyzed and completed by Engine itself. For metadata-only export
  that's a feature; for perf-carrying export it's the clobber vector —
  suppressed by `isAnalyzed=True`.
- Engine re-analysis is **deterministic** (identical grid offsets on
  same audio) — useful for clobber fingerprinting.
- Engine keeps `default` and `adjusted` grids; user edits live in
  `adjusted`. Export should write both (adjusted = manadj's grid).
- Sibling DBs (`sm/stm/trm/itm/rbm.db`) are per-streaming-source
  mirrors, empty schema clones; not involved in local-track rendering.
- Whether Engine re-analysis preserves user hot cues (as RB's does) is
  untested (our re-analyzed row had no cues) — moot under the
  `isAnalyzed=True` recipe.

## Writes while Engine is running (exp F)

Deliberate guard-skip test: cue write to a track LOADED AND PLAYING on a
deck + fresh minimal insert, Engine open.

- Both writes succeeded instantly — no SQLITE_BUSY, no exclusive locks
  (rollback-journal mode, short transactions).
- Engine picked both up live: the new cue on track **reload**, the new
  track on **view switch**. No restart needed.
- Both writes **survived Engine's quit** — no shutdown cache-flush
  clobber. No corruption anywhere.
- Untested race: user editing the same track's cues in Engine
  concurrently (last-writer-wins, no merge; Engine's cached copy could
  flush over ours on *edit*, not on quit). One session, additive ops
  only — keep the Engine-closed guard for sync writes; live mode is
  plausible for additive pushes pending a race spike.

## Safety protocol

- `scripts/spike_enginedj/enginelib.sh`: slot manager (real/test swap,
  `.manadj-test-library` marker, refuse-if-Engine-running, APFS-clone
  snapshots). Real library is Syncthing-synced — pause the folder before
  swapping; `mark-test` refuses dirs containing `.stfolder`.
- Every write tool refuses without the test marker; Engine-closed check
  matches the app binary path (crashpad_handler processes linger and
  must not count).
- All writes verified in the Engine UI and re-diffed after Engine
  sessions (`enginestate.py` dump → diff).

## Artifacts

- `scripts/spike_enginedj/`: `enginelib.sh`, `enginestate.py`,
  `blob_encode.py`, `exp_a_insert_track.py` (minimal insert),
  `exp_b_clone_track.py` (wholesale clone), `exp_c_bisect.py` (7-variant
  bisection), `exp_d_art_gate.py` (art-column split + minimal recipe),
  `exp_e_cue_write.py` (in-place cue/grid write), `exp_f_live_write.py`
  (writes while Engine runs)
- Test library preserved in `~/Music/Engine Library-slots/test`;
  pre-spike snapshot in `~/Music/Engine Library-snapshots/`

## Pending

- `overviewWaveFormData` format (blocks minimaps on perf-carrying
  inserts; does not block cue/grid export to existing tracks)
- Cue survival through Engine re-analysis (moot under recipe)
- Concurrent-edit race for writes while Engine runs (exp F caveat)
- Device/USB behavior (Engine hardware sync of a directly-written
  library) — same shape as the RB USB probe
  (`performance-data-sync/10`)
