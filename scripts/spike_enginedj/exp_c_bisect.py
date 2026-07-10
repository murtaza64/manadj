"""Experiment C: bisect WHICH row content makes Engine accept a track.

Engine write-path spike (library-sync-button/08). Exp A (minimal
metadata-only row) renders blank; exp B (wholesale clone incl. blobs)
renders fine. This inserts 7 variants of the known-good row, each with
one aspect removed, so one Engine launch pinpoints the gate:

  cA  clone, PerformanceData blobs all NULL
  cB  clone, ONLY trackData blob (beatData/quickCues/loops/overview NULL)
  cC  clone, all blobs EXCEPT trackData
  cD  clone, isAnalyzed=False (all blobs present)
  cE  clone, albumArtId + albumArt string NULL
  cF  clone, bpm + bpmAnalyzed + key NULL
  cG  exp-A minimal metadata row + full blobs copied from the source

Usage: uv run scripts/spike_enginedj/exp_c_bisect.py <source-track-id>

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

BLOBS = ["trackData", "overviewWaveFormData", "beatData", "quickCues", "loops"]

# variant -> (track column overrides, blob columns to keep)
MINIMAL_TRACK_NULLS = [
    "playOrder", "bpm", "bpmAnalyzed", "key", "genre", "comment", "year",
    "albumArtId", "albumArt", "label", "composer", "remixer",
]
VARIANTS: dict[str, tuple[dict, list[str]]] = {
    "cA": ({}, []),
    "cB": ({}, ["trackData"]),
    "cC": ({}, [b for b in BLOBS if b != "trackData"]),
    "cD": ({"isAnalyzed": False}, BLOBS),
    "cE": ({"albumArtId": None, "albumArt": None}, BLOBS),
    "cF": ({"bpm": None, "bpmAnalyzed": None, "key": None}, BLOBS),
    "cG": ({k: None for k in MINIMAL_TRACK_NULLS} | {"isAnalyzed": False}, BLOBS),
}


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
        src_blobs = {b: getattr(src_pd, b) for b in BLOBS}

    src_audio = (LIBRARY / Path(src_cols["path"])).resolve()
    if not src_audio.is_file():
        sys.exit(f"source audio not found: {src_audio}")

    for name, (overrides, keep_blobs) in VARIANTS.items():
        clone_audio = src_audio.with_name(f"zz-spike-{name}{src_audio.suffix}")
        shutil.copy2(src_audio, clone_audio)

        cols = dict(src_cols)
        cols["path"] = str(Path(cols["path"]).with_name(clone_audio.name))
        cols["filename"] = clone_audio.name
        cols["title"] = f"SPIKE {name}"
        cols["originDatabaseUuid"] = None
        cols["originTrackId"] = None
        cols.update(overrides)

        blob_updates = {b: (src_blobs[b] if b in keep_blobs else None) for b in BLOBS}

        with db.session_m_write() as s:
            row = Track(**cols)
            s.add(row)
            s.flush()
            rid = row.id
            s.execute(
                text(
                    "UPDATE PerformanceData SET "
                    + ", ".join(f"{b} = :{b}" for b in BLOBS)
                    + " WHERE trackId = :tid"
                ),
                {**blob_updates, "tid": rid},
            )
        kept = ",".join(keep_blobs) or "none"
        ov = ",".join(overrides) or "-"
        print(f"{name}: id={rid} blobs=[{kept}] overrides=[{ov}]")


if __name__ == "__main__":
    main()
