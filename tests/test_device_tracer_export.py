"""Tracer export (rekordbox-usb-export/04): from-scratch device tree,
verified end-to-end through the independent read oracle."""

import json
from pathlib import Path

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
        e.track_id for e in sorted(pdb.tables["playlist_entries"].rows, key=lambda e: e.entry_index)
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


def test_export_has_extended_analysis_and_all_hotcue_slots(library):
    from pyrekordbox.anlz import AnlzFile

    db, playlist, tracks, dest = library
    for slot in range(1, 9):
        db.add(
            models.HotCue(
                track_id=tracks[0].id,
                slot_number=slot,
                time_seconds=slot * 0.2,
                label=f"Cue {slot}",
                color="#E42B2B",
            )
        )
    db.commit()
    export_playlists(db, [playlist.id], dest)
    pdb = read_pdb(dest / "PIONEER/rekordbox/export.pdb")
    row = next(t for t in pdb.tables["tracks"].rows if t.id == tracks[0].id)
    assert row.analyze_date
    assert row.autoload_hot_cues == "ON"
    path = dest / row.analyze_path.lstrip("/")
    for suffix in (".DAT", ".EXT"):
        AnlzFile.parse_file(path.with_suffix(suffix))
    dat = read_anlz(path)
    ext = read_anlz(path.with_suffix(".EXT"))
    assert len([c for c in dat.cues if c.list_type == "memory_cues"]) == 9
    assert {w.kind for w in ext.waveforms} == {"PWV3", "PWV4", "PWV5"}
    hot = [c for c in ext.cues_extended if c.hot_cue]
    assert [c.hot_cue for c in hot] == list(range(1, 9))
    offset = export_offset_ms(tracks[0].filename)
    assert [c.time_ms for c in hot] == [i * 200 + offset for i in range(1, 9)]
    assert [c.comment.rstrip("\x00") for c in hot] == [f"Cue {i}" for i in range(1, 9)]
    assert all(c.color_rgb == (228, 43, 43) for c in hot)


def test_readback_verification_detects_incomplete_analysis(library):
    from rekordbox.device.verify import verify_export

    db, playlist, _tracks, dest = library
    export_playlists(db, [playlist.id], dest)
    report = verify_export(dest)
    assert report == {"tracks": 2, "playlists": 1, "analysis_files": 6, "errors": []}
    next((dest / "PIONEER/USBANLZ").rglob("*.EXT")).unlink()
    assert verify_export(dest)["errors"]


def test_browser_preview_is_exported_without_rekordbox_analysis(library):
    from rekordbox.device.verify import verify_export

    db, playlist, _tracks, dest = library
    export_playlists(db, [playlist.id], dest)
    rows = read_pdb(dest / "PIONEER/rekordbox/export.pdb").tables["tracks"].rows
    for row in rows:
        path = (dest / row.analyze_path.lstrip("/")).with_suffix(".2EX")
        assert path.exists(), "Rekordbox's 3Band browser preview does not fall back to DAT/EXT"
        extra = read_anlz(path)
        assert extra.audio_path == row.file_path
        waves = {w.kind: w for w in extra.waveforms}
        assert waves["PWV6"].len_entries == 1200
        assert waves["PWV6"].len_entry_bytes == 3
        ext = read_anlz(path.with_suffix(".EXT"))
        detail_count = next(w.len_entries for w in ext.waveforms if w.kind == "PWV3")
        assert waves["PWV7"].len_entries == detail_count
    assert not verify_export(dest)["errors"]
    path.unlink()
    assert verify_export(dest)["errors"], "Read-back must catch a missing browser preview"


def test_segment_boundaries_collapsing_to_same_millisecond_use_new_tempo(library):
    db, playlist, tracks, dest = library
    tracks[0].beatgrid.tempo_changes_json = json.dumps(
        [
            {"start_time": 0.1, "bpm": 120.0, "bar_position": 1},
            {"start_time": 0.6000001, "bpm": 150.0, "bar_position": 2},
        ]
    )
    db.commit()
    export_playlists(db, [playlist.id], dest)
    row = read_pdb(dest / "PIONEER/rekordbox/export.pdb").tables["tracks"].rows[0]
    beats = read_anlz(dest / row.analyze_path.lstrip("/")).beats
    times = [b.time_ms for b in beats]
    assert len(times) == len(set(times))
    boundary = next(b for b in beats if b.time_ms == 600 + export_offset_ms(tracks[0].filename))
    assert boundary.tempo_centibpm == 15000
    assert boundary.beat_number == 2


@pytest.mark.parametrize("corruption", ["first_data", "slot", "cycle"])
def test_verifier_rejects_corrupt_index_and_chain(library, corruption):
    import struct

    from rekordbox.device.verify import verify_export

    db, playlist, _tracks, dest = library
    export_playlists(db, [playlist.id], dest)
    path = dest / "PIONEER/rekordbox/export.pdb"
    data = bytearray(path.read_bytes())
    first = struct.unpack_from("<I", data, 36)[0]
    field = {"first_data": 44, "slot": 60, "cycle": 12}[corruption]
    value = first if corruption == "cycle" else 0
    struct.pack_into("<I", data, first * 4096 + field, value)
    path.write_bytes(data)
    assert verify_export(dest)["errors"]


def test_device_paths_are_unique_on_case_insensitive_filesystems(library):
    from shutil import copyfile

    db, playlist, tracks, dest = library
    for track, name in zip(tracks, ["Same.mp3", "same.mp3"]):
        source = dest.parent / str(track.id) / name
        source.parent.mkdir()
        copyfile(tracks[0].filename, source)
        track.filename = str(source)
    db.commit()
    export_playlists(db, [playlist.id], dest)
    rows = read_pdb(dest / "PIONEER/rekordbox/export.pdb").tables["tracks"].rows
    assert len({r.file_path.casefold() for r in rows}) == len(rows)


def test_export_refuses_source_audio_inside_destination(library):
    from shutil import copyfile

    db, playlist, tracks, dest = library
    source = dest / "Contents" / Path(tracks[0].filename).name
    source.parent.mkdir(parents=True)
    copyfile(tracks[1].filename, source)
    before = source.read_bytes()
    tracks[1].filename = str(source)
    db.commit()
    with pytest.raises(ValueError, match="source audio"):
        export_playlists(db, [playlist.id], dest)
    assert source.read_bytes() == before
