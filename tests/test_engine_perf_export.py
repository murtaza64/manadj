import struct
from itertools import pairwise

import pytest

from backend.sync_status.models import TempoChangeValue
from enginedj.models.performance_data import PerformanceData
from enginedj.models.track import Track as EDJTrack
from enginedj.perf_export import EnginePerfExporter
from enginedj.performance_blobs import (
    parse_beat_data,
    parse_quick_cues,
    parse_track_data,
    q_compress,
)
from enginedj.track_export import EngineTrackSpec, insert_track
from tests.test_engine_performance_blobs import (
    CONSTANT_GRID,
    EMPTY_SLOT,
    build_beat_blob,
    build_quick_cues_blob,
)
from tests.test_engine_track_export import InMemoryEngineDB


def test_engine_perf_export_overwrites_all_supported_fields(tmp_path) -> None:
    root = tmp_path / "Engine Library"
    (root / "Database2").mkdir(parents=True)
    engine_db = InMemoryEngineDB(root)
    with engine_db.session_m_write() as session:
        track = EDJTrack(
            path="../Tracks/a.flac",
            filename="a.flac",
            title="A",
            key=1,
            rating=20,
            isAnalyzed=True,
        )
        session.add(track)
        session.flush()
        session.add(PerformanceData(
            trackId=track.id,
            beatData=build_beat_blob(default_grid=CONSTANT_GRID, adjusted_grid=CONSTANT_GRID),
            quickCues=build_quick_cues_blob([EMPTY_SLOT] * 8),
            trackData=q_compress(struct.pack(">dQI3d", 44100.0, 44100 * 180, 1, 0, 0, 0)),
        ))

    result = EnginePerfExporter(engine_db, root / "Database2").export_performance(
        "/music/a.flac",
        cues=[(1, 30.0, "Drop", "#FF0080")],
        tempo_changes=[TempoChangeValue(start_time=0.5, bpm=128.0, bar_position=1)],
        key=7,
        maincue=15.0,
        energy=5,
        duration=180.0,
    )

    assert result == {
        "hotcues": "exported",
        "beatgrid": "exported",
        "key": "exported",
        "maincue": "exported",
        "energy": "exported",
    }
    with engine_db.session_m() as session:
        saved = session.query(EDJTrack).one()
        assert saved.isAnalyzed is True
        perf = session.get(PerformanceData, saved.id)
        cues = parse_quick_cues(perf.quickCues)
        beat = parse_beat_data(perf.beatData)
        assert saved.key == 7 and saved.rating == 100
        assert parse_track_data(perf.trackData).key == 7
        assert cues.hot_cues[0].sample_offset == pytest.approx(30 * 44100)
        assert cues.hot_cues[0].color_hex == "#FF0080"
        assert cues.main_cue_samples == pytest.approx(15 * 44100)
        assert cues.main_cue_overridden is True
        assert beat.adjusted_grid[1].sample_offset == pytest.approx(0.5 * 44100)
        for grid in (beat.default_grid, beat.adjusted_grid):
            for marker, following in pairwise(grid):
                assert marker.beats_to_next == following.beat_index - marker.beat_index
                native_bpm = 60 * beat.sample_rate * marker.beats_to_next / (
                    following.sample_offset - marker.sample_offset
                )
                assert native_bpm == pytest.approx(128.0)


def test_blank_colors_use_engine_slot_palette(tmp_path) -> None:
    root = tmp_path / "Engine Library"
    (root / "Database2").mkdir(parents=True)
    database = InMemoryEngineDB(root)
    with database.session_m_write() as session:
        track = EDJTrack(path="../Tracks/a.flac", filename="a.flac", title="A")
        session.add(track)
        session.flush()
        session.add(
            PerformanceData(
                trackId=track.id,
                beatData=build_beat_blob(default_grid=CONSTANT_GRID),
                quickCues=build_quick_cues_blob([EMPTY_SLOT] * 8),
            )
        )
    EnginePerfExporter(database, root / "Database2").export_performance(
        "/music/a.flac",
        cues=[(1, 10, None, None), (4, 20, None, None)],
        tempo_changes=None,
        key=None,
        maincue=None,
        energy=None,
        duration=180,
    )
    with database.session_m() as session:
        cues = parse_quick_cues(session.query(PerformanceData).one().quickCues)
    assert [cue.color_hex for cue in cues.hot_cues] == ["#F4D338", "#CE3239"]


@pytest.fixture
def engine_database(tmp_path, monkeypatch):
    database = InMemoryEngineDB(tmp_path / "Engine Library")
    monkeypatch.setattr("enginedj.perf_export.ensure_engine_closed", lambda: None)
    monkeypatch.setattr("enginedj.perf_export.snapshot_database", lambda _path: None)
    try:
        yield database
    finally:
        database.engine.dispose()


def test_same_basename_key_exports_use_normalized_library_paths(engine_database, tmp_path):
    database = engine_database
    with database.session_m_write() as session:
        session.add_all([
            EDJTrack(id=1, path="../first/../first/same.mp3", key=1),
            EDJTrack(id=2, path="../second/same.mp3", key=2),
        ])

    exporter = EnginePerfExporter(database, database.database_path)
    for directory, key in [("first", 7), ("second", 12)]:
        result = exporter.export_performance(
            str(tmp_path / directory / "same.mp3"),
            cues=[], tempo_changes=None, key=key, maincue=None, energy=None, duration=None,
        )
        assert result["key"] == "exported"
        with database.session_m() as session:
            assert session.get(EDJTrack, 1).key == 7
            assert session.get(EDJTrack, 2).key == (2 if directory == "first" else 12)


@pytest.mark.parametrize("analyzed", [False, True])
def test_engine_perf_export_preserves_analysis_state(engine_database, audio_file, analyzed):
    database = engine_database
    audio = audio_file(name="fresh.mp3")
    with database.session_m_write() as session:
        track_id = insert_track(
            session, EngineTrackSpec(audio, "Fresh"), database.database_path.parent
        )
        session.get(EDJTrack, track_id).isAnalyzed = analyzed

    result = EnginePerfExporter(database, database.database_path).export_performance(
        str(audio),
        cues=[(1, 1.0, "Cue", None)],
        tempo_changes=[TempoChangeValue(start_time=0.0, bpm=128.0, bar_position=1)],
        key=7, maincue=1.0, energy=3, duration=180.0,
    )

    assert result["key"] == result["energy"] == "exported"
    for field in ("hotcues", "maincue", "beatgrid"):
        assert result[field].startswith("skipped:")
    with database.session_m() as session:
        saved = session.get(EDJTrack, track_id)
        assert saved.isAnalyzed is analyzed
        assert saved.key == 7
        assert saved.rating == 60
        perf = session.get(PerformanceData, track_id)
        assert perf.beatData is perf.quickCues is perf.trackData is None
