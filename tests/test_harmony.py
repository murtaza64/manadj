"""Harmony analysis (chord-match #387): pure parts + task seam (stubbed audio)."""

from pathlib import Path

import numpy as np
import pytest
from sqlalchemy.orm import Session

from backend import harmony as h
from backend.config import StemsConfig
from backend.harmony_tasks import (
    HARMONY_TASK_TYPE,
    enqueue_harmony_task,
    enqueue_missing_harmony,
    make_harmony_handler,
    tracks_needing_harmony,
)
from backend.models import Beatgrid, Harmony
from backend.tasks.manager import run_pending
from backend.tasks.models import Task

GRID = '[{"start_time": 0.0, "bpm": 120.0, "time_signature_num": 4, "time_signature_den": 4, "bar_position": 1}]'


# --- drop finding ------------------------------------------------------------------


def test_drop_runs_bridge_short_gaps_and_drop_short_runs() -> None:
    active = np.array([1] * 10 + [0, 0] + [1] * 10 + [0] * 3 + [1] * 15, dtype=bool)
    assert h.drop_runs(active) == [(0, 22)]  # 2-bar gap bridged; 3-bar gap not; 15 < 16


def test_find_drop_takes_longer_of_first_two_and_snaps_to_8() -> None:
    energy = np.full(120, 0.1)
    energy[3:23] = 1.0  # first run: 20 bars
    energy[40:80] = 1.0  # second: 40 bars (longer)
    energy[90:120] = 1.0  # third: ignored
    assert h.find_drop(energy) == (40, 80)
    energy = np.full(60, 0.1)
    energy[3:40] = 1.0
    assert h.find_drop(energy) == (8, 40)  # snapped forward, 32 bars remain


def test_find_drop_no_snap_when_too_short_and_none_without_run() -> None:
    energy = np.full(40, 0.1)
    energy[3:22] = 1.0  # snapping to 8 leaves 14 < 16
    assert h.find_drop(energy) == (3, 22)
    choppy = (np.arange(60) % 8 < 5).astype(float)  # 5 on, 3 off: never bridged
    assert h.find_drop(choppy) is None
    assert h.find_drop(np.zeros(10)) is None


# --- loop folding + movement -------------------------------------------------------


def _chord(*pcs: int) -> np.ndarray:
    v = np.zeros(12)
    v[list(pcs)] = 1.0
    return v / np.linalg.norm(v)


G, D, A, Bm = _chord(7, 11, 2), _chord(2, 6, 9), _chord(9, 1, 4), _chord(11, 2, 6)


def test_fold_loop_means_repeats_and_measures_consistency() -> None:
    prog = np.array([G, G, D, D, A, A, Bm, Bm])
    loop = h.fold_loop(np.concatenate([prog, prog, prog, prog[:3]]))
    assert loop is not None and loop.reps == 3
    assert np.allclose(loop.loop, prog)
    assert loop.consistency == pytest.approx(1.0)
    assert h.progression(loop.loop) == "G G D D A A Bm Bm"
    assert h.fold_loop(prog[:7]) is None


def test_movement_zero_for_drone_positive_for_progression() -> None:
    assert h.movement(np.array([Bm] * 8)) == pytest.approx(0.0, abs=1e-9)
    assert h.movement(np.array([G, G, D, D, A, A, Bm, Bm])) > h.MOVEMENT_MIN


# --- chroma ------------------------------------------------------------------------


def _tone(freq: float, seconds: float = 2.0) -> np.ndarray:
    t = np.arange(int(h.SR * seconds)) / h.SR
    return (0.5 * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def test_hpcp_puts_a440_on_a_and_c_major_on_c_e_g() -> None:
    a = h.chroma_frames(_tone(440.0), h.OTHER_BAND).mean(0)
    assert int(np.argmax(a)) == 9
    triad = _tone(261.63) + _tone(329.63) + _tone(392.0)
    c = h.chroma_frames(triad, h.OTHER_BAND).mean(0)
    assert set(np.argsort(c)[-3:]) == {0, 4, 7}


def test_bar_features_follow_the_grid() -> None:
    # 2 s bars at 120 BPM: bar 0 = A, bar 1 = C
    audio = np.concatenate([_tone(440.0), _tone(261.63)])
    feats = h.FrameFeatures(
        other=h.chroma_frames(audio, h.OTHER_BAND),
        bass=h.chroma_frames(audio, h.BASS_BAND),
        energy=h.rms_frames(audio),
    )
    n = min(len(feats.other), len(feats.energy))
    feats = h.FrameFeatures(feats.other[:n], feats.bass[:n], feats.energy[:n])
    chroma, energy = h.bar_features(feats, np.array([0.0, 2.0]))
    assert int(np.argmax(chroma[0])) == 9 and int(np.argmax(chroma[1])) == 0
    assert np.allclose(np.linalg.norm(chroma, axis=1), 1.0)
    assert energy.shape == (2,)


# --- task seam ---------------------------------------------------------------------


def _fake_result(source: str = "mix") -> h.HarmonyResult:
    bars = np.array([G, G, D, D, A, A, Bm, Bm] * 4)
    return h.HarmonyResult(
        source=source,
        bar_starts=np.arange(len(bars)) * 2.0,
        bar_chroma=bars,
        drop=(8, 32),
        loop=h.fold_loop(bars[8:32]),
    )


@pytest.fixture
def stems_config(tmp_path: Path, monkeypatch) -> StemsConfig:
    from backend import config as config_module

    config = config_module.get_config()
    stems = StemsConfig(directory=str(tmp_path / "stems"))
    monkeypatch.setattr(config, "stems", stems)
    return stems


def _gridded(db: Session, make_track, tmp_path: Path):
    source = tmp_path / f"t{len(list(tmp_path.iterdir()))}.mp3"
    source.write_bytes(b"x" * 100)
    track = make_track(filename=str(source))
    db.add(Beatgrid(track_id=track.id, tempo_changes_json=GRID, origin="analyzed"))
    db.commit()
    return track


def test_handler_stores_loop_and_sweep_skips_done(
    db: Session, make_track, tmp_path: Path, stems_config
) -> None:
    track = _gridded(db, make_track, tmp_path)
    calls = []

    def fake(grid, filename, stems):
        calls.append((filename, stems))
        return _fake_result()

    assert tracks_needing_harmony(db) == [track]
    enqueue_harmony_task(db, track.id)
    assert enqueue_harmony_task(db, track.id) is None  # dedup
    run_pending(db, {HARMONY_TASK_TYPE: make_harmony_handler(fake)})
    assert calls == [(track.filename, None)]  # no current stems -> mix
    row = db.query(Harmony).one()
    assert (row.source, row.drop_start_bar, row.drop_end_bar, row.loop_reps) == ("mix", 8, 32, 3)
    assert row.drop_start_s == 16.0
    loop = np.frombuffer(row.loop_blob, dtype=np.float32).reshape(8, 12)
    assert h.progression(loop) == "G G D D A A Bm Bm"
    assert np.frombuffer(row.bar_chroma_blob, dtype=np.float16).shape == (32 * 12,)
    assert tracks_needing_harmony(db) == []


def test_sweep_reruns_stale_version_and_mix_with_new_stems(
    db: Session, make_track, tmp_path: Path, stems_config, monkeypatch
) -> None:
    import backend.harmony_tasks as ht

    a, b = _gridded(db, make_track, tmp_path), _gridded(db, make_track, tmp_path)
    make_track()  # no grid: never needs harmony
    for t in (a, b):
        ht.store_result(db, t.id, _fake_result())
    assert tracks_needing_harmony(db) == []
    db.query(Harmony).filter(Harmony.track_id == a.id).update({"analyzer_version": 0})
    db.commit()
    monkeypatch.setattr(ht, "current_stems_dir", lambda t: Path("/s") if t.id == b.id else None)
    assert {t.id for t in tracks_needing_harmony(db)} == {a.id, b.id}
    assert enqueue_missing_harmony(db, guard=1) == 0  # backlog guard
    assert enqueue_missing_harmony(db) == 2


def test_handler_without_grid_writes_nothing(db: Session, make_track) -> None:
    track = make_track()
    enqueue_harmony_task(db, track.id)
    run_pending(db, {HARMONY_TASK_TYPE: make_harmony_handler(lambda *a: _fake_result())})
    assert db.query(Harmony).count() == 0
    assert db.query(Task).filter(Task.type == HARMONY_TASK_TYPE).one().state == "done"
