"""Tests for the Engine device exporter + verifier (#268).

Everything runs on decoy fixtures: tone/silence WAVs copied from
tests/fixtures into tmp_path, in-memory manadj DBs (alembic schema via
the `db` conftest fixture), and synthetic donor libraries built from
the packaged verbatim 3.0.1 DDL. No real media, apps, or libraries.
"""

from __future__ import annotations

import json
import shutil
import sqlite3
import struct
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.models import (
    Beatgrid,
    HotCue,
    Playlist,
    PlaylistTrack,
    Track,
    Waveform,
)
from enginedj.device_export import (
    DeviceExportError,
    DeviceExportOptions,
    DeviceFilesystem,
    ENGINE_LIBRARY_DIR,
    MARKER_NAME,
    create_device_database,
    export_device_library,
    validate_dest,
)
from enginedj.device_verify import verify_device_library
from enginedj.models.album_art import AlbumArt as EngineAlbumArt
from enginedj.models.performance_data import PerformanceData as EnginePerf
from enginedj.models.track import Track as EngineTrack
from enginedj.performance_blobs import (
    BeatData,
    EngineHotCue,
    GridMarker,
    QuickCues,
    TrackData,
    encode_beat_data,
    encode_quick_cues,
    encode_track_data,
    parse_beat_data,
    parse_quick_cues,
    parse_track_data,
    q_compress,
)

FIXTURES = Path(__file__).parent / "fixtures"
SR = 44100.0
DONOR_UUID = "99999999-9999-9999-9999-999999999999"
DONOR_LOUDNESS = [0.51, 0.62, 0.73]


def _tone(tmp_path: Path, name: str) -> Path:
    src_dir = tmp_path / "src"
    src_dir.mkdir(exist_ok=True)
    dest = src_dir / name
    shutil.copy(FIXTURES / "tone_1500hz.wav", dest)
    return dest


def _encode_overview(points: int = 16) -> bytes:
    """Overview waveform blob per the #267-researched format: i64 BE
    count x2, f64 BE samples/point, count x 3 bytes, 3-byte maximum."""
    body = struct.pack(">qqd", points, points, SR / points)
    for i in range(points):
        body += bytes((i % 200, (i * 2) % 200, (i * 3) % 200))
    body += bytes((199, 199, 199))
    return q_compress(body)


def _encode_loops() -> bytes:
    label = b"Loop 1"
    out = struct.pack("<q", 1)
    out += bytes((len(label),)) + label
    out += struct.pack("<dd", 0.25 * SR, 0.75 * SR)
    out += bytes((1, 1))
    out += bytes.fromhex("ff00ff00")
    return out


@pytest.fixture
def library(db, tmp_path):
    """A small manadj library: three exportable tracks (one outside all
    playlists), one archived, one with a missing source file."""
    tracks = {}
    for name in ("alpha.wav", "bravo.wav", "charlie.wav"):
        path = _tone(tmp_path, name)
        track = Track(
            filename=str(path),
            title=name.removesuffix(".wav").title(),
            artist="Decoy Artist",
            bpm=12800,  # centibpm
            key=5,
            energy=4,
            duration_secs=1.0,
            cue_point_time=0.125,
            filesize_bytes=path.stat().st_size,
            bitrate_kbps=1411,
        )
        db.add(track)
        db.flush()
        db.add(
            Waveform(
                track_id=track.id, sample_rate=int(SR), duration=1.0, samples_per_peak=512
            )
        )
        db.add(
            Beatgrid(
                track_id=track.id,
                tempo_changes_json=json.dumps(
                    [{"start_time": 0.05, "bpm": 128.0, "bar_position": 1}]
                ),
                origin="edited",
            )
        )
        db.add(HotCue(track_id=track.id, slot_number=1, time_seconds=0.25,
                      label="Drop", color="#FF8800"))
        db.add(HotCue(track_id=track.id, slot_number=3, time_seconds=0.5,
                      label="Out", color="#00FF88"))
        tracks[name] = track

    archived = Track(filename=str(_tone(tmp_path, "zulu.wav")), title="Zulu")
    db.add(archived)
    db.flush()
    from datetime import datetime

    archived.archived_at = datetime.now()
    ghost = Track(filename=str(tmp_path / "src" / "ghost.wav"), title="Ghost")
    db.add(ghost)
    db.flush()

    # Two playlists; order deliberately different from insertion order.
    # charlie stays outside every playlist.
    playlist_a = Playlist(name="set one", display_order=0)
    playlist_b = Playlist(name="set two", display_order=1)
    db.add_all([playlist_a, playlist_b])
    db.flush()
    db.add_all(
        [
            PlaylistTrack(playlist_id=playlist_a.id,
                          track_id=tracks["bravo.wav"].id, position=0),
            PlaylistTrack(playlist_id=playlist_a.id,
                          track_id=tracks["alpha.wav"].id, position=1),
            PlaylistTrack(playlist_id=playlist_a.id, track_id=ghost.id, position=2),
            PlaylistTrack(playlist_id=playlist_b.id,
                          track_id=tracks["alpha.wav"].id, position=0),
        ]
    )
    db.commit()
    return {
        "session": db,
        "tracks": tracks,
        "archived": archived,
        "ghost": ghost,
        "tmp_path": tmp_path,
    }


@pytest.fixture
def donor(tmp_path):
    """A synthetic native analyzed Engine library whose one track matches
    alpha.wav by basename. Carries analysis state manadj cannot know."""
    database_dir = tmp_path / "donor" / "Database2"
    database_dir.mkdir(parents=True)
    create_device_database(database_dir / "m.db", DONOR_UUID)
    engine = create_engine(f"sqlite:///{database_dir / 'm.db'}")
    session = sessionmaker(bind=engine)()
    art = EngineAlbumArt(hash="d0n0r4r7", albumArt=b"\x89PNG-decoy-art")
    session.add(art)
    session.flush()
    markers = [
        GridMarker(sample_offset=-4 * SR * 60 / 120, beat_index=-4, beats_to_next=4),
        GridMarker(sample_offset=0.0, beat_index=0, beats_to_next=0),
        GridMarker(sample_offset=SR, beat_index=2, beats_to_next=0),
    ]
    track = EngineTrack(
        path="../Music/alpha.wav",
        filename="alpha.wav",
        fileType="wav",
        fileBytes=1234,
        album="Donor Album",
        year=2020,
        bpmAnalyzed=127.95,
        albumArtId=art.id,
        isAnalyzed=True,
        rating=0,
        streamingFlags=0,
        pdbImportKey=0,
        explicitLyrics=False,
    )
    session.add(track)
    session.flush()
    perf = session.get(EnginePerf, track.id) or EnginePerf(trackId=track.id)
    perf.beatData = encode_beat_data(
        BeatData(
            sample_rate=SR,
            track_length_samples=SR,
            default_grid=markers,
            adjusted_grid=markers,
            is_set=True,
            tail=b"\x03" + b"\0" * 8,
        )
    )
    perf.quickCues = encode_quick_cues(
        QuickCues(
            hot_cues=[
                # Slot 1 collides with manadj's cue (manadj must win);
                # slot 6 is donor-only (must be preserved).
                EngineHotCue(slot=0, label="Donor 1", sample_offset=0.9 * SR,
                             color_hex="#123456"),
                EngineHotCue(slot=5, label="Donor 6", sample_offset=0.8 * SR,
                             color_hex="#654321"),
            ],
            main_cue_samples=0.7 * SR,
            main_cue_overridden=True,
            default_cue_samples=0.1 * SR,
        )
    )
    perf.trackData = encode_track_data(
        TrackData(sample_rate=SR, track_length_samples=int(SR), key=20,
                  loudness=list(DONOR_LOUDNESS))
    )
    perf.overviewWaveFormData = _encode_overview()
    perf.loops = _encode_loops()
    session.add(perf)
    session.commit()
    session.close()
    engine.dispose()
    return database_dir


def _export(library, dest=None, **kwargs):
    dest = dest or library["tmp_path"] / "device"
    options = DeviceExportOptions(dest_root=dest, **kwargs)
    report = export_device_library(library["session"], options)
    return dest, report


def _connect(dest: Path) -> sqlite3.Connection:
    return sqlite3.connect(
        f"file:{dest / ENGINE_LIBRARY_DIR / 'Database2' / 'm.db'}?mode=ro", uri=True
    )


def _device_rows(dest: Path) -> dict[str, dict]:
    conn = _connect(dest)
    try:
        rows = {}
        for row in conn.execute(
            "SELECT t.id, t.path, t.filename, t.title, t.key, t.rating, t.album, "
            "t.year, t.isAnalyzed, t.originDatabaseUuid, t.originTrackId, "
            "p.beatData, p.quickCues, p.trackData, p.overviewWaveFormData, p.loops "
            "FROM Track t JOIN PerformanceData p ON p.trackId = t.id"
        ):
            keys = (
                "id", "path", "filename", "title", "key", "rating", "album", "year",
                "isAnalyzed", "originDatabaseUuid", "originTrackId",
                "beatData", "quickCues", "trackData", "overview", "loops",
            )
            rows[row[2]] = dict(zip(keys, row))
        return rows
    finally:
        conn.close()


def _playlist_orders(dest: Path) -> dict[str, list[str]]:
    """title -> device track filenames in linked-list order."""
    conn = _connect(dest)
    try:
        filenames = dict(conn.execute("SELECT id, filename FROM Track"))
        orders = {}
        for list_id, title in conn.execute("SELECT id, title FROM Playlist"):
            ents = conn.execute(
                "SELECT id, trackId, nextEntityId FROM PlaylistEntity WHERE listId=?",
                (list_id,),
            ).fetchall()
            nexts = {e[0]: e[2] for e in ents}
            track_of = {e[0]: e[1] for e in ents}
            heads = set(nexts) - {n for n in nexts.values() if n}
            order = []
            current = heads.pop() if len(heads) == 1 else None
            while current:
                order.append(filenames[track_of[current]])
                current = nexts[current]
            orders[title] = order
        return orders
    finally:
        conn.close()


# --- export basics ---------------------------------------------------------


def test_export_layout_and_coverage(library):
    dest, report = _export(library)
    assert (dest / ENGINE_LIBRARY_DIR / "Database2" / "m.db").is_file()
    marker = json.loads((dest / ENGINE_LIBRARY_DIR / MARKER_NAME).read_text())
    assert marker["library_uuid"] == report.library_uuid

    rows = _device_rows(dest)
    # three exportable tracks, incl. charlie (outside every playlist)
    assert set(rows) == {"alpha.wav", "bravo.wav", "charlie.wav"}
    # archived + missing-file rows are skipped, and reported
    statuses = {t.manadj_id: t.status for t in report.tracks}
    assert statuses[library["ghost"].id] == "skipped: source file missing"
    assert library["archived"].id not in statuses
    assert report.exported == 3
    # audio copied portable, path relative
    for row in rows.values():
        assert row["path"].startswith("../manadj/")
        audio = (dest / ENGINE_LIBRARY_DIR / row["path"]).resolve()
        assert audio.is_file()


def test_playlist_order_and_flags(library):
    dest, report = _export(library)
    orders = _playlist_orders(dest)
    # ghost was skipped; exact source order preserved for the rest
    assert orders["set one"] == ["bravo.wav", "alpha.wav"]
    assert orders["set two"] == ["alpha.wav"]
    assert report.skipped_playlist_entries == 1

    conn = _connect(dest)
    try:
        flags = conn.execute(
            "SELECT isPersisted, isExplicitlyExported, parentListId FROM Playlist"
        ).fetchall()
        assert flags and all(f == (1, 1, 0) for f in flags)
        # sibling chain follows manadj display order
        chain = dict(conn.execute("SELECT title, nextListId FROM Playlist"))
        ids = dict(conn.execute("SELECT title, id FROM Playlist"))
        assert chain["set one"] == ids["set two"]
        assert chain["set two"] == 0
    finally:
        conn.close()


def test_cue_and_grid_projection_without_donor(library):
    dest, _ = _export(library)
    rows = _device_rows(dest)
    for row in rows.values():
        # no donor: no invented analysis state
        assert row["trackData"] is None
        assert row["overview"] is None
        assert row["loops"] is None
        assert row["isAnalyzed"] == 0
        assert row["key"] == 5
        assert row["rating"] == 80  # energy 4

        quick = parse_quick_cues(row["quickCues"])
        by_slot = {c.slot: c for c in quick.hot_cues}
        assert by_slot[0].sample_offset == pytest.approx(0.25 * SR)
        assert by_slot[0].label == "Drop"
        assert by_slot[2].sample_offset == pytest.approx(0.5 * SR)
        assert quick.main_cue_samples == pytest.approx(0.125 * SR)
        assert quick.main_cue_overridden

        beat = parse_beat_data(row["beatData"])
        assert beat.sample_rate == SR
        assert beat.adjusted_grid[0].beat_index == -4
        # projection equality is asserted structurally by the verifier below


def test_verify_passes_and_projects(library):
    dest, _ = _export(library)
    report = verify_device_library(dest, library["session"])
    failed = [c for c in report.checks if not c.ok]
    assert report.ok, failed


# --- donor projection ------------------------------------------------------


def test_donor_projection(library, donor):
    dest, report = _export(library, donor_database_dir=donor)
    rows = _device_rows(dest)

    alpha = rows["alpha.wav"]
    # loudness verbatim, key patched to manadj's
    track_data = parse_track_data(alpha["trackData"])
    assert track_data.loudness == pytest.approx(DONOR_LOUDNESS)
    assert track_data.key == 5
    # overview + loops byte-verbatim
    assert alpha["overview"] == _encode_overview()
    assert alpha["loops"] == _encode_loops()
    # manadj wins contested slot 1; donor-only slot 6 preserved; manadj main cue wins
    quick = parse_quick_cues(alpha["quickCues"])
    by_slot = {c.slot: c for c in quick.hot_cues}
    assert by_slot[0].label == "Drop"
    assert by_slot[0].sample_offset == pytest.approx(0.25 * SR)
    assert by_slot[5].label == "Donor 6"
    assert quick.main_cue_samples == pytest.approx(0.125 * SR)
    # manadj grid wins over donor grid; donor tail preserved
    beat = parse_beat_data(alpha["beatData"])
    assert beat.tail == b"\x03" + b"\0" * 8
    # absent-source fills
    assert alpha["album"] == "Donor Album"
    assert alpha["year"] == 2020
    # manadj-set metadata untouched
    assert alpha["title"] == "Alpha"
    # full five-blob row => analyzed
    assert alpha["isAnalyzed"] == 1

    # unmatched tracks unaffected by the donor
    bravo = rows["bravo.wav"]
    assert bravo["trackData"] is None
    assert bravo["isAnalyzed"] == 0

    # donor album art copied and referenced
    conn = _connect(dest)
    try:
        art = conn.execute(
            "SELECT a.hash, a.albumArt FROM Track t JOIN AlbumArt a ON a.id=t.albumArtId "
            "WHERE t.filename='alpha.wav'"
        ).fetchone()
        assert art == ("d0n0r4r7", b"\x89PNG-decoy-art")
    finally:
        conn.close()

    verify = verify_device_library(dest, library["session"])
    assert verify.ok, [c for c in verify.checks if not c.ok]


def test_freshness_no_stale_uuids_or_paths(library, donor):
    dest, report = _export(library, donor_database_dir=donor)
    conn = _connect(dest)
    try:
        (info_uuid,) = conn.execute("SELECT uuid FROM Information").fetchone()
        assert info_uuid == report.library_uuid != DONOR_UUID
        origin = {u for (u,) in conn.execute("SELECT DISTINCT originDatabaseUuid FROM Track")}
        entity = {u for (u,) in conn.execute("SELECT DISTINCT databaseUuid FROM PlaylistEntity")}
        assert origin == entity == {info_uuid}
        for (path,) in conn.execute("SELECT path FROM Track"):
            assert path.startswith("../manadj/")
    finally:
        conn.close()

    # re-export over our own output regenerates the uuid wholesale
    dest2, report2 = _export(library, dest=dest, overwrite=True)
    assert report2.library_uuid != report.library_uuid


# --- safety ----------------------------------------------------------------


def test_refuses_protected_destinations(library):
    fs = DeviceFilesystem()
    for bad in (Path("/Volumes/REROLL SD"), Path.home() / "Music" / "x",
                Path.home() / "Library" / "x"):
        with pytest.raises(DeviceExportError, match="protected root"):
            validate_dest(DeviceExportOptions(dest_root=bad), fs)


def test_refuses_symlinked_escape(library, tmp_path):
    link = tmp_path / "sneaky"
    link.symlink_to(Path.home() / "Music")
    with pytest.raises(DeviceExportError, match="protected root"):
        validate_dest(DeviceExportOptions(dest_root=link / "device"), DeviceFilesystem())


def test_refuses_foreign_engine_library(library, tmp_path):
    dest = tmp_path / "foreign"
    (dest / ENGINE_LIBRARY_DIR / "Database2").mkdir(parents=True)
    with pytest.raises(DeviceExportError, match="already exists"):
        _export(library, dest=dest)
    with pytest.raises(DeviceExportError, match="never clobber"):
        _export(library, dest=dest, overwrite=True)


def test_refuses_when_out_of_space(library):
    class TinyDisk(DeviceFilesystem):
        def free_bytes(self, path):
            return 1024

    with pytest.raises(DeviceExportError, match="free at"):
        export_device_library(
            library["session"],
            DeviceExportOptions(dest_root=library["tmp_path"] / "device"),
            fs=TinyDisk(),
        )


def test_readback_integrity_failure_aborts(library, monkeypatch):
    def corrupt_copy(src, dst):
        Path(dst).write_bytes(b"corrupted")

    monkeypatch.setattr("enginedj.device_export.shutil.copyfile", corrupt_copy)
    with pytest.raises(DeviceExportError, match="read-back integrity"):
        _export(library)


# --- verifier detects damage ----------------------------------------------


def test_verify_detects_damage(library):
    dest, _ = _export(library)

    # truncate one audio file -> size mismatch
    audio = next((dest / "manadj").rglob("*.wav"))
    original = audio.read_bytes()
    audio.write_bytes(original[: len(original) // 2])
    report = verify_device_library(dest)
    assert not report.ok
    assert any("fileBytes" in c.name and not c.ok for c in report.checks)
    audio.write_bytes(original)

    # missing audio
    moved = audio.with_suffix(".hidden")
    audio.rename(moved)
    report = verify_device_library(dest)
    assert any("audio files exist" in c.name and not c.ok for c in report.checks)
    moved.rename(audio)

    # break an entity linked list + inject a foreign uuid
    db_path = dest / ENGINE_LIBRARY_DIR / "Database2" / "m.db"
    conn = sqlite3.connect(db_path)
    conn.execute("UPDATE PlaylistEntity SET nextEntityId = id")  # cycles
    conn.execute("UPDATE PlaylistEntity SET databaseUuid = 'f0r31gn' WHERE id = 1")
    conn.commit()
    conn.close()
    report = verify_device_library(dest)
    assert any("entity linked lists" in c.name and not c.ok for c in report.checks)
    assert any("single library uuid" in c.name and not c.ok for c in report.checks)


def test_verify_flags_order_drift(library):
    dest, _ = _export(library)
    db_path = dest / ENGINE_LIBRARY_DIR / "Database2" / "m.db"
    conn = sqlite3.connect(db_path)
    # swap the two entities of "set one" by re-pointing the chain
    (list_id,) = conn.execute("SELECT id FROM Playlist WHERE title='set one'").fetchone()
    ents = conn.execute(
        "SELECT id, trackId FROM PlaylistEntity WHERE listId=? ORDER BY id", (list_id,)
    ).fetchall()
    a, b = ents[0][0], ents[1][0]
    conn.execute("UPDATE PlaylistEntity SET nextEntityId=? WHERE id=?", (a, b))
    conn.execute("UPDATE PlaylistEntity SET nextEntityId=0 WHERE id=?", (a,))
    conn.commit()
    conn.close()
    report = verify_device_library(dest, library["session"])
    assert any("exact playlist order" in c.name and not c.ok for c in report.checks)


# --- CLI -------------------------------------------------------------------


def test_cli_export_and_verify(library, tmp_path, capsys, monkeypatch):
    import importlib.util
    from types import SimpleNamespace

    spec = importlib.util.spec_from_file_location(
        "engine_usb_cli", Path(__file__).parent.parent / "scripts" / "engine_usb.py"
    )
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)

    # Pin the export gate open (ADR 0043) — don't depend on the repo config.
    import backend.config as backend_config

    monkeypatch.setattr(
        backend_config,
        "get_config",
        lambda: SimpleNamespace(export=SimpleNamespace(enabled=True)),
    )

    # a file-backed manadj db for the CLI
    manadj_db = tmp_path / "manadj.db"
    file_engine = create_engine(f"sqlite:///{manadj_db}")
    from backend.models import Base

    Base.metadata.create_all(file_engine)
    file_session = sessionmaker(bind=file_engine)()
    src = _tone(tmp_path, "delta.wav")
    file_session.add(Track(filename=str(src), title="Delta", duration_secs=1.0))
    file_session.commit()
    file_session.close()
    file_engine.dispose()

    dest = tmp_path / "cli-device"
    assert cli.main(["export", "--dest", str(dest), "--manadj-db", str(manadj_db)]) == 0
    assert cli.main(["verify", "--dest", str(dest), "--manadj-db", str(manadj_db)]) == 0
    out = capsys.readouterr().out
    assert "exported 1 tracks" in out
    assert "OK" in out

    # refusal exit code
    assert cli.main(
        ["export", "--dest", "/Volumes/REROLL SD", "--manadj-db", str(manadj_db)]
    ) == 2

    # export gate closed (ADR 0043): device export refuses before any write
    monkeypatch.setattr(
        backend_config,
        "get_config",
        lambda: SimpleNamespace(export=SimpleNamespace(enabled=False)),
    )
    gated_dest = tmp_path / "gated-device"
    assert cli.main(
        ["export", "--dest", str(gated_dest), "--manadj-db", str(manadj_db)]
    ) == 2
    assert not gated_dest.exists()
