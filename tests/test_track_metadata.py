"""Tests for backend.track_metadata — the single write path for Track metadata.

Interface contract: BPM is a float everywhere in Python; centiBPM exists only
at the ORM column. Key crosses this interface as an Engine ID (int) or musical
notation (str) exactly where documented. Each regression test names the bug it
pins down.
"""

import pytest

from backend.key import Key
from backend.track_metadata import (
    FileMetadata,
    FileMetadataError,
    MetadataSyncRequest,
    TrackChanges,
    TrackMetadataUpdate,
    apply_update,
    bpm_to_centibpm,
    centibpm_to_bpm,
    compare_with_files,
    read_file_metadata,
    refresh_from_files,
    sync_to_db,
    write_file_metadata,
    write_to_files,
)

AUDIO_FORMATS = ["mp3", "m4a", "flac", "wav"]


class TestUnits:
    def test_round_trip(self):
        assert bpm_to_centibpm(128.0) == 12800
        assert centibpm_to_bpm(12800) == 128.0

    def test_fractional(self):
        assert bpm_to_centibpm(174.55) == 17455

    def test_none_passthrough(self):
        assert bpm_to_centibpm(None) is None
        assert centibpm_to_bpm(None) is None


class TestFileMetadata:
    @pytest.mark.parametrize("fmt", AUDIO_FORMATS)
    def test_write_read_round_trip(self, audio_file, fmt):
        """Regression: key was never written to any format (id3_utils.py:115
        called nonexistent .to_musical() in except:pass); wav writes failed
        entirely; mp3/m4a lacked an 'initialkey' easy-tag registration."""
        path = audio_file(fmt)
        write_file_metadata(path, title="Title", artist="Artist", key=1, bpm=128.0)
        meta = read_file_metadata(path)
        expected = FileMetadata(
            title="Title", artist="Artist", key=1, bpm=128.0, duration_secs=meta.duration_secs
        )
        assert meta == expected

    @pytest.mark.parametrize("fmt", AUDIO_FORMATS)
    def test_untagged_file_reads_all_none(self, audio_file, fmt):
        meta = read_file_metadata(audio_file(fmt))
        assert meta.title is None and meta.artist is None
        assert meta.key is None and meta.bpm is None

    @pytest.mark.parametrize("fmt", AUDIO_FORMATS)
    def test_duration_comes_from_the_audio_stream(self, audio_file, fmt):
        meta = read_file_metadata(audio_file(fmt))
        assert meta.duration_secs is not None
        assert 0 < meta.duration_secs < 2  # fixtures are ~0.5s of silence

    def test_read_missing_file_raises(self, tmp_path):
        with pytest.raises(FileMetadataError):
            read_file_metadata(tmp_path / "nope.mp3")

    def test_write_missing_file_raises(self, tmp_path):
        with pytest.raises(FileMetadataError):
            write_file_metadata(tmp_path / "nope.mp3", title="x")

    def test_read_garbage_file_raises(self, tmp_path):
        junk = tmp_path / "junk.mp3"
        junk.write_bytes(b"not audio at all")
        with pytest.raises(FileMetadataError):
            read_file_metadata(junk)

    def test_write_invalid_key_raises(self, audio_file):
        with pytest.raises(ValueError):
            write_file_metadata(audio_file("mp3"), key=99)

    def test_partial_write_leaves_other_tags(self, audio_file):
        path = audio_file("flac")
        write_file_metadata(path, title="Keep", artist="Me")
        write_file_metadata(path, bpm=140.0)
        meta = read_file_metadata(path)
        assert (meta.title, meta.artist, meta.bpm) == ("Keep", "Me", 140.0)


class TestApplyUpdate:
    def test_bpm_stored_as_centibpm(self, db, make_track):
        track = make_track()
        apply_update(db, track, TrackChanges(bpm=128.5), write_files=False)
        assert track.bpm == 12850

    def test_scalar_fields(self, db, make_track):
        track = make_track()
        apply_update(
            db, track, TrackChanges(title="New", artist="Artist2", key=7, energy=4),
            write_files=False,
        )
        assert (track.title, track.artist, track.key, track.energy) == ("New", "Artist2", 7, 4)

    def test_none_means_unchanged(self, db, make_track):
        track = make_track(title="Old", bpm=12800)
        apply_update(db, track, TrackChanges(artist="Someone"), write_files=False)
        assert track.title == "Old"
        assert track.bpm == 12800

    def test_invalid_energy_rejected(self):
        with pytest.raises(ValueError):
            TrackChanges(energy=6)

    def test_invalid_key_rejected(self):
        with pytest.raises(ValueError):
            TrackChanges(key=24)

    def test_title_artist_written_back_to_file(self, db, make_track, audio_file):
        path = audio_file("mp3")
        track = make_track(filename=str(path))
        apply_update(db, track, TrackChanges(title="Written", artist="ToFile"))
        meta = read_file_metadata(path)
        assert (meta.title, meta.artist) == ("Written", "ToFile")

    def test_key_bpm_not_written_back_to_file(self, db, make_track, audio_file):
        """Policy: PATCH writes only title/artist to files; key/bpm reach files
        via the explicit write-to-files flow."""
        path = audio_file("mp3")
        track = make_track(filename=str(path))
        apply_update(db, track, TrackChanges(key=1, bpm=128.0))
        meta = read_file_metadata(path)
        assert meta.key is None
        assert meta.bpm is None

    def test_missing_file_does_not_block_db_update(self, db, make_track):
        track = make_track(filename="/nonexistent/x.mp3")
        apply_update(db, track, TrackChanges(title="StillLands"))
        assert track.title == "StillLands"

    def test_tag_ids(self, db, make_track):
        from backend.models import Tag, TagCategory

        cat = TagCategory(name="Genre", color="#f00")
        db.add(cat)
        db.commit()
        tag = Tag(name="House", category_id=cat.id)
        db.add(tag)
        db.commit()
        track = make_track()
        apply_update(db, track, TrackChanges(tag_ids=[tag.id]), write_files=False)
        db.refresh(track)
        assert [tt.tag.name for tt in track.track_tags] == ["House"]


class TestCompareWithFiles:
    def test_db_key_appears_as_musical_notation(self, db, make_track, audio_file):
        """Regression: tracks.py:281 called Key(...).to_musical() in a bare
        except — the DB side of every key comparison was always None."""
        path = audio_file("mp3")
        write_file_metadata(path, key=7)  # F#m in file
        make_track(filename=str(path), key=1, title=None, artist=None)  # Am in DB
        result = compare_with_files(db)
        assert len(result.comparisons) == 1
        comp = result.comparisons[0]
        assert comp.current.key == "Am"
        assert comp.file.key == "F#m"
        assert "key" in comp.differences
        assert comp.conflict_type == "conflict"

    def test_bpm_compared_in_float_bpm(self, db, make_track, audio_file):
        path = audio_file("flac")
        write_file_metadata(path, bpm=140.0)
        make_track(filename=str(path), bpm=12800, title=None, artist=None)
        comp = compare_with_files(db).comparisons[0]
        assert comp.current.bpm == 128.0
        assert comp.file.bpm == 140.0

    def test_identical_metadata_not_reported(self, db, make_track, audio_file):
        path = audio_file("mp3")
        write_file_metadata(path, title="Same", artist="Same Artist", key=1, bpm=128.0)
        make_track(filename=str(path), title="Same", artist="Same Artist", key=1, bpm=12800)
        result = compare_with_files(db)
        assert result.comparisons == []
        assert result.stats.tracks_with_changes == 0

    def test_missing_file_counted(self, db, make_track):
        make_track(filename="/nonexistent/y.mp3")
        result = compare_with_files(db)
        assert result.stats.missing_files == 1
        assert result.comparisons == []


class TestSyncToDb:
    def test_key_synced_from_musical_notation(self, db, make_track):
        """Regression: tracks.py:398 called key_obj.to_engine() — key sync
        always recorded an error and never updated the DB."""
        track = make_track(key=None)
        result = sync_to_db(
            db,
            MetadataSyncRequest(
                updates=[TrackMetadataUpdate(track_id=track.id, fields={"key": "Am"})],
                dry_run=False,
            ),
        )
        assert result.stats.updated == 1
        assert result.stats.error_messages == []
        assert track.key == Key.from_musical("Am").engine_id

    def test_bpm_synced_as_float(self, db, make_track):
        track = make_track(bpm=None)
        sync_to_db(
            db,
            MetadataSyncRequest(
                updates=[TrackMetadataUpdate(track_id=track.id, fields={"bpm": 128.0})],
                dry_run=False,
            ),
        )
        assert track.bpm == 12800

    def test_dry_run_changes_nothing(self, db, make_track):
        track = make_track(title="Before")
        result = sync_to_db(
            db,
            MetadataSyncRequest(
                updates=[TrackMetadataUpdate(track_id=track.id, fields={"title": "After"})],
                dry_run=True,
            ),
        )
        assert result.stats.updated == 1  # would update
        assert track.title == "Before"

    def test_invalid_key_reports_error(self, db, make_track):
        track = make_track(key=3)
        result = sync_to_db(
            db,
            MetadataSyncRequest(
                updates=[TrackMetadataUpdate(track_id=track.id, fields={"key": "H#"})],
                dry_run=False,
            ),
        )
        assert result.stats.error_messages
        assert track.key == 3

    def test_unknown_track_skipped(self, db):
        result = sync_to_db(
            db,
            MetadataSyncRequest(
                updates=[TrackMetadataUpdate(track_id=999, fields={"title": "x"})],
                dry_run=False,
            ),
        )
        assert result.stats.skipped == 1


class TestWriteToFiles:
    def test_bpm_written_as_bpm_not_centibpm_fraction(self, db, make_track, audio_file):
        """Regression: tracks.py:472 divided the incoming float BPM by 100,
        writing '1' into files instead of '128'."""
        path = audio_file("mp3")
        track = make_track(filename=str(path), bpm=12800)
        write_to_files(
            db,
            MetadataSyncRequest(
                updates=[TrackMetadataUpdate(track_id=track.id, fields={"bpm": 128.0})],
                dry_run=False,
            ),
        )
        assert read_file_metadata(path).bpm == 128.0

    def test_key_written_from_musical_notation(self, db, make_track, audio_file):
        """Regression: tracks.py:475 did int('Am') — key never reached files."""
        path = audio_file("flac")
        track = make_track(filename=str(path), key=1)
        result = write_to_files(
            db,
            MetadataSyncRequest(
                updates=[TrackMetadataUpdate(track_id=track.id, fields={"key": "Am"})],
                dry_run=False,
            ),
        )
        assert result.stats.errors == 0
        assert read_file_metadata(path).key == 1

    def test_dry_run_does_not_touch_file(self, db, make_track, audio_file):
        path = audio_file("mp3")
        track = make_track(filename=str(path))
        write_to_files(
            db,
            MetadataSyncRequest(
                updates=[TrackMetadataUpdate(track_id=track.id, fields={"title": "Nope"})],
                dry_run=True,
            ),
        )
        assert read_file_metadata(path).title is None


def _grid(db, track_id: int, bpm: float, origin: str = "edited"):
    import json

    from backend.beatgrid_utils import constant_tempo_changes
    from backend.models import Beatgrid

    grid = Beatgrid(
        track_id=track_id,
        tempo_changes_json=json.dumps(constant_tempo_changes(bpm)),
        origin=origin,
    )
    db.add(grid)
    db.commit()
    return grid


class TestFileToDbBpmGuards:
    """File→DB BPM never overwrites a gridded track (ADR 0027 §1)."""

    def test_refresh_skips_bpm_on_gridded_track(self, db, make_track, audio_file):
        path = audio_file("mp3")
        write_file_metadata(path, title="FromFile", artist="FileArtist", key=5, bpm=87.0)
        track = make_track(filename=str(path), bpm=17400)
        grid = _grid(db, track.id, 174.0)
        before_json = grid.tempo_changes_json

        refresh_from_files(db, track_id=track.id)
        db.refresh(track)
        db.refresh(grid)
        # grid and column untouched; other fields still update
        assert grid.tempo_changes_json == before_json
        assert grid.origin == "edited"
        assert track.bpm == 17400
        assert (track.title, track.artist, track.key) == ("FromFile", "FileArtist", 5)

    def test_refresh_regenerates_placeholder_via_write_bpm(self, db, make_track, audio_file):
        import json

        path = audio_file("mp3")
        write_file_metadata(path, bpm=140.0)
        track = make_track(filename=str(path), bpm=12800)
        grid = _grid(db, track.id, 128.0, origin="generated")

        refresh_from_files(db, track_id=track.id)
        db.refresh(track)
        db.refresh(grid)
        assert track.bpm == 14000
        assert grid.origin == "generated"  # still a placeholder, regenerated
        assert json.loads(grid.tempo_changes_json)[0]["bpm"] == 140.0

    def test_sync_to_db_skips_bpm_on_gridded_track(self, db, make_track):
        track = make_track(bpm=17400)
        grid = _grid(db, track.id, 174.0)
        before_json = grid.tempo_changes_json

        sync_to_db(
            db,
            MetadataSyncRequest(
                updates=[TrackMetadataUpdate(track_id=track.id, fields={"bpm": 87.0})],
                dry_run=False,
            ),
        )
        db.refresh(track)
        db.refresh(grid)
        assert track.bpm == 17400
        assert grid.tempo_changes_json == before_json

    def test_sync_to_db_routes_placeholder_bpm_through_write_bpm(self, db, make_track):
        import json

        track = make_track(bpm=12800)
        grid = _grid(db, track.id, 128.0, origin="generated")

        sync_to_db(
            db,
            MetadataSyncRequest(
                updates=[TrackMetadataUpdate(track_id=track.id, fields={"bpm": 140.0})],
                dry_run=False,
            ),
        )
        db.refresh(track)
        db.refresh(grid)
        assert track.bpm == 14000
        assert json.loads(grid.tempo_changes_json)[0]["bpm"] == 140.0

    def test_compare_diffs_file_bpm_against_grid_first_projection(
        self, db, make_track, audio_file
    ):
        """A gridded track whose file matches the GRID shows no BPM
        divergence even when the internal column is stale — kills the
        perpetual phantom "fix the DB" proposal."""
        path = audio_file("flac")
        write_file_metadata(path, bpm=174.0)
        track = make_track(filename=str(path), bpm=8700, title=None, artist=None)
        _grid(db, track.id, 174.0)

        result = compare_with_files(db)
        assert result.comparisons == []

    def test_compare_reports_real_grid_divergence(self, db, make_track, audio_file):
        path = audio_file("flac")
        write_file_metadata(path, bpm=87.0)
        track = make_track(filename=str(path), bpm=17400, title=None, artist=None)
        _grid(db, track.id, 174.0)

        comp = compare_with_files(db).comparisons[0]
        assert comp.current.bpm == 174.0  # the projection, not the raw column
        assert comp.file.bpm == 87.0
        assert "bpm" in comp.differences


class TestRefreshFromFiles:
    def test_refresh_single_track(self, db, make_track, audio_file):
        path = audio_file("m4a")
        write_file_metadata(path, title="FromFile", artist="FileArtist", key=5, bpm=140.0)
        track = make_track(filename=str(path))
        count = refresh_from_files(db, track_id=track.id)
        assert count == 1
        assert (track.title, track.artist, track.key, track.bpm) == (
            "FromFile", "FileArtist", 5, 14000,
        )

    def test_refresh_all_skips_unreadable(self, db, make_track, audio_file):
        path = audio_file("mp3")
        write_file_metadata(path, title="Ok")
        make_track(filename=str(path))
        make_track(filename="/nonexistent/z.mp3")
        count = refresh_from_files(db)
        assert count == 1

    def test_unknown_track_raises(self, db):
        with pytest.raises(ValueError):
            refresh_from_files(db, track_id=999)
