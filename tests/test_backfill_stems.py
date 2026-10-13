"""Backfill script GC behavior (#196). The split loop reuses the pipeline
and currency check tested elsewhere; here we pin the GC's blast radius."""

from datetime import UTC, datetime
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


@pytest.mark.parametrize("dry_run", [False, True])
def test_recent_backfill_skips_old_archived_current_and_gc(
    db, make_track, audio_file, stems_root, monkeypatch, capsys, dry_run,
):
    from scripts import backfill_stems

    old = make_track(
        filename=str(audio_file(name="old.mp3")), created_at=datetime(2026, 9, 7, tzinfo=UTC),
    )
    recent = make_track(
        filename=str(audio_file(name="recent.mp3")), created_at=datetime(2026, 9, 8, tzinfo=UTC),
    )
    current = make_track(
        filename=str(audio_file(name="current.mp3")), created_at=datetime(2026, 9, 9, tzinfo=UTC),
    )
    make_track(
        filename=str(audio_file(name="archived.mp3")),
        created_at=datetime(2026, 9, 9, tzinfo=UTC), archived_at=datetime(2026, 9, 10, tzinfo=UTC),
    )
    orphan = _mk(stems_root, "999")
    old_stems = _mk(stems_root, str(old.id))
    monkeypatch.setattr(backfill_stems, "SessionLocal", lambda: db)
    monkeypatch.setattr(backfill_stems, "is_current", lambda id, *args: id == current.id)
    split_ids = []

    def split(id, *args):
        split_ids.append(id)
        return _mk(stems_root, str(id))

    monkeypatch.setattr(backfill_stems, "split_track", split)
    monkeypatch.setattr(
        "sys.argv",
        ["backfill_stems", "--since", "2026-09-08", "--skip-gc"]
        + (["--dry-run"] if dry_run else []),
    )
    backfill_stems.main()
    assert split_ids == ([] if dry_run else [recent.id])
    assert "2 active tracks; 1 current, 1 to split" in capsys.readouterr().out
    assert orphan.exists()
    assert old_stems.exists()
