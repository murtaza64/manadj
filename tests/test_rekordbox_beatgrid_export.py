"""Beatgrid read + export → Rekordbox (rekordbox-perf-export/04).

generate/reduce are exact inverses (property test); PQTZ authoring is
round-tripped through pyrekordbox against a synthetic minimal .DAT;
router faked at the exporter seam.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Beatgrid, Track, Waveform
from backend.sync_status.models import TempoChangeValue
from rekordbox.anlz_grid import generate_beats, read_pqtz, reduce_beats, write_pqtz


def tc(start: float, bpm: float, bar: int = 1) -> TempoChangeValue:
    return TempoChangeValue(start_time=start, bpm=bpm, bar_position=bar)


# -- generate/reduce ----------------------------------------------------------


def test_constant_grid_round_trips():
    changes = [tc(0.147, 174.0)]
    beats = generate_beats(changes, end_s=60.0)
    assert len(beats) == pytest.approx(60 / (60 / 174.0), abs=2)
    reduced = reduce_beats(beats)
    assert len(reduced.tempo_changes) == 1
    rt = reduced.tempo_changes[0]
    assert rt.start_time == pytest.approx(0.147)
    assert rt.bpm == pytest.approx(174.0)
    assert rt.bar_position == 1


def test_variable_grid_round_trips():
    changes = [tc(0.5, 172.0), tc(60.0, 86.0, bar=3)]
    reduced = reduce_beats(generate_beats(changes, end_s=120.0))
    assert [(round(c.start_time, 3), c.bpm, c.bar_position) for c in reduced.tempo_changes] == [
        (0.5, 172.0, 1),
        (60.0, 86.0, 3),
    ]


def test_beat_numbers_cycle_within_bars():
    beats = generate_beats([tc(0.0, 120.0, bar=3)], end_s=3.0)
    assert [b for b, _, _ in beats] == [3, 4, 1, 2, 3, 4]


def test_reduce_empty_is_none():
    assert reduce_beats([]) is None


# -- PQTZ authoring against a synthetic .DAT ----------------------------------


def synthetic_dat(tmp_path, n_beats: int = 4):
    """Minimal parseable ANLZ .DAT: PMAI header + one PQTZ tag, built with
    the same construct structs pyrekordbox parses with."""
    from construct import Container
    from pyrekordbox.anlz import structs

    entries = [
        Container(beat=(i % 4) + 1, tempo=17400, time=1000 + i * 345)
        for i in range(n_beats)
    ]
    pqtz = structs.PQTZ.build(
        Container(u2=0x80000, entry_count=n_beats, entries=entries)
    )
    # len_header (24) = magic(4) + len_header(4) + len_tag(4) + the PQTZ
    # struct's u1/u2/entry_count (12); entries follow
    tag = b"PQTZ" + (24).to_bytes(4, "big") + (12 + len(pqtz)).to_bytes(4, "big") + pqtz
    header_len = 28
    body = tag
    header = (
        b"PMAI"
        + header_len.to_bytes(4, "big")
        + (header_len + len(body)).to_bytes(4, "big")
        + b"\x00" * (header_len - 12)
    )
    p = tmp_path / "ANLZ0000.DAT"
    p.write_bytes(header + body)
    return p


def test_write_pqtz_round_trips_through_pyrekordbox(tmp_path):
    dat = synthetic_dat(tmp_path)
    beats = generate_beats([tc(0.147, 172.0), tc(30.0, 86.0)], end_s=60.0)
    count = write_pqtz(dat, beats)
    assert count == len(beats)

    grid = read_pqtz(dat)
    assert [(round(c.start_time, 3), c.bpm) for c in grid.tempo_changes] == [
        (0.147, 172.0),
        (30.0, 86.0),
    ]


def test_read_pqtz_missing_file_is_none(tmp_path):
    assert read_pqtz(tmp_path / "nope.DAT") is None


# -- router seam ---------------------------------------------------------------


class FakeExporter:
    def __init__(self):
        self.calls = []

    def export_beatgrid(self, filename, tempo_changes, end_s=None):
        self.calls.append((filename, tempo_changes, end_s))
        return {"beats": 99, "tempo_changes": len(tempo_changes), "bpm": 172.0}


@pytest.fixture
def client_and_tracks(db: Session):
    import json

    from backend.routers import sync_export

    gridded = Track(filename="/music/g.flac", title="G")
    placeholder = Track(filename="/music/p.flac", title="P")
    db.add_all([gridded, placeholder])
    db.commit()
    db.add_all(
        [
            Waveform(track_id=gridded.id, duration=240.0, sample_rate=44100, samples_per_peak=512),
            Beatgrid(
                track_id=gridded.id,
                tempo_changes_json=json.dumps(
                    [{"start_time": 0.147, "bpm": 172.0, "bar_position": 1}]
                ),
                origin="imported",
            ),
            Beatgrid(
                track_id=placeholder.id,
                tempo_changes_json=json.dumps([{"start_time": 0.0, "bpm": 120.0}]),
                origin="generated",  # placeholder: never exports
            ),
        ]
    )
    db.commit()
    db.refresh(gridded)
    db.refresh(placeholder)

    exporter = FakeExporter()
    app = FastAPI()
    app.include_router(sync_export.router, prefix="/api")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[sync_export.get_rekordbox_perf_exporter] = lambda: exporter
    return TestClient(app), gridded, placeholder, exporter


def test_exports_saved_grid_with_duration(client_and_tracks):
    client, gridded, _, exporter = client_and_tracks
    res = client.post(
        "/api/sync/export/beatgrid/rekordbox", json={"track_id": gridded.id}
    )
    assert res.status_code == 200
    assert res.json()["beats"] == 99
    (filename, tempo_changes, end_s), = exporter.calls
    assert filename == "/music/g.flac"
    assert [(c.start_time, c.bpm) for c in tempo_changes] == [(0.147, 172.0)]
    assert end_s == 240.0


def test_placeholder_grid_409(client_and_tracks):
    client, _, placeholder, exporter = client_and_tracks
    res = client.post(
        "/api/sync/export/beatgrid/rekordbox", json={"track_id": placeholder.id}
    )
    assert res.status_code == 409
    assert exporter.calls == []


def test_pqtz_extent_is_last_beat_not_last_segment(tmp_path):
    """Live-fire regression: RB analyzed grids wobble into many tempo
    runs; the export end fallback must use the last BEAT time, else
    trailing segments of an authored grid are silently truncated."""
    from rekordbox.anlz_grid import pqtz_extent_s

    dat = synthetic_dat(tmp_path, n_beats=8)  # beats at 1000..1000+7*345 ms
    assert pqtz_extent_s(dat) == pytest.approx(1.0 + 7 * 0.345)
    assert pqtz_extent_s(tmp_path / "missing.DAT") is None
