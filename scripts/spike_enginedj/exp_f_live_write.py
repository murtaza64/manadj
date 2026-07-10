"""Experiment F: write to m.db WHILE Engine DJ is running.

Engine write-path spike (library-sync-button/08). Deliberately skips the
Engine-closed guard (test-library marker still required) to learn the
failure mode the guard prevents:

  1. in-place cue write: hot cue slot 0 "live-write" (orange) @30.0s on
     the given track id
  2. fresh minimal track insert (recipe from exp D) of the given audio
     file

Observations to collect: SQLITE_BUSY/locked errors? Does the Engine UI
pick changes up live? After Engine quits, did our writes survive or get
overwritten by Engine's in-memory state?

Usage:
  uv run scripts/spike_enginedj/exp_f_live_write.py <track-id> <audio-file>
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

import mutagen  # noqa: E402
from sqlalchemy import text  # noqa: E402

from enginedj.connection import EngineDJDatabase  # noqa: E402
from enginedj.models import PerformanceData, Track  # noqa: E402
from enginedj.performance_blobs import q_uncompress  # noqa: E402

sys.path.insert(0, str(Path(__file__).parent))
from blob_encode import (  # noqa: E402
    encode_quick_cues_full,
    parse_quick_cues_full,
    q_compress,
)

LIBRARY = Path.home() / "Music" / "Engine Library"
MARKER = LIBRARY / ".manadj-test-library"


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    tid, audio = int(sys.argv[1]), Path(sys.argv[2]).resolve()
    if not MARKER.exists():
        sys.exit("refusing: live Engine Library is not marked as a test library")
    # NO Engine-closed check — that is the experiment.

    db = EngineDJDatabase(LIBRARY / "Database2")

    # 1. in-place cue write
    try:
        with db.session_m() as s:
            pd = s.get(PerformanceData, tid)
            qc = parse_quick_cues_full(q_uncompress(pd.quickCues))
        sr_guess = 44100.0
        qc["slots"][0] = {
            "label": "live-write",
            "position": 30.0 * sr_guess,
            "argb": "ffea8f32",
        }
        t0 = time.time()
        with db.session_m_write() as s:
            s.execute(
                text("UPDATE PerformanceData SET quickCues = :qc WHERE trackId = :tid"),
                {"qc": q_compress(encode_quick_cues_full(qc)), "tid": tid},
            )
        print(f"1. cue write on track {tid}: OK ({time.time()-t0:.2f}s)")
    except Exception as e:
        print(f"1. cue write on track {tid}: FAILED — {e!r}")

    # 2. minimal insert
    try:
        mf = mutagen.File(audio, easy=True)
        tag = lambda k: (mf.get(k) or [None])[0]  # noqa: E731
        now = int(time.time())
        t0 = time.time()
        with db.session_m_write() as s:
            res = s.execute(
                text("INSERT INTO AlbumArt (hash, albumArt) VALUES ('', NULL)")
            )
            row = Track(
                path="../" + str(audio.relative_to(Path.home() / "Music")),
                filename=audio.name,
                fileType=audio.suffix.lstrip(".").lower(),
                fileBytes=audio.stat().st_size,
                length=int(mf.info.length),
                bitrate=int(getattr(mf.info, "bitrate", 0) / 1000) or None,
                title="LIVE INSERT " + (tag("title") or audio.stem),
                artist=tag("artist"),
                albumArtId=res.lastrowid,
                albumArt="image://planck/0",
                rating=0,
                isAnalyzed=False,
                isPlayed=False,
                isAvailable=True,
                isMetadataImported=True,
                isMetadataOfPackedTrackChanged=False,
                isPerfomanceDataOfPackedTrackChanged=False,
                isBeatGridLocked=False,
                explicitLyrics=False,
                dateCreated=int(audio.stat().st_mtime),
                dateAdded=now,
                lastEditTime=now,
                streamingFlags=0,
                pdbImportKey=0,
            )
            s.add(row)
            s.flush()
            rid = row.id
        print(f"2. live insert: OK id={rid} ({time.time()-t0:.2f}s)")
    except Exception as e:
        print(f"2. live insert: FAILED — {e!r}")


if __name__ == "__main__":
    main()
