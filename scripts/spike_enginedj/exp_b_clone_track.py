"""Experiment B: clone a working Engine-imported Track row wholesale.

Engine write-path spike (library-sync-button/08). Experiment A's minimal
metadata-only insert renders blank/unplayable in Engine (same blocker as
the pre-ADR-0006 attempt). Bisection: insert a row that is a column-for-
column copy of a KNOWN-GOOD Engine-imported row (different id, different
path -> a file copy), including its PerformanceData blobs and shared
AlbumArt. If the clone renders fine, the blocker is row CONTENT (bisect
columns next). If it's also blank, the blocker is outside m.db.

Usage: uv run scripts/spike_enginedj/exp_b_clone_track.py <source-track-id>

SAFETY: refuses without the .manadj-test-library marker / Engine running.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from sqlalchemy import text  # noqa: E402

from enginedj.connection import EngineDJDatabase  # noqa: E402
from enginedj.models import PerformanceData, Track  # noqa: E402

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
    src_id = int(sys.argv[1])
    require_safe()

    db = EngineDJDatabase(LIBRARY / "Database2")
    with db.session_m() as s:
        src = s.get(Track, src_id)
        if src is None:
            sys.exit(f"no track id={src_id}")
        src_cols = {
            c.name: getattr(src, c.name)
            for c in Track.__table__.columns
            if c.name != "id"
        }
        src_pd = s.get(PerformanceData, src_id)
        pd_cols = {
            c.name: getattr(src_pd, c.name)
            for c in PerformanceData.__table__.columns
            if c.name != "trackId"
        }

    # copy the audio file so the clone has its own real, openable file
    src_audio = (LIBRARY / Path(src_cols["path"])).resolve()
    if not src_audio.is_file():
        sys.exit(f"source audio not found: {src_audio}")
    clone_audio = src_audio.with_name("zz-spike-clone" + src_audio.suffix)
    shutil.copy2(src_audio, clone_audio)

    src_cols["path"] = str(Path(src_cols["path"]).with_name(clone_audio.name))
    src_cols["filename"] = clone_audio.name
    src_cols["title"] = "SPIKE CLONE " + (src_cols["title"] or "")
    # leave origin to the fix_origin trigger (copying would violate the
    # (originDatabaseUuid, originTrackId) unique constraint)
    src_cols["originDatabaseUuid"] = None
    src_cols["originTrackId"] = None

    with db.session_m_write() as s:
        clone = Track(**src_cols)
        s.add(clone)
        s.flush()
        clone_id = clone.id
        # fill the trigger-created PerformanceData row with the source blobs
        s.execute(
            text(
                "UPDATE PerformanceData SET "
                + ", ".join(f"{k} = :{k}" for k in pd_cols)
                + " WHERE trackId = :tid"
            ),
            {**pd_cols, "tid": clone_id},
        )

    with db.session_m() as s:
        t = s.get(Track, clone_id)
        pd = s.get(PerformanceData, clone_id)
        print(f"cloned track {src_id} -> id={clone_id}")
        print(f"  path={t.path}")
        print(f"  origin: uuid={t.originDatabaseUuid} trackId={t.originTrackId}")
        print(f"  blobs: beatData={pd.beatData is not None} "
              f"quickCues={pd.quickCues is not None} "
              f"trackData={pd.trackData is not None} "
              f"overview={pd.overviewWaveFormData is not None} "
              f"loops={pd.loops is not None}")


if __name__ == "__main__":
    main()
