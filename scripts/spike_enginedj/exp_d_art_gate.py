"""Experiment D: which album-art column gates row rendering, and the
minimal insert recipe.

Engine write-path spike (library-sync-button/08). Exp C: the ONLY
single-removal that blanks a row is albumArtId+albumArt. Split it:

  dH  full clone, albumArtId=NULL, albumArt string kept
  dI  full clone, albumArtId kept, albumArt string NULL
  dJ  MINIMAL metadata row (exp-A shape: no blobs, isAnalyzed=False,
      no bpm/key/genre/year) + a fresh empty AlbumArt row + both art
      columns set  -> the candidate export recipe floor

If dJ renders, the recipe for un-analyzed exports is: Track metadata +
art linkage, nothing else. (Then: analyze dJ inside Engine to verify the
full lifecycle on a directly-inserted row.)

Usage: uv run scripts/spike_enginedj/exp_d_art_gate.py <source-track-id>
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
MINIMAL_NULLS = [
    "playOrder", "bpm", "bpmAnalyzed", "key", "genre", "comment", "year",
    "label", "composer", "remixer",
]


def require_safe() -> None:
    if not MARKER.exists():
        sys.exit("refusing: live Engine Library is not marked as a test library")
    if subprocess.run(
        ["pgrep", "-f", r"Engine DJ\.app/Contents/MacOS/Engine DJ"],
        capture_output=True,
    ).returncode == 0:
        sys.exit("refusing: Engine DJ is running")


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src_id = int(sys.argv[1])
    require_safe()

    db = EngineDJDatabase(LIBRARY / "Database2")
    with db.session_m() as s:
        src = s.get(Track, src_id)
        src_cols = {
            c.name: getattr(src, c.name)
            for c in Track.__table__.columns
            if c.name != "id"
        }
        src_pd = s.get(PerformanceData, src_id)
        src_blobs = {b: getattr(src_pd, b) for b in BLOBS}

    src_audio = (LIBRARY / Path(src_cols["path"])).resolve()

    def insert(name: str, overrides: dict, blobs: dict | None,
               make_empty_art: bool = False) -> None:
        clone_audio = src_audio.with_name(f"zz-spike-{name}{src_audio.suffix}")
        shutil.copy2(src_audio, clone_audio)
        cols = dict(src_cols)
        cols["path"] = str(Path(cols["path"]).with_name(clone_audio.name))
        cols["filename"] = clone_audio.name
        cols["title"] = f"SPIKE {name}"
        cols["originDatabaseUuid"] = None
        cols["originTrackId"] = None
        cols.update(overrides)
        with db.session_m_write() as s:
            if make_empty_art:
                res = s.execute(
                    text("INSERT INTO AlbumArt (hash, albumArt) VALUES ('', NULL)")
                )
                cols["albumArtId"] = res.lastrowid
            row = Track(**cols)
            s.add(row)
            s.flush()
            rid = row.id
            if blobs is not None:
                s.execute(
                    text(
                        "UPDATE PerformanceData SET "
                        + ", ".join(f"{b} = :{b}" for b in BLOBS)
                        + " WHERE trackId = :tid"
                    ),
                    {**{b: blobs.get(b) for b in BLOBS}, "tid": rid},
                )
        print(f"{name}: id={rid} albumArtId={cols.get('albumArtId')} "
              f"albumArt={cols.get('albumArt')!r}")

    insert("dH", {"albumArtId": None}, src_blobs)
    insert("dI", {"albumArt": None}, src_blobs)
    insert(
        "dJ",
        {k: None for k in MINIMAL_NULLS}
        | {"isAnalyzed": False, "albumArt": "image://planck/0"},
        {b: None for b in BLOBS},
        make_empty_art=True,
    )


if __name__ == "__main__":
    main()
