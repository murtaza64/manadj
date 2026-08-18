import struct

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
        perf = session.get(PerformanceData, saved.id)
        cues = parse_quick_cues(perf.quickCues)
        beat = parse_beat_data(perf.beatData)
        assert saved.key == 7 and saved.rating == 100
        assert parse_track_data(perf.trackData).key == 7
        assert cues.hot_cues[0].sample_offset == pytest.approx(30 * 44100)
        assert cues.main_cue_samples == pytest.approx(15 * 44100)
        assert cues.main_cue_overridden is True
        assert beat.adjusted_grid[1].sample_offset == pytest.approx(0.5 * 44100)
