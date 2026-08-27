"""Stem-split tasks: handler, dedup, currency, and the backlog guard (#195).

Behavior tests at the task seam with a stubbed split (ADR-0002) — no demucs.
"""

from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from backend.config import StemsConfig
from backend.stems import STEMS_VERSION, StemsMeta, is_current, stems_dir
from backend.stems_tasks import (
    STEM_SPLIT_TASK_TYPE,
    enqueue_missing_stems,
    enqueue_stem_split,
    make_stem_split_handler,
)
from backend.tasks.manager import list_tasks, run_pending
from backend.tasks.models import Task


@pytest.fixture
def stems_config(tmp_path: Path, monkeypatch) -> StemsConfig:
    """Point the global stems config at a temp dir for the test."""
    from backend import config as config_module

    config = config_module.get_config()
    stems = StemsConfig(directory=str(tmp_path / "stems"))
    monkeypatch.setattr(config, "stems", stems)
    return stems


def write_current_meta(track_id: int, source: Path, config: StemsConfig) -> None:
    """Materialize a current-looking stems dir for a track."""
    st = source.stat()
    d = stems_dir(track_id, config)
    d.mkdir(parents=True, exist_ok=True)
    meta = StemsMeta(
        model=config.model,
        stems_version=STEMS_VERSION,
        codec="aac",
        bitrate="256k",
        sample_rate=44100,
        source_mtime_ns=st.st_mtime_ns,
        source_size=st.st_size,
    )
    (d / "meta.json").write_text(meta.to_json())


# --- currency check --------------------------------------------------------------


def test_currency_stale_on_each_axis(tmp_path: Path, stems_config: StemsConfig) -> None:
    source = tmp_path / "track.mp3"
    source.write_bytes(b"x" * 100)
    assert not is_current(1, source, stems_config)  # absent

    write_current_meta(1, source, stems_config)
    assert is_current(1, source, stems_config)

    # model knob change
    other_model = StemsConfig(directory=stems_config.directory, model="htdemucs_ft")
    assert not is_current(1, source, other_model)

    # source replacement (size change)
    source.write_bytes(b"y" * 101)
    assert not is_current(1, source, stems_config)

    # missing source reads stale
    write_current_meta(1, source, stems_config)
    source.unlink()
    assert not is_current(1, source, stems_config)


def test_currency_stale_on_version_bump(tmp_path: Path, stems_config: StemsConfig) -> None:
    source = tmp_path / "track.mp3"
    source.write_bytes(b"x" * 100)
    write_current_meta(1, source, stems_config)
    meta_path = stems_dir(1, stems_config) / "meta.json"
    meta_path.write_text(meta_path.read_text().replace(
        f'"stems_version": {STEMS_VERSION}', f'"stems_version": {STEMS_VERSION - 1}'
    ))
    assert not is_current(1, source, stems_config)


# --- enqueue + dedup --------------------------------------------------------------


def test_enqueue_dedup(db: Session, make_track) -> None:
    track = make_track()
    assert enqueue_stem_split(db, track.id) is not None
    assert enqueue_stem_split(db, track.id) is None  # pending twin -> no-op
    tasks = [t for t in list_tasks(db) if t.type == STEM_SPLIT_TASK_TYPE]
    assert len(tasks) == 1
    assert tasks[0].ref == f"track:{track.id}"


# --- handler ----------------------------------------------------------------------


def test_handler_splits_via_task_system(
    db: Session, make_track, tmp_path: Path, stems_config: StemsConfig
) -> None:
    source = tmp_path / "track.mp3"
    source.write_bytes(b"x" * 100)
    track = make_track(filename=str(source))
    calls: list[tuple[int, Path]] = []

    def fake_split(track_id: int, src: Path) -> None:
        calls.append((track_id, src))
        write_current_meta(track_id, src, stems_config)

    enqueue_stem_split(db, track.id)
    handlers = {STEM_SPLIT_TASK_TYPE: make_stem_split_handler(split=fake_split)}
    assert run_pending(db, handlers) == 1
    assert calls == [(track.id, source)]
    task = db.query(Task).filter(Task.type == STEM_SPLIT_TASK_TYPE).one()
    assert task.state == "done"
    assert is_current(track.id, source, stems_config)


def test_handler_skips_already_current(
    db: Session, make_track, tmp_path: Path, stems_config: StemsConfig
) -> None:
    source = tmp_path / "track.mp3"
    source.write_bytes(b"x" * 100)
    track = make_track(filename=str(source))
    write_current_meta(track.id, source, stems_config)
    calls: list[int] = []
    enqueue_stem_split(db, track.id)
    handlers = {
        STEM_SPLIT_TASK_TYPE: make_stem_split_handler(split=lambda tid, _: calls.append(tid))
    }
    run_pending(db, handlers)
    assert calls == []  # current stems -> no split
    task = db.query(Task).filter(Task.type == STEM_SPLIT_TASK_TYPE).one()
    assert task.state == "done"


def test_handler_failure_is_terminal(db: Session, make_track, tmp_path: Path, stems_config) -> None:
    source = tmp_path / "track.mp3"
    source.write_bytes(b"x" * 100)
    track = make_track(filename=str(source))

    def broken_split(track_id: int, src: Path) -> None:
        raise RuntimeError("demucs exploded")

    enqueue_stem_split(db, track.id)
    handlers = {STEM_SPLIT_TASK_TYPE: make_stem_split_handler(split=broken_split)}
    run_pending(db, handlers)
    task = db.query(Task).filter(Task.type == STEM_SPLIT_TASK_TYPE).one()
    assert task.state == "failed"  # immediate, no retry storm
    assert "demucs exploded" in (task.error or "")


def test_handler_missing_track_fails(db: Session) -> None:
    from backend.tasks.manager import create_task

    create_task(db, STEM_SPLIT_TASK_TYPE, {"track_id": 424242}, ref="track:424242")
    handlers = {STEM_SPLIT_TASK_TYPE: make_stem_split_handler(split=lambda *a: None)}
    run_pending(db, handlers)
    task = db.query(Task).filter(Task.type == STEM_SPLIT_TASK_TYPE).one()
    assert task.state == "failed"


# --- sweep + backlog guard --------------------------------------------------------


def _tracks_with_sources(make_track, tmp_path: Path, n: int) -> list:
    tracks = []
    for i in range(n):
        source = tmp_path / f"track_{i}.mp3"
        source.write_bytes(b"x" * (100 + i))
        tracks.append(make_track(filename=str(source)))
    return tracks


def test_sweep_enqueues_small_backlog(
    db: Session, make_track, tmp_path: Path, stems_config: StemsConfig
) -> None:
    tracks = _tracks_with_sources(make_track, tmp_path, 3)
    write_current_meta(tracks[0].id, Path(tracks[0].filename), stems_config)
    assert enqueue_missing_stems(db, guard=20) == 2  # only the two stale ones
    refs = {t.ref for t in list_tasks(db) if t.type == STEM_SPLIT_TASK_TYPE}
    assert refs == {f"track:{tracks[1].id}", f"track:{tracks[2].id}"}


def test_sweep_backlog_guard_enqueues_nothing(
    db: Session, make_track, tmp_path: Path, stems_config: StemsConfig, caplog
) -> None:
    _tracks_with_sources(make_track, tmp_path, 5)
    with caplog.at_level("WARNING"):
        assert enqueue_missing_stems(db, guard=4) == 0
    assert not [t for t in list_tasks(db) if t.type == STEM_SPLIT_TASK_TYPE]
    assert any("backfill_stems" in r.message for r in caplog.records)


def test_sweep_skips_archived_and_dedups(
    db: Session, make_track, tmp_path: Path, stems_config: StemsConfig
) -> None:
    tracks = _tracks_with_sources(make_track, tmp_path, 2)
    from datetime import UTC, datetime

    tracks[1].archived_at = datetime.now(tz=UTC)
    db.commit()
    enqueue_stem_split(db, tracks[0].id)  # pre-existing pending task
    assert enqueue_missing_stems(db, guard=20) == 0  # deduped + archived skipped
    tasks = [t for t in list_tasks(db) if t.type == STEM_SPLIT_TASK_TYPE]
    assert len(tasks) == 1
