"""Experiment A: minimal direct Track insert into Engine's m.db.

Engine write-path spike (library-sync-button/08). Question: does a
metadata-only Track row (no analysis, no blobs, no album art) inserted
directly into m.db become a first-class citizen in Engine DJ — visible,
playable, analyzable — without corrupting anything?

Schema triggers do the scary parts (verified against schema 3.0.1):
  - trigger_after_insert_Track_fix_origin: stamps originDatabaseUuid/
    originTrackId when left NULL
  - trigger_after_insert_Track_insert_performance_data: creates the
    PerformanceData row
  - trigger_after_insert_Track_check_id: forbids id recycling

Usage: uv run scripts/spike_enginedj/exp_a_insert_track.py <audio-file>

SAFETY: refuses unless the live Engine Library carries the
.manadj-test-library marker and Engine DJ is closed.
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

import mutagen  # noqa: E402

from enginedj.connection import EngineDJDatabase  # noqa: E402
from enginedj.models import Track  # noqa: E402

LIBRARY = Path.home() / "Music" / "Engine Library"
MARKER = LIBRARY / ".manadj-test-library"


def require_safe() -> None:
    if not MARKER.exists():
        sys.exit("refusing: live Engine Library is not marked as a test library")
    probe = subprocess.run(
        ["pgrep", "-f", r"Engine DJ\.app/Contents/MacOS/Engine DJ"],
        capture_output=True,
    )
    if probe.returncode == 0:
        sys.exit("refusing: Engine DJ is running")


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    audio = Path(sys.argv[1]).resolve()
    if not audio.is_file():
        sys.exit(f"no such file: {audio}")
    require_safe()

    mf = mutagen.File(audio, easy=True)
    if mf is None:
        sys.exit("mutagen could not parse the file")
    tag = lambda k: (mf.get(k) or [None])[0]  # noqa: E731

    now = int(time.time())
    rel_path = "../" + str(audio.relative_to(Path.home() / "Music"))
    track = Track(
        path=rel_path,
        filename=audio.name,
        fileType=audio.suffix.lstrip(".").lower(),
        fileBytes=audio.stat().st_size,
        length=int(mf.info.length),
        bitrate=int(getattr(mf.info, "bitrate", 0) / 1000) or None,
        title=tag("title") or audio.stem,
        artist=tag("artist"),
        album=tag("album"),
        genre=tag("genre"),
        # deliberately absent: bpm, bpmAnalyzed, key, albumArtId, comment
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
        # originDatabaseUuid/originTrackId left NULL -> fix_origin trigger
    )

    db = EngineDJDatabase(LIBRARY / "Database2")
    with db.session_m_write() as s:
        s.add(track)
        s.flush()
        track_id = track.id
    # re-read outside the write session to see trigger effects
    with db.session_m() as s:
        t = s.get(Track, track_id)
        print(f"inserted Track id={t.id}")
        print(f"  origin: uuid={t.originDatabaseUuid} trackId={t.originTrackId}")
        pd_present = (
            s.execute(
                __import__("sqlalchemy").text(
                    "SELECT count(*) FROM PerformanceData WHERE trackId = :i"
                ),
                {"i": track_id},
            ).scalar()
        )
        print(f"  PerformanceData row auto-created: {bool(pd_present)}")


if __name__ == "__main__":
    main()
