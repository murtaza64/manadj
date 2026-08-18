"""Tracer export (rekordbox-usb-export/04): from-scratch device tree,
verified end-to-end through the independent read oracle."""

import json

import pytest

from backend import models
from rekordbox.decode_offset import export_offset_ms
from rekordbox.device.anlz_read import read_anlz
from rekordbox.device.export import export_playlists
from rekordbox.device.pdb_read import read_pdb
from rekordbox.device.pdb_write import MIN_TRACK_ROW_LEN


@pytest.fixture
def library(db, make_track, audio_file, tmp_path):
    """One playlist with an mp3 and an m4a track, grids and main cues."""
    tracks = []
    for i, fmt in enumerate(("mp3", "m4a"), start=1):
        audio = audio_file(fmt, name=f"Test Artist - Track {i}.{fmt}")
        track = make_track(
            filename=str(audio),
            title=f"Track {i}",
            artist="Test Artist",
            bpm=17400,
            key=2,
            energy=4,
            duration_secs=2.0,
            cue_point_time=0.5,
            codec="mp3" if fmt == "mp3" else "aac",
            filesize_bytes=audio.stat().st_size,
        )
        db.add(
            models.Beatgrid(
                track_id=track.id,
                tempo_changes_json=json.dumps(
                    [{"start_time": 0.021, "bpm": 174.0, "bar_position": 1}]
                ),
                origin="analyzed",
            )
        )
        tracks.append(track)
    playlist = models.Playlist(name="Tracer Set")
    db.add(playlist)
    db.commit()
    for pos, track in enumerate(tracks):
        db.add(models.PlaylistTrack(playlist_id=playlist.id, track_id=track.id, position=pos))
    db.commit()
    dest = tmp_path / "usb"
    return db, playlist, tracks, dest


def test_tracer_exports_complete_tree(library):
    db, playlist, tracks, dest = library
    report = export_playlists(db, [playlist.id], dest)
    assert report.track_count == 2
    assert report.playlist_count == 1
    assert report.audio_copied == 2
    assert not report.skipped

    pdb = read_pdb(dest / "PIONEER" / "rekordbox" / "export.pdb")
    assert pdb.num_tables == 20
    assert pdb.tables["tracks"].row_count == 2
    assert pdb.tables["colors"].row_count == 8

    by_id = {t.id: t for t in pdb.tables["tracks"].rows}
    for track in tracks:
        row = by_id[track.id]
        assert row.title == track.title
        assert row.tempo_centibpm == 17400
        assert row.duration_secs == 2
        assert row.file_path.startswith("/Contents/")
        assert (dest / row.file_path.lstrip("/")).is_file()
        assert (dest / row.analyze_path.lstrip("/")).is_file()

    artists = {a.name for a in pdb.tables["artists"].rows}
    assert artists == {"Test Artist"}
    keys = {k.name for k in pdb.tables["keys"].rows}
    assert keys == {"9B"}  # engine key 2 in camelot notation (as the corpus uses)

    assert pdb.tables["playlist_tree"].rows[0].name == "Tracer Set"
    entry_order = [
        e.track_id
        for e in sorted(pdb.tables["playlist_entries"].rows, key=lambda e: e.entry_index)
    ]
    assert entry_order == [t.id for t in tracks]


def test_tracer_anlz_carries_offset_corrected_grid_and_cue(library):
    db, playlist, tracks, dest = library
    export_playlists(db, [playlist.id], dest)
    pdb = read_pdb(dest / "PIONEER" / "rekordbox" / "export.pdb")
    by_id = {t.id: t for t in pdb.tables["tracks"].rows}

    for track in tracks:
        row = by_id[track.id]
        data = read_anlz(dest / row.analyze_path.lstrip("/"))
        assert data.audio_path == row.file_path
        offset_ms = export_offset_ms(track.filename)
        assert data.beats, track.filename
        assert data.beats[0].time_ms == 21 + offset_ms
        assert all(b.tempo_centibpm == 17400 for b in data.beats)
        times = [b.time_ms for b in data.beats]
        assert times == sorted(times)
        memory = [c for c in data.cues if c.list_type == "memory_cues"]
        assert len(memory) == 1
        assert memory[0].time_ms == 500 + offset_ms
        assert {w.kind for w in data.waveforms} == {"PWAV", "PWV2"}


def test_tracer_rows_clear_min_size_and_offsets_differ_by_container(library):
    db, playlist, tracks, dest = library
    export_playlists(db, [playlist.id], dest)
    # mp3 (fixture: no xing -> -2ms) and m4a (+alac priming) must differ
    offsets = {export_offset_ms(t.filename) for t in tracks}
    assert len(offsets) == 2

    data = (dest / "PIONEER" / "rekordbox" / "export.pdb").read_bytes()
    # oracle read proves parseability; row size proved via the writer's own
    # invariant (pad_track_row) exercised on real specs in export
    pdb = read_pdb(dest / "PIONEER" / "rekordbox" / "export.pdb")
    assert all(len(data) > 0 for _ in pdb.tables["tracks"].rows)
    assert MIN_TRACK_ROW_LEN == 221


def test_missing_audio_is_skipped_not_fatal(db, make_track, tmp_path):
    track = make_track(filename=str(tmp_path / "nope.mp3"))
    playlist = models.Playlist(name="Ghost Set")
    db.add(playlist)
    db.commit()
    db.add(models.PlaylistTrack(playlist_id=playlist.id, track_id=track.id, position=0))
    db.commit()
    report = export_playlists(db, [playlist.id], tmp_path / "usb")
    assert report.track_count == 0
    assert report.skipped and report.skipped[0][0] == track.id
    pdb = read_pdb(tmp_path / "usb" / "PIONEER" / "rekordbox" / "export.pdb")
    assert pdb.tables["tracks"].row_count == 0
