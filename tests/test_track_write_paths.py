"""Regression tests for Track write paths outside the router.

Pin the two unit bugs that lived in create paths: crud.create_track stored
raw BPM (schemas.TrackCreate lacked conversion), and beatgrid generation
guessed units at runtime (`if bpm > 500`).
"""

import json

from backend import crud, models, schemas
from backend.track_metadata import write_file_metadata


class TestCreateTrack:
    def test_bpm_stored_as_centibpm(self, db):
        """Regression: crud.create_track:166 stored raw float BPM."""
        track = crud.create_track(
            db, schemas.TrackCreate(filename="/nonexistent/a.mp3", bpm=128.0)
        )
        assert track.bpm == 12800

    def test_file_tag_fallback_converts_units(self, db, audio_file):
        path = audio_file("mp3")
        write_file_metadata(path, title="Tagged", key=1, bpm=140.0)
        track = crud.create_track(db, schemas.TrackCreate(filename=str(path)))
        assert track.title == "Tagged"
        assert track.key == 1
        assert track.bpm == 14000

    def test_explicit_fields_beat_file_tags(self, db, audio_file):
        path = audio_file("flac")
        write_file_metadata(path, title="FromFile")
        track = crud.create_track(
            db, schemas.TrackCreate(filename=str(path), title="Explicit")
        )
        assert track.title == "Explicit"

    def test_missing_file_still_creates(self, db):
        track = crud.create_track(db, schemas.TrackCreate(filename="/nonexistent/b.mp3"))
        assert track.id is not None


class TestBeatgridUnits:
    def test_beatgrid_generated_in_float_bpm(self, db, make_track):
        """Regression: beatgrid_utils guessed units via `if bpm > 500`; the
        conversion now happens at the call seam."""
        track = make_track(bpm=12800)  # 128 BPM stored as centiBPM
        db.add(
            models.Waveform(
                track_id=track.id,
                sample_rate=44100,
                duration=60.0,
                samples_per_peak=512,
                low_peaks_json="[]",
                mid_peaks_json="[]",
                high_peaks_json="[]",
            )
        )
        db.commit()
        beatgrid = crud.create_beatgrid_from_track_bpm(db, track.id)
        tempo_changes = json.loads(beatgrid.tempo_changes_json)
        assert tempo_changes[0]["bpm"] == 128.0
