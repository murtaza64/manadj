"""Offline native-layout ANLZ fixtures; no corpus or user library access."""
# ruff: noqa: F811
import struct
from pathlib import Path

import pytest
from pyrekordbox.anlz import AnlzFile

from backend.routers import sync_export
from rekordbox.device import anlz_write as aw
from rekordbox.perf_export import RekordboxPerfExporter
from tests.test_playlist_export_integration import destinations, playlist_members  # noqa: F401


def native_pair(root):
    root.mkdir(parents=True, exist_ok=True)
    dat = root / "ANLZ0000.DAT"
    ext = dat.with_suffix(".EXT")
    # Captured native desktop layout. Non-cue payloads remain arbitrary decoys;
    # no source audio, waveform, or library metadata is copied from the user.
    common = [aw.PathSection("/decoy/Eyes Cut Deeper.mp3")]
    dat.write_bytes(aw.build_anlz([
        *common, aw.VbrSection(), aw.BeatGridSection([aw.Beat(1, 12800, 100)]),
        aw.WavePreviewSection(b"PWAV", bytes(range(100)) * 4),
        aw.WavePreviewSection(b"PWV2", bytes(range(100))),
        aw.CueListSection(1), aw.CueListSection(0),
    ]))
    ext.write_bytes(aw.build_anlz([
        *common, aw.WaveEntrySection(b"PWV3", b"\x01\x02\x03"),
        aw.CueListSection(1), aw.CueListSection(0),
        aw.CueExtendedListSection(1), aw.CueExtendedListSection(0),
        aw.RawSection(b"PQT2", 56, (
            b"\x00" * 4 + struct.pack(">I", 0x01000002) + b"\x00" * 4
            + struct.pack(">HHIHHI", 1, 12800, 100, 4, 12800, 1000)
            + struct.pack(">IIII", 1, 0, 0, 0) + b"\x01\x00"
        )),
        aw.WaveEntrySection(b"PWV5", b"\x01\x02"),
        aw.WaveEntrySection(b"PWV4", b"\x01\x02\x03\x04\x05\x06"),
        aw.RawSection(b"ZZZZ", 12, b"unknown native bytes\x00\xff"),
    ]))
    return dat, ext


def blocks(data):
    header_len = struct.unpack_from(">I", data, 4)[0]
    offset = header_len
    result = []
    while offset < len(data):
        size = struct.unpack_from(">I", data, offset + 8)[0]
        result.append(data[offset:offset + size])
        offset += size
    assert offset == len(data)
    return result


def cue_times(path, kind):
    parsed = AnlzFile.parse_file(str(path))
    tags = parsed.getall_tags(kind)
    return [(int(t.struct.content.cue_type if kind == "PCOB" else t.struct.content.type), int(e.hot_cue), int(e.time))
            for t in tags for e in t.struct.content.entries]


def test_real_export_repairs_empty_native_cues_even_when_db_already_correct(
    db, destinations, playlist_members
):
    playlist, tracks = playlist_members(["cue.mp3"])
    track = tracks[0]
    rb = destinations.rb
    content = rb.add_content(track.filename, Title="Decoy")
    dat, ext = native_pair(Path(destinations.config.database.rekordbox_path) / "share" / "decoy")
    content.AnalysisDataPath = "/decoy/ANLZ0000.DAT"
    rb.commit(autoinc=True)
    exporter = RekordboxPerfExporter(rb, destinations.config.database.rekordbox_path)
    before = {p: p.read_bytes() for p in (dat, ext)}
    cues = [(1, 0.1, "First", "#FF0000"), (4, 0.3, "Fourth", None)]
    exporter.export_hotcues(track.filename, cues, "replace-all")
    assert len(cue_times(dat, "PCOB")) == 3  # A plus two memory twins
    assert len(cue_times(ext, "PCOB")) == 3  # D plus two memory twins
    assert len(cue_times(ext, "PCO2")) == 4
    once = {p: p.read_bytes() for p in (dat, ext)}
    for p in (dat, ext):
        assert [b for b in blocks(before[p]) if b[:4] not in (b"PCOB", b"PCO2")] == [
            b for b in blocks(once[p]) if b[:4] not in (b"PCOB", b"PCO2")]
    # DB already agrees but native file reverted to the observed empty state.
    for p in (dat, ext):
        p.write_bytes(before[p])
    exporter.export_hotcues(track.filename, cues, "replace-all")
    assert {p: p.read_bytes() for p in (dat, ext)} == once
    exporter.export_hotcues(track.filename, cues, "replace-all")
    assert {p: p.read_bytes() for p in (dat, ext)} == once


@pytest.fixture
def native_export(destinations, playlist_members):
    _playlist, tracks = playlist_members(["native.mp3"])
    track = tracks[0]
    content = destinations.rb.add_content(track.filename, Title="Native decoy")
    dat, ext = native_pair(Path(destinations.config.database.rekordbox_path) / "share" / "native")
    content.AnalysisDataPath = "/native/ANLZ0000.DAT"
    destinations.rb.commit(autoinc=True)
    return (RekordboxPerfExporter(destinations.rb, destinations.config.database.rekordbox_path),
            track, content, dat, ext, destinations.rb)


def test_maincue_overlap_move_and_clear_mirrors_native_pair(native_export):
    from rekordbox.decode_offset import manadj_seconds_to_rb_ms

    exporter, track, content, dat, ext, rb = native_export
    exporter.export_hotcues(track.filename, [(1, 0.1, "First", None)], "replace-all")
    assert exporter.export_maincue(track.filename, 0.1) is False  # existing twin
    assert len(cue_times(ext, "PCO2")) == 2
    assert exporter.export_maincue(track.filename, 0.2) is True
    assert len(cue_times(ext, "PCO2")) == 3
    assert exporter.export_maincue(track.filename, 0.3) is True
    ms = manadj_seconds_to_rb_ms(0.3, track.filename)
    assert (0, 0, ms) in cue_times(ext, "PCO2")
    assert len(cue_times(ext, "PCO2")) == 3  # no old Main cue left
    exporter.export_maincue(track.filename, None)
    assert len(cue_times(ext, "PCO2")) == 2  # hot/memory twin remains
    exporter.export_hotcues(track.filename, [], "replace-all")
    exporter.export_maincue(track.filename, None)
    assert cue_times(dat, "PCOB") == cue_times(ext, "PCOB") == cue_times(ext, "PCO2") == []


def test_captured_halloween_times_and_noncue_bytes_preserved(tmp_path):
    from rekordbox.anlz_cues import NativeCue, sync_cue_files
    from rekordbox.device.anlz_read import read_anlz

    dat, ext = native_pair(tmp_path)
    times = [27640, 49709, 60744, 71778]
    cues = [NativeCue(i, ms) for i, ms in enumerate(times, 1)] + [NativeCue(0, ms) for ms in times]
    before = {p: p.read_bytes() for p in (dat, ext)}
    assert sync_cue_files(dat, cues) == [dat.name, ext.name]
    parsed = read_anlz(ext)
    assert [(c.hot_cue, c.time_ms) for c in parsed.cues_extended] == [
        (1, 27640), (2, 49709), (3, 60744), (4, 71778),
        (0, 27640), (0, 49709), (0, 60744), (0, 71778),
    ]
    # Main cue 49709 overlaps its hot-cue twin: no duplicate memory row.
    assert len(parsed.cues_extended) == 8
    for p in (dat, ext):
        after = p.read_bytes()
        assert before[p][:8] == after[:8]
        assert before[p][12:28] == after[12:28]
        assert struct.unpack_from(">I", after, 8)[0] == len(after)
        assert [b for b in blocks(before[p]) if b[:4] not in (b"PCOB", b"PCO2")] == [
            b for b in blocks(after) if b[:4] not in (b"PCOB", b"PCO2")]
    assert sync_cue_files(dat, cues) == []


def test_extended_comments_colors_and_loops_are_readable(tmp_path):
    from rekordbox.anlz_cues import NativeCue, sync_cue_files
    from rekordbox.device.anlz_read import read_anlz

    dat, ext = native_pair(tmp_path)
    sync_cue_files(dat, [NativeCue(4, 1000, 2000, "Drop \u266b", 1), NativeCue(0, 1000, 2000, "Drop \u266b", 1)])
    parsed = read_anlz(ext)
    hot, memory = parsed.cues_extended
    assert hot.hot_cue == 4 and hot.loop_time_ms == 2000
    assert hot.comment.rstrip("\x00") == "Drop \u266b"
    assert hot.color_code == 42 and hot.color_rgb == (228, 43, 43)
    assert memory.color_id == 2 and memory.color_rgb == (0, 0, 0)


@pytest.mark.parametrize("fault", ["missing-ext", "invalid-ext", "invalid-dat"])
def test_invalid_pair_leaves_both_files_untouched_and_reports_db_commit(native_export, fault):
    from pyrekordbox.db6.tables import DjmdCue
    from rekordbox.anlz_cues import CueAnalysisSyncError

    exporter, track, content, dat, ext, rb = native_export
    if fault == "missing-ext":
        ext.unlink()  # only this test's generated decoy
    elif fault == "invalid-ext":
        ext.write_bytes(b"invalid decoy")
    else:
        original = bytearray(dat.read_bytes())
        struct.pack_into(">I", original, 8, len(original) - 1)
        dat.write_bytes(original)
    before = {p: p.read_bytes() for p in (dat, ext) if p.exists()}
    with pytest.raises(CueAnalysisSyncError, match="Cue DB committed; native DAT/EXT not synchronized"):
        exporter.export_hotcues(track.filename, [(1, 0.1, "Saved DB", None)], "replace-all")
    assert {p: p.read_bytes() for p in before} == before
    assert rb.session.query(DjmdCue).filter(DjmdCue.rb_local_deleted == 0).count() == 2


def test_no_anlz_is_explicit_but_keeps_committed_cues(destinations, playlist_members):
    from pyrekordbox.db6.tables import DjmdCue
    from rekordbox.anlz_cues import CueAnalysisSyncError

    _playlist, tracks = playlist_members(["no-analysis.mp3"])
    track = tracks[0]
    destinations.rb.add_content(track.filename, Title="No analysis")
    destinations.rb.commit(autoinc=True)
    exporter = RekordboxPerfExporter(destinations.rb, destinations.config.database.rekordbox_path)
    with pytest.raises(CueAnalysisSyncError, match="Cue DB committed.*no ANLZ analysis"):
        exporter.export_hotcues(track.filename, [(1, 0.1, "Saved DB", None)], "replace-all")
    assert destinations.rb.session.query(DjmdCue).filter(DjmdCue.rb_local_deleted == 0).count() == 2


def test_second_replace_failure_reports_partial_pair_and_cleans_temps(tmp_path, monkeypatch):
    import rekordbox.anlz_cues as native

    dat, ext = native_pair(tmp_path)
    ext_before = ext.read_bytes()
    replace = native.os.replace

    def fail_second(source, dest):
        if dest == ext:
            raise OSError("decoy replacement failed")
        return replace(source, dest)

    monkeypatch.setattr(native.os, "replace", fail_second)
    with pytest.raises(native.CueAnalysisSyncError, match="already updated: ANLZ0000.DAT"):
        native.sync_cue_files(dat, [native.NativeCue(1, 123)])
    assert cue_times(dat, "PCOB") == [(1, 1, 123)]
    assert ext.read_bytes() == ext_before
    assert list(tmp_path.glob(".manadj-cues-*")) == []


def test_stage_failure_does_not_replace_either_native_file(tmp_path, monkeypatch):
    import rekordbox.anlz_cues as native

    dat, ext = native_pair(tmp_path)
    before = {p: p.read_bytes() for p in (dat, ext)}

    def refuse(*args, **kwargs):
        raise PermissionError("decoy cannot stage")

    monkeypatch.setattr(native.tempfile, "NamedTemporaryFile", refuse)
    with pytest.raises(native.CueAnalysisSyncError, match="decoy cannot stage"):
        native.sync_cue_files(dat, [native.NativeCue(1, 123)])
    assert {p: p.read_bytes() for p in (dat, ext)} == before


def test_actual_full_writer_no_anlz_keeps_addition_but_fails_cue_readiness(
    db, destinations, playlist_members, monkeypatch
):
    from backend.models import HotCue
    from backend.playlist_full_export import PlaylistExportTargetRunner, RekordboxPlaylistWriter
    from rekordbox.tag_sync import RekordboxTagSyncer
    import rekordbox.mappings

    monkeypatch.setattr(RekordboxTagSyncer, "sync_tag_structure", lambda *a, **k: ({}, {}, {}))
    monkeypatch.setattr(RekordboxTagSyncer, "sync_track_tags_and_colors", lambda *a, **k: None)
    monkeypatch.setattr(rekordbox.mappings, "build_energy_color_map", lambda *a: {})
    playlist, tracks = playlist_members(["new.mp3"])
    db.add(HotCue(track_id=tracks[0].id, slot_number=1, time_seconds=0.1, label="DB saved"))
    tracks[0].cue_point_time = 0.2
    db.commit()
    report = PlaylistExportTargetRunner(RekordboxPlaylistWriter(
        db, destinations.rb, destinations.config.database.rekordbox_path
    )).export(playlist, tracks)
    assert report["tracks_added"] == ["new.mp3"]
    assert report["tracks_failed"] == 1
    fields = report["tracks"][0]["fields"]
    assert fields["playlist"] == "exported"
    assert fields["hotcues"].startswith("failed: Cue DB committed; native DAT/EXT not synchronized")
    assert fields["maincue"].startswith("failed: Cue DB committed; native DAT/EXT not synchronized")


def test_actual_hotcue_route_returns_explicit_partial_failure(db, destinations, playlist_members):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.models import HotCue

    _playlist, tracks = playlist_members(["no-analysis.mp3"])
    track = tracks[0]
    db.add(HotCue(track_id=track.id, slot_number=1, time_seconds=0.1))
    db.commit()
    destinations.rb.add_content(track.filename, Title="Decoy no analysis")
    destinations.rb.commit(autoinc=True)
    exporter = RekordboxPerfExporter(destinations.rb, destinations.config.database.rekordbox_path)
    app = FastAPI()
    app.include_router(sync_export.router)
    app.dependency_overrides[sync_export.get_db] = lambda: db
    app.dependency_overrides[sync_export.get_rekordbox_perf_exporter] = lambda: exporter
    app.dependency_overrides[sync_export.require_export_enabled] = lambda: None
    response = TestClient(app).post("/sync/export/hotcues/rekordbox", json={
        "track_id": track.id, "mode": "replace-all",
    })
    assert response.status_code == 409
    assert "Cue DB committed; native DAT/EXT not synchronized" in response.json()["detail"]


@pytest.mark.parametrize("escape", ["parent-path", "symlink"])
def test_analysis_path_must_stay_in_library_share(native_export, tmp_path, escape):
    from rekordbox.anlz_cues import CueAnalysisSyncError

    exporter, track, content, dat, ext, rb = native_export
    outside_dat, outside_ext = native_pair(tmp_path / "outside-decoy")
    before = {p: p.read_bytes() for p in (dat, ext, outside_dat, outside_ext)}
    if escape == "parent-path":
        import os

        content.AnalysisDataPath = os.path.relpath(outside_dat, exporter._db_dir / "share")
    else:
        dat.unlink()  # generated native decoy, never an actual asset
        dat.symlink_to(outside_dat)
    rb.commit(autoinc=True)
    with pytest.raises(CueAnalysisSyncError, match="escapes the Rekordbox share directory"):
        exporter.export_hotcues(track.filename, [(1, 0.1, "DB saved", None)], "replace-all")
    assert outside_dat.read_bytes() == before[outside_dat]
    assert outside_ext.read_bytes() == before[outside_ext]


def test_app_closed_and_backup_guards_precede_native_replacement(native_export, monkeypatch):
    from rekordbox import perf_export

    exporter, track, content, dat, ext, rb = native_export
    before = {p: p.read_bytes() for p in (dat, ext)}

    def refuse():
        raise perf_export.RekordboxRunningError("decoy app running")

    monkeypatch.setattr(perf_export, "ensure_rekordbox_closed", refuse)
    with pytest.raises(perf_export.RekordboxRunningError):
        exporter.export_hotcues(track.filename, [(1, 0.1, "Never saved", None)], "replace-all")
    assert {p: p.read_bytes() for p in (dat, ext)} == before
    monkeypatch.setattr(perf_export, "ensure_rekordbox_closed", lambda: None)

    def no_backup(*args):
        raise OSError("decoy backup failed")

    monkeypatch.setattr(perf_export, "snapshot_library", no_backup)
    with pytest.raises(OSError, match="decoy backup failed"):
        exporter.export_hotcues(track.filename, [(1, 0.1, "Never saved", None)], "replace-all")
    assert {p: p.read_bytes() for p in (dat, ext)} == before
