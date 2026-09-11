"""Waveform tasks: real SQLite/ffmpeg, with an injectable audio analysis seam."""

from backend import models
from backend.tasks.manager import list_tasks, run_pending
from backend.tasks.models import Task
from backend.waveform_data import PEAK_HOP, SAMPLE_RATE, build_preview_blob, decode_blob
from backend.waveform_tasks import (
    WAVEFORM_TASK_TYPE,
    enqueue_missing_waveforms,
    enqueue_waveform_task,
    make_waveform_handler,
)


def _seed_waveform_row(db, track, blob=None, preview=None):
    db.add(
        models.Waveform(
            track_id=track.id,
            sample_rate=SAMPLE_RATE,
            duration=2.0,
            samples_per_peak=PEAK_HOP,
            data_blob=blob,
            preview_blob=preview,
        )
    )
    db.commit()


def _blob_of(db, track_id):
    return (
        db.query(models.Waveform.data_blob)
        .filter(models.Waveform.track_id == track_id)
        .scalar()
    )


# ----------------------------------------------------------------- enqueuing


def test_enqueue_dedups_pending_tasks(db, make_track):
    track = make_track()
    # make_track goes through the model directly; crud.create_track is the
    # enqueue chokepoint, so enqueue explicitly here.
    assert enqueue_waveform_task(db, track.id) is not None
    assert enqueue_waveform_task(db, track.id) is None  # already pending
    assert len(list_tasks(db, ref=f"track:{track.id}")) == 1


def test_sweep_enqueues_only_tracks_missing_waveform_data(db, make_track, audio_file):
    missing_row = make_track()
    null_blob = make_track()
    _seed_waveform_row(db, null_blob, blob=None)
    has_blob = make_track()
    _seed_waveform_row(db, has_blob, blob=b"MWF1-fake", preview=b"preview-fake")
    missing_preview = make_track()
    _seed_waveform_row(db, missing_preview, blob=b"MWF1-fake")

    assert enqueue_missing_waveforms(db) == 3
    refs = {t.ref for t in list_tasks(db, state="pending")}
    assert refs == {
        f"track:{missing_row.id}", f"track:{null_blob.id}", f"track:{missing_preview.id}",
    }

    # Sweep is idempotent while tasks are pending.
    assert enqueue_missing_waveforms(db) == 0


def test_sweep_skips_archived_tracks(db, make_track):
    """Archived = out of the active Library (CONTEXT.md): the background
    sweep never spends generation on it."""
    from datetime import UTC, datetime

    make_track(archived_at=datetime.now(UTC))
    assert enqueue_missing_waveforms(db) == 0


def test_create_track_enqueues_generation(db):
    from backend import crud, schemas

    track = crud.create_track(db, schemas.TrackCreate(filename="/tracks/new.mp3"))
    tasks = list_tasks(db, ref=f"track:{track.id}", state="pending")
    # One waveform task (plus the analysis task — see test_analysis_tasks).
    waveform_tasks = [t for t in tasks if t.type == WAVEFORM_TASK_TYPE]
    assert len(waveform_tasks) == 1


# ------------------------------------------------------------------ handling


def test_blob_backfill_path_generates_real_blob(db, make_track, audio_file):
    wav = audio_file("wav")
    track = make_track(filename=str(wav))
    _seed_waveform_row(db, track, blob=None)  # pre-v2 row
    enqueue_waveform_task(db, track.id)

    processed = run_pending(db, {WAVEFORM_TASK_TYPE: make_waveform_handler()})
    assert processed == 1
    assert list_tasks(db, ref=f"track:{track.id}")[0].state == "done"

    blob = _blob_of(db, track.id)
    assert blob is not None
    assert decode_blob(blob)["duration"] > 0
    preview = db.query(models.Waveform.preview_blob).filter_by(track_id=track.id).scalar()
    assert preview == build_preview_blob(blob)


def test_full_generation_path_uses_injected_seam(db, make_track):
    track = make_track()  # no waveform row at all
    enqueue_waveform_task(db, track.id)
    calls = []

    def fake_full_generate(session, track_id, filename):
        calls.append((track_id, filename))
        _seed_waveform_row(session, track, blob=b"MWF1-fake")

    run_pending(db, {WAVEFORM_TASK_TYPE: make_waveform_handler(fake_full_generate)})
    assert calls == [(track.id, track.filename)]
    assert list_tasks(db, ref=f"track:{track.id}")[0].state == "done"


def test_handler_skips_track_that_already_has_blob(db, make_track):
    track = make_track()
    enqueue_waveform_task(db, track.id)
    _seed_waveform_row(db, track, blob=b"MWF1-fake", preview=b"preview-fake")

    def exploding_full_generate(session, track_id, filename):
        raise AssertionError("full generation must not run")

    run_pending(db, {WAVEFORM_TASK_TYPE: make_waveform_handler(exploding_full_generate)})
    assert list_tasks(db, ref=f"track:{track.id}")[0].state == "done"
    assert _blob_of(db, track.id) == b"MWF1-fake"


def test_missing_track_fails_task_without_stopping_queue(db, make_track, audio_file):
    enqueue_waveform_task(db, 99999)
    wav = audio_file("wav")
    ok_track = make_track(filename=str(wav))
    _seed_waveform_row(db, ok_track, blob=None)
    enqueue_waveform_task(db, ok_track.id)

    processed = run_pending(db, {WAVEFORM_TASK_TYPE: make_waveform_handler()})
    assert processed == 2
    failed = db.query(Task).filter(Task.ref == "track:99999").one()
    assert failed.state == "failed"
    assert "not found" in failed.error
    assert _blob_of(db, ok_track.id) is not None  # queue kept going
