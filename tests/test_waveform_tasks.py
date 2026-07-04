"""Waveform generation on the task system (waveform-overhaul issue 02).

Real internals per ADR-0002: real task manager over in-memory SQLite, real
blob generation (ffmpeg) for the backfill path. The *legacy* full-generation
path (JSON/PNG, librosa) is behind the injectable seam in
`make_waveform_handler` — audio analysis is a listed fakeable seam, and the
heavy-dep guards forbid librosa in the suite's import chain.
"""

from backend import models
from backend.tasks.manager import list_tasks, run_pending
from backend.tasks.models import Task
from backend.waveform_data import SAMPLE_RATE, PEAK_HOP, decode_blob
from backend.waveform_tasks import (
    WAVEFORM_TASK_TYPE,
    enqueue_missing_waveforms,
    enqueue_waveform_task,
    make_waveform_handler,
)


def _seed_waveform_row(db, track, blob=None):
    db.add(
        models.Waveform(
            track_id=track.id,
            sample_rate=SAMPLE_RATE,
            duration=2.0,
            samples_per_peak=PEAK_HOP,
            low_peaks_json="[]",
            mid_peaks_json="[]",
            high_peaks_json="[]",
            data_blob=blob,
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
    _seed_waveform_row(db, has_blob, blob=b"MWF1-fake")

    assert enqueue_missing_waveforms(db) == 2
    refs = {t.ref for t in list_tasks(db, state="pending")}
    assert refs == {f"track:{missing_row.id}", f"track:{null_blob.id}"}

    # Sweep is idempotent while tasks are pending.
    assert enqueue_missing_waveforms(db) == 0


def test_create_track_enqueues_generation(db):
    from backend import crud, schemas

    track = crud.create_track(db, schemas.TrackCreate(filename="/tracks/new.mp3"))
    tasks = list_tasks(db, ref=f"track:{track.id}", state="pending")
    assert len(tasks) == 1
    assert tasks[0].type == WAVEFORM_TASK_TYPE


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
    _seed_waveform_row(db, track, blob=b"MWF1-fake")
    enqueue_waveform_task(db, track.id)

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
