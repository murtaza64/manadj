"""Stored preview format, atomic writes, worker backfill, and request isolation."""

import re
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest
from alembic.config import Config as AlembicConfig
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, inspect, text

from alembic import command as alembic_command
from backend import crud, models
from backend.database import get_db
from backend.routers import tasks as tasks_router
from backend.routers.waveforms import router
from backend.tasks.manager import create_task, list_tasks, run_pending
from backend.waveform_data import (
    BAND_EDGES,
    N_BANDS,
    PEAK_HOP,
    PREVIEW_BINS,
    SAMPLE_RATE,
    build_blob,
    build_preview_blob,
    decode_blob,
)
from backend.waveform_tasks import (
    WAVEFORM_TASK_TYPE,
    enqueue_missing_waveforms,
    enqueue_waveform_task,
    make_waveform_handler,
)


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(router, prefix="/api/waveforms")
    app.include_router(tasks_router.router, prefix="/api/tasks")
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


@pytest.fixture
def sql(db):
    statements = []

    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    engine = db.get_bind()
    event.listen(engine, "before_cursor_execute", capture)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", capture)


def _assert_no_full_blob_reads(statements):
    selects = [s for s in statements if s.lstrip().upper().startswith("SELECT")]
    assert selects
    for statement in selects:
        # Presence checks may mention the column, but never return its bytes.
        assert "data_blob" not in re.sub(
            r"waveforms\.data_blob IS NOT NULL", "has_blob", statement,
        ), statement


def _blob():
    return build_blob(
        np.arange(256, dtype=np.uint8),
        np.tile(np.arange(N_BANDS, dtype=np.uint8), (64, 1)),
        256 * PEAK_HOP / SAMPLE_RATE,
    )


def _seed(db, track_id, blob=None, preview=None):
    db.add(models.Waveform(
        track_id=track_id, sample_rate=SAMPLE_RATE, duration=2,
        samples_per_peak=PEAK_HOP, data_blob=blob, preview_blob=preview,
    ))
    db.commit()


def test_schema_migration_preserves_full_blob_and_leaves_preview_for_worker():
    engine = create_engine("sqlite:///:memory:")
    try:
        with engine.connect() as connection:
            cfg = AlembicConfig(str(Path(__file__).parent.parent / "alembic.ini"))
            cfg.attributes.update(connection=connection, configure_logger=False)
            alembic_command.upgrade(cfg, "0039_kpplp")
            connection.execute(text("INSERT INTO tracks (id, filename) VALUES (1, '/missing.wav')"))
            connection.execute(text(
                "INSERT INTO waveforms "
                "(track_id, sample_rate, duration, samples_per_peak, data_blob) "
                "VALUES (1, 44100, 2, 128, :blob)"
            ), {"blob": _blob()})
            connection.commit()
            alembic_command.upgrade(cfg, "head")
            assert connection.execute(text(
                "SELECT data_blob, preview_blob FROM waveforms"
            )).one() == (_blob(), None)
            columns = {column["name"]: column for column in inspect(connection).get_columns("waveforms")}
            assert columns["preview_blob"]["nullable"]
    finally:
        engine.dispose()


def test_reduction_hand_checked_bins_and_time_mapping():
    # Each output interval is 2048 samples: 16 peaks, four centered band frames.
    peaks = np.tile(np.arange(16, dtype=np.uint8), 256)
    peaks[0] = 255
    bands = np.tile(np.arange(1024, dtype=np.uint16)[:, None] % 256, (1, N_BANDS))
    bands = bands.astype(np.uint8)
    duration = 256 * 2048 / SAMPLE_RATE
    full = build_blob(peaks, bands, duration)
    preview = build_preview_blob(full)
    assert preview == build_preview_blob(full)
    assert len(preview) == 2388
    d = decode_blob(preview)
    assert d["peaks"].tolist() == [255] + [15] * 255
    # Centers 1024,1536 lie in bin 0; 2048,2560,3072,3584 in bin 1.
    assert d["bands"][0].tolist() == [1] * N_BANDS  # round(mean(0,1))
    assert d["bands"][1].tolist() == [4] * N_BANDS  # round(mean(2,3,4,5))
    assert d["bands"][2].tolist() == [8] * N_BANDS
    assert d["bands"].shape == (PREVIEW_BINS, N_BANDS)
    assert d["band_edges"] == BAND_EDGES
    assert d["gamma"] == 0.5
    assert d["duration"] == duration
    assert PREVIEW_BINS * d["peak_hop"] / d["sample_rate"] == pytest.approx(duration)
    assert d["band_hop"] == d["peak_hop"] == d["stft_window"]


@pytest.mark.parametrize("samples", [1, 127, 513, 88201, 44100 * 617 + 13])
def test_silence_short_input_and_nonintegral_hops(samples):
    full = build_blob(
        np.zeros((samples + PEAK_HOP - 1) // PEAK_HOP, dtype=np.uint8),
        np.zeros((max(1, samples // 512), N_BANDS), dtype=np.uint8),
        samples / SAMPLE_RATE,
    )
    d = decode_blob(build_preview_blob(full))
    assert len(d["peaks"]) == PREVIEW_BINS
    assert not d["peaks"].any()
    assert not d["bands"].any()
    assert PREVIEW_BINS * d["peak_hop"] / d["sample_rate"] == pytest.approx(
        samples / SAMPLE_RATE, abs=1e-10,
    )


def test_short_input_repeats_nearest_available_values():
    full = build_blob(
        np.array([91], dtype=np.uint8), np.full((1, N_BANDS), 37, dtype=np.uint8),
        1 / SAMPLE_RATE,
    )
    d = decode_blob(build_preview_blob(full))
    assert np.all(d["peaks"] == 91)
    assert np.all(d["bands"] == 37)


@pytest.mark.parametrize("existing_row", [False, True])
def test_generation_writes_both_artifacts_atomically(db, make_track, sql, existing_row):
    filename = str(Path(__file__).parent / "fixtures" / "tone_1500hz.wav")
    track_id = make_track(filename=filename).id
    if existing_row:
        _seed(db, track_id)
    sql.clear()
    make_waveform_handler()(db, {"track_id": track_id})
    writes = [s for s in sql if s.startswith(("INSERT INTO waveforms", "UPDATE waveforms"))]
    assert len(writes) == 1
    assert "data_blob" in writes[0] and "preview_blob" in writes[0]
    full, preview = db.query(models.Waveform.data_blob, models.Waveform.preview_blob).one()
    assert preview == build_preview_blob(full)
    assert len(preview) == 2388
    assert decode_blob(preview)["bands"][:, 4].mean() > 100


def test_preview_backfill_never_accesses_audio(db, make_track, monkeypatch):
    track_id = make_track(filename="/nonexistent/never-open-audio.wav").id
    full = _blob()
    _seed(db, track_id, blob=full)

    def forbidden(*args, **kwargs):
        pytest.fail("preview-only backfill must not decode audio")

    monkeypatch.setattr("backend.waveform_data.subprocess.Popen", forbidden)
    assert enqueue_waveform_task(db, track_id) is not None
    assert run_pending(db, {WAVEFORM_TASK_TYPE: make_waveform_handler()}) == 1
    assert list_tasks(db, ref=f"track:{track_id}")[0].state == "done"
    stored_full, preview = db.query(
        models.Waveform.data_blob, models.Waveform.preview_blob,
    ).one()
    assert stored_full == full
    assert preview == build_preview_blob(full)


def test_enqueue_and_complete_handler_use_only_boolean_projections(db, make_track, sql):
    track_id = make_track().id
    _seed(db, track_id, blob=b"full", preview=b"preview")
    sql.clear()
    assert enqueue_waveform_task(db, track_id) is None
    make_waveform_handler()(db, {"track_id": track_id})
    _assert_no_full_blob_reads(sql)
    assert list_tasks(db) == []


def test_enqueue_deduplicates_running_preview_backfill(db, make_track, sql):
    track_id = make_track().id
    _seed(db, track_id, blob=b"full")
    sql.clear()
    task = enqueue_waveform_task(db, track_id)
    assert task is not None
    task.state = "running"
    db.commit()
    assert enqueue_waveform_task(db, track_id) is None
    _assert_no_full_blob_reads(sql)


def test_blob_columns_are_deferred(db, make_track, sql):
    track_id = make_track().id
    _seed(db, track_id, blob=b"full", preview=b"preview")
    sql.clear()
    waveform = crud.get_waveform(db, track_id)
    assert {"data_blob", "preview_blob"} <= inspect(waveform).unloaded
    assert not any("blob" in statement for statement in sql)


@pytest.mark.parametrize("state", ["no-row", "null-full", "full-only"])
@pytest.mark.parametrize("archived", [False, True])
def test_pending_preview_enqueues_without_full_blob_read(
    db, client, make_track, sql, state, archived,
):
    track_id = make_track(archived_at=datetime.now(UTC) if archived else None).id
    if state != "no-row":
        _seed(db, track_id, blob=_blob() if state == "full-only" else None)
    sql.clear()
    for _ in range(2):
        response = client.get(f"/api/waveforms/{track_id}/preview")
        assert response.status_code == 202
        assert response.content == b""
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["retry-after"] == "2"
    _assert_no_full_blob_reads(sql)
    assert len(list_tasks(db, ref=f"track:{track_id}")) == 1


def test_missing_track_returns_404_without_task(db, client, sql):
    response = client.get("/api/waveforms/99999/preview")
    assert response.status_code == 404
    assert response.json() == {"detail": "Track not found"}
    assert response.headers["cache-control"] == "no-store"
    _assert_no_full_blob_reads(sql)
    assert list_tasks(db) == []


def test_failed_preview_requires_explicit_task_retry(db, client, make_track, sql):
    track = make_track(filename="/nonexistent/unreadable.wav")
    track_id = track.id
    url = f"/api/waveforms/{track_id}/preview"
    sql.clear()
    assert client.get(url).status_code == 202
    _assert_no_full_blob_reads(sql)
    task = list_tasks(db, ref=f"track:{track_id}")[0]
    task_id = task.id

    def unreadable_audio(session, requested_id, filename):
        assert requested_id == track_id
        assert filename == "/nonexistent/unreadable.wav"
        raise RuntimeError("Audio file unreadable")

    assert run_pending(db, {
        WAVEFORM_TASK_TYPE: make_waveform_handler(unreadable_audio),
    }) == 1
    assert task.state == "failed"
    assert task.error == "Audio file unreadable"

    for dismissed in (False, True):
        if dismissed:
            response = client.post(f"/api/tasks/{task_id}/dismiss")
            assert response.status_code == 200
            assert response.json()["dismissed_at"] is not None
        sql.clear()
        for _ in range(3):
            response = client.get(url)
            assert response.status_code == 409
            assert response.headers["cache-control"] == "no-store"
            assert response.json() == {
                "detail": "Waveform generation failed; retry it in Tasks",
            }
        _assert_no_full_blob_reads(sql)
        assert [t.id for t in list_tasks(db, ref=f"track:{track_id}")] == [task_id]

    retry = client.post(f"/api/tasks/{task_id}/retry")
    assert retry.status_code == 200
    assert retry.json()["id"] == task_id
    assert retry.json()["state"] == "pending"
    sql.clear()
    assert client.get(url).status_code == 202
    _assert_no_full_blob_reads(sql)

    track.filename = str(Path(__file__).parent / "fixtures" / "tone_1500hz.wav")
    db.commit()
    assert run_pending(db, {WAVEFORM_TASK_TYPE: make_waveform_handler()}) == 1
    assert task.state == "done"
    sql.clear()
    response = client.get(url)
    assert response.status_code == 200
    assert len(response.content) == 2388
    _assert_no_full_blob_reads(sql)
    assert [t.id for t in list_tasks(db, ref=f"track:{track_id}")] == [task_id]


@pytest.mark.parametrize("latest_state,ready,status,count", [
    ("pending", False, 202, 2),
    ("running", False, 202, 2),
    ("done", False, 202, 3),
    ("done", True, 200, 2),
])
def test_preview_uses_latest_waveform_task_state(
    db, client, make_track, sql, latest_state, ready, status, count,
):
    track_id = make_track().id
    ref = f"track:{track_id}"
    older = create_task(db, WAVEFORM_TASK_TYPE, {"track_id": track_id}, ref=ref)
    older.state = "failed"
    db.commit()
    # Startup retains its retry policy and creates a newer task after failure.
    assert enqueue_missing_waveforms(db) == 1
    newer = list_tasks(db, ref=ref, state="pending")[0]
    assert newer.id > older.id
    newer.state = latest_state
    db.commit()
    if ready:
        full = _blob()
        _seed(db, track_id, blob=full, preview=build_preview_blob(full))
    # Newer failures for another task type or track must not affect this preview.
    for type_, task_ref in [("analysis", ref), (WAVEFORM_TASK_TYPE, "track:99999")]:
        unrelated = create_task(db, type_, {}, ref=task_ref)
        unrelated.state = "failed"
        db.commit()
    sql.clear()
    assert client.get(f"/api/waveforms/{track_id}/preview").status_code == status
    _assert_no_full_blob_reads(sql)
    assert len(list_tasks(db, type_=WAVEFORM_TASK_TYPE, ref=ref)) == count


def test_preview_response_revalidates_and_exposes_etag(db, client, make_track, sql):
    track_id = make_track().id
    preview = build_preview_blob(_blob())
    _seed(db, track_id, blob=b"not-read-or-decoded", preview=preview)
    sql.clear()
    response = client.get(f"/api/waveforms/{track_id}/preview", headers={"Origin": "http://localhost:5173"})
    assert response.status_code == 200
    assert response.content == preview
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["cache-control"] == "private, no-cache"
    assert response.headers["access-control-expose-headers"] == "ETag"
    etag = response.headers["etag"]
    for validator in [etag, f"W/{etag}", f'"other", {etag}', "*"]:
        cached = client.get(
            f"/api/waveforms/{track_id}/preview", headers={"If-None-Match": validator},
        )
        assert cached.status_code == 304
        assert cached.content == b""
        assert cached.headers["etag"] == etag
        assert cached.headers["cache-control"] == "private, no-cache"
        assert cached.headers["access-control-expose-headers"] == "ETag"
    stale = client.get(
        f"/api/waveforms/{track_id}/preview", headers={"If-None-Match": '"old"'},
    )
    assert stale.status_code == 200
    _assert_no_full_blob_reads(sql)
    assert all("preview_blob" in statement for statement in sql)
    assert list_tasks(db) == []
