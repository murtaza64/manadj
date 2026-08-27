"""Backfill script GC behavior (#196). The split loop reuses the pipeline
and currency check tested elsewhere; here we pin the GC's blast radius."""

from pathlib import Path

import pytest

from backend.config import StemsConfig
from scripts.backfill_stems import gc_orphaned_stems


@pytest.fixture
def stems_root(tmp_path: Path, monkeypatch) -> Path:
    from backend import config as config_module

    config = config_module.get_config()
    root = tmp_path / "stems"
    monkeypatch.setattr(config, "stems", StemsConfig(directory=str(root)))
    return root


def _mk(root: Path, name: str) -> Path:
    d = root / name
    d.mkdir(parents=True)
    (d / "meta.json").write_text("{}")
    return d


def test_gc_removes_only_orphaned_numeric_dirs(stems_root: Path) -> None:
    keep_active = _mk(stems_root, "7")
    orphan = _mk(stems_root, "8")
    not_a_track = _mk(stems_root, "scratch")
    removed = gc_orphaned_stems(active_ids={7}, dry_run=False)
    assert [p.name for p in removed] == ["8"]
    assert keep_active.exists()
    assert not orphan.exists()
    assert not_a_track.exists()


def test_gc_dry_run_removes_nothing(stems_root: Path) -> None:
    orphan = _mk(stems_root, "9")
    removed = gc_orphaned_stems(active_ids=set(), dry_run=True)
    assert [p.name for p in removed] == ["9"]
    assert orphan.exists()


def test_gc_no_root_is_noop(stems_root: Path) -> None:
    assert gc_orphaned_stems(active_ids=set(), dry_run=False) == []


def test_playlist_track_ids_matches_and_errors(db, make_track) -> None:
    from backend.models import Playlist, PlaylistTrack
    from scripts.backfill_stems import playlist_track_ids

    tracks = [make_track() for _ in range(3)]
    playlist = Playlist(name="Relentless Groove")
    db.add(playlist)
    db.commit()
    for i, t in enumerate(tracks[:2]):
        db.add(PlaylistTrack(playlist_id=playlist.id, track_id=t.id, position=i))
    db.commit()

    assert playlist_track_ids(db, "relentless groove") == {tracks[0].id, tracks[1].id}
    assert playlist_track_ids(db, "relentless") == {tracks[0].id, tracks[1].id}  # substring
    with pytest.raises(SystemExit, match="Relentless Groove"):
        playlist_track_ids(db, "no such list")
