"""External drive pull: detection, read-only preview, confirmed additive import.

Rekordbox USB fixtures are synthesized through the repo's own pdb writer
(ADR 0004: no real export blobs in the repo); Engine fixtures come from the
verbatim device DDL (enginedj.device_export.create_device_database). Every
test asserts the drive tree is byte-identical afterwards — a pull never
writes to the source.
"""

import hashlib
import os
import shutil
import sqlite3
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend import external_drives
from backend.database import get_db
from backend.key import Key
from backend.models import Playlist, PlaylistTrack, Track
from backend.routers import external_drives as external_drives_router
from rekordbox.device.pdb_write import (
    ArtistRowSpec,
    KeyRowSpec,
    PlaylistEntryRowSpec,
    PlaylistTreeRowSpec,
    TableData,
    TrackRowSpec,
    build_pdb,
    encode_track_row,
    sql_string,
)

FIXTURES = Path(__file__).parent / "fixtures"

PAGE_TRACKS = 0
PAGE_ARTISTS = 2
PAGE_KEYS = 5
PAGE_PLAYLIST_TREE = 7
PAGE_PLAYLIST_ENTRIES = 8


def track_spec(track_id: int, title: str, device_path: str, **overrides) -> TrackRowSpec:
    strings = [sql_string("") for _ in range(21)]
    strings[14] = sql_string(f"/PIONEER/USBANLZ/P000/{track_id:08X}/ANLZ0000.DAT")
    strings[17] = sql_string(title)
    strings[19] = sql_string(device_path.rsplit("/", 1)[-1])
    strings[20] = sql_string(device_path)
    return TrackRowSpec(id=track_id, strings=strings, **overrides)


def make_rekordbox_usb(root: Path, tracks: list[TrackRowSpec]) -> Path:
    pdb_dir = root / "PIONEER" / "rekordbox"
    pdb_dir.mkdir(parents=True)
    tables = [
        TableData(PAGE_TRACKS, [encode_track_row(t) for t in tracks]),
        TableData(PAGE_ARTISTS, [ArtistRowSpec(id=1, name=sql_string("Lane 8")).encode()]),
        TableData(PAGE_KEYS, [KeyRowSpec(id=1, name=sql_string("Am")).encode()]),
    ]
    (pdb_dir / "export.pdb").write_bytes(build_pdb(tables))
    return root


def put_audio(usb: Path, device_path: str, fixture: str = "silence.mp3") -> Path:
    target = usb / device_path.lstrip("/")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(FIXTURES / fixture, target)
    return target


def tree_digest(root: Path) -> dict[str, str]:
    return {
        str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file() and not p.is_symlink()
    }


def make_engine_usb(root: Path, tracks: list[dict]) -> Path:
    database2 = root / "Engine Library" / "Database2"
    database2.mkdir(parents=True)
    from enginedj.device_export import create_device_database

    create_device_database(database2 / "m.db", "test-library-uuid")
    conn = sqlite3.connect(database2 / "m.db")
    try:
        for t in tracks:
            conn.execute(
                "INSERT INTO Track (path, filename, title, artist, bpm, bpmAnalyzed, key, length)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    t["path"],
                    t["path"].rsplit("/", 1)[-1],
                    t.get("title"),
                    t.get("artist"),
                    t.get("bpm"),
                    t.get("bpmAnalyzed"),
                    t.get("key"),
                    t.get("length"),
                ),
            )
        conn.commit()
    finally:
        conn.close()
    return root


@pytest.fixture
def usb(tmp_path: Path) -> Path:
    """Four tracks: one clean addition, one that tests can make present or
    uncertain, one name-twin for basename collisions, one without audio."""
    root = tmp_path / "REKORDBOX"
    root.mkdir()
    make_rekordbox_usb(
        root,
        [
            track_spec(
                1,
                "Bright Lights",
                "/Contents/track1.mp3",
                artist_id=1,
                key_id=1,
                tempo_centibpm=17400,
                duration_secs=362,
            ),
            track_spec(2, "Already Have", "/Contents/track2.mp3", artist_id=1),
            track_spec(3, "Ghost", "/Contents/ghost.mp3"),
            track_spec(4, "Name Twin", "/Contents/twin.mp3"),
        ],
    )
    put_audio(root, "/Contents/track1.mp3")
    put_audio(root, "/Contents/track2.mp3")
    put_audio(root, "/Contents/twin.mp3")
    # ghost.mp3 deliberately absent: the missing-file branch
    return root


@pytest.fixture
def client(db_session: Session) -> TestClient:
    app = FastAPI()
    app.include_router(external_drives_router.router, prefix="/api/external-drives")
    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


# --- detection ---------------------------------------------------------------


def test_detect_rekordbox_drive(usb: Path):
    drive = external_drives.detect_drive_at(usb)
    assert drive is not None
    assert drive.kind == "rekordbox"
    assert drive.track_count == 4


def test_detect_engine_drive(tmp_path: Path):
    root = tmp_path / "ENGINE_USB"
    root.mkdir()
    make_engine_usb(root, [{"path": "Contents/engine1.mp3", "title": "Engine One"}])
    drive = external_drives.detect_drive_at(root)
    assert drive is not None
    assert drive.kind == "engine"
    assert drive.track_count == 1
    assert drive.written_by_manadj is False


def test_detect_plain_drive_is_none(tmp_path: Path):
    assert external_drives.detect_drive_at(tmp_path) is None


def test_mount_roots_env_adds_scan_locations(tmp_path: Path):
    roots = external_drives.mount_roots(
        platform="linux", env={external_drives.EXTRA_ROOTS_ENV: str(tmp_path)}
    )
    assert tmp_path in roots


def test_mount_roots_windows_scans_existing_letters_only(monkeypatch):
    # Host-independent: pretend exactly D:/ and E:/ exist. The letter scan
    # must keep existing letters only, on whatever host runs the test — a
    # real Windows runner has its own letters (C:, D:) that must not leak
    # in, and a non-Windows host has none that must not empty the result.
    existing = {"D:/", "E:/"}
    real_is_dir = Path.is_dir

    def fake_is_dir(self: Path) -> bool:
        # PosixPath("D:/") stringifies as "D:"; WindowsPath keeps the root.
        normalized = str(self).replace("\\", "/").rstrip("/")
        if len(normalized) == 2 and normalized[0].isalpha() and normalized[1] == ":":
            return normalized + "/" in existing
        return real_is_dir(self)

    monkeypatch.setattr(Path, "is_dir", fake_is_dir)
    roots = external_drives.mount_roots(platform="win32", env={})
    assert roots == [Path("D:/"), Path("E:/")]


# --- preview (read-only) -----------------------------------------------------


def test_rekordbox_preview_classifies(db: Session, make_track, usb: Path):
    make_track(filename="/Contents/track2.mp3", title="Already Have")  # full-path match
    make_track(filename="/music/twin.mp3", title="Old Twin")  # file-name match only
    before = tree_digest(usb)

    preview = external_drives.build_pull_preview(db, usb)

    assert preview.kind == "rekordbox"
    assert preview.device_track_count == 4
    by_title = {e.title: e for e in preview.entries}
    assert by_title["Bright Lights"].status == "new"
    assert by_title["Bright Lights"].bpm == 174.0
    assert by_title["Bright Lights"].key == "Am"
    assert by_title["Bright Lights"].artist == "Lane 8"
    assert by_title["Already Have"].status == "present"
    assert by_title["Name Twin"].status == "uncertain"
    assert "file name" in (by_title["Name Twin"].detail or "")
    assert by_title["Ghost"].status == "missing-file"
    assert preview.new_count == 1
    assert preview.present_count == 1
    assert preview.uncertain_count == 1
    assert preview.missing_file_count == 1
    assert tree_digest(usb) == before  # preview never touches the drive


def test_rekordbox_preview_flags_duplicates(db: Session, tmp_path: Path):
    root = tmp_path / "DUPES"
    root.mkdir()
    make_rekordbox_usb(
        root,
        [
            track_spec(1, "One", "/Contents/a/same.mp3"),
            track_spec(2, "Two", "/Contents/b/same.mp3"),
        ],
    )
    preview = external_drives.build_pull_preview(db, root)
    assert [e.status for e in preview.entries] == ["missing-file", "duplicate"]


def test_traversal_in_device_path_stays_inside_the_drive(db: Session, tmp_path: Path):
    root = tmp_path / "TRAV"
    root.mkdir()
    make_rekordbox_usb(root, [track_spec(1, "Escape", "/../outside.mp3")])
    preview = external_drives.build_pull_preview(db, root)
    # ".."-parts are stripped, so this resolves to <root>/outside.mp3, which
    # does not exist — never anything outside the drive.
    assert preview.entries[0].status == "missing-file"


def test_symlink_escape_reads_as_missing_and_is_never_copied(db: Session, tmp_path: Path):
    root = tmp_path / "LINKUSB"
    root.mkdir()
    make_rekordbox_usb(root, [track_spec(1, "Link", "/Contents/link.mp3")])
    outside = tmp_path / "outside.mp3"
    shutil.copy2(FIXTURES / "silence.mp3", outside)
    link = root / "Contents" / "link.mp3"
    link.parent.mkdir(parents=True)
    link.symlink_to(outside)

    preview = external_drives.build_pull_preview(db, root)
    assert preview.entries[0].status == "missing-file"

    result = external_drives.execute_pull(
        db,
        root,
        tmp_path / "lib",
        expected_fingerprint=external_drives.build_pull_preview(
            db, root, tmp_path / "lib"
        ).fingerprint,
    )
    assert result.imported == 0
    assert db.query(Track).count() == 0


# --- confirmed import --------------------------------------------------------


def test_rekordbox_pull_imports_additively(db: Session, make_track, usb: Path, tmp_path: Path):
    make_track(filename="/Contents/track2.mp3", title="Already Have")
    make_track(filename="/music/twin.mp3", title="Old Twin")
    dest = tmp_path / "manadj-library"
    before = tree_digest(usb)

    result = external_drives.execute_pull(
        db,
        usb,
        dest,
        expected_fingerprint=external_drives.build_pull_preview(db, usb, dest).fingerprint,
    )

    assert result.imported == 1
    assert result.skipped_present == 1
    assert result.skipped_uncertain == 1
    assert result.skipped_missing_file == 1
    assert result.errors == []

    copied = dest / "Contents" / "track1.mp3"
    assert copied.is_file()
    track = db.query(Track).filter(Track.filename == str(copied.resolve())).one()
    assert track.title == "Bright Lights"
    assert track.artist == "Lane 8"
    assert track.bpm == 17400  # centiBPM column unit
    assert track.key == Key.from_musical("Am").engine_id
    assert track.key_provenance == "imported"
    # file facts were filled from the copied audio
    assert track.duration_secs is not None
    assert track.codec is not None

    assert tree_digest(usb) == before  # the drive is never written to

    # A second pull imports nothing: every track is now matched or missing.
    again = external_drives.execute_pull(
        db,
        usb,
        dest,
        expected_fingerprint=external_drives.build_pull_preview(db, usb, dest).fingerprint,
    )
    assert again.imported == 0
    assert again.errors == []


def test_name_only_match_is_not_imported(db: Session, make_track, usb: Path, tmp_path: Path):
    make_track(filename="/music/track1.mp3", title="Different audio, same name")

    preview = external_drives.build_pull_preview(db, usb)
    assert preview.entries[0].status == "uncertain"

    result = external_drives.execute_pull(
        db,
        usb,
        tmp_path / "lib",
        expected_fingerprint=external_drives.build_pull_preview(
            db, usb, tmp_path / "lib"
        ).fingerprint,
    )
    assert result.skipped_uncertain == 1
    assert db.query(Track).filter(Track.title == "Bright Lights").count() == 0


# --- content-verified name-only matching --------------------------------------
# A device path can never equal a library path, so real duplicates surface as
# name-only matches. Byte-identical content upgrades them to present; anything
# else stays conservatively uncertain.


def test_identical_content_name_only_match_is_present(
    db: Session, make_track, usb: Path, tmp_path: Path
):
    # Same audio held at a different library path: content-verified present.
    library_file = tmp_path / "music" / "track2.mp3"
    library_file.parent.mkdir(parents=True)
    shutil.copy2(FIXTURES / "silence.mp3", library_file)
    make_track(filename=str(library_file), title="Already Have")
    before = tree_digest(usb)

    preview = external_drives.build_pull_preview(db, usb)

    by_title = {e.title: e for e in preview.entries}
    assert by_title["Already Have"].status == "present"
    assert "content-verified" in (by_title["Already Have"].detail or "")
    assert preview.present_count == 1
    assert preview.uncertain_count == 0
    assert preview.new_count == 2  # Bright Lights + Name Twin
    assert tree_digest(usb) == before  # verification never touches the drive


def test_same_size_different_bytes_stay_uncertain(
    db: Session, make_track, usb: Path, tmp_path: Path
):
    # Same name AND same size, different bytes: still not the same audio.
    library_file = tmp_path / "music" / "track2.mp3"
    library_file.parent.mkdir(parents=True)
    data = bytearray((FIXTURES / "silence.mp3").read_bytes())
    data[-1] ^= 0xFF
    library_file.write_bytes(bytes(data))
    make_track(filename=str(library_file), title="Already Have")

    preview = external_drives.build_pull_preview(db, usb)

    by_title = {e.title: e for e in preview.entries}
    assert by_title["Already Have"].status == "uncertain"
    assert preview.present_count == 0


def test_different_size_stays_uncertain_without_content_identity(
    db: Session, make_track, usb: Path, tmp_path: Path
):
    library_file = tmp_path / "music" / "track2.mp3"
    library_file.parent.mkdir(parents=True)
    library_file.write_bytes(b"not the same audio")
    make_track(filename=str(library_file), title="Already Have")

    preview = external_drives.build_pull_preview(db, usb)

    assert {e.title: e for e in preview.entries}["Already Have"].status == "uncertain"


def test_every_same_basename_candidate_is_tried(db: Session, make_track, usb: Path, tmp_path: Path):
    # The first row with this basename is different audio; a second row at
    # another path holds the same bytes. Verification must consider every
    # candidate, not whichever row a single-value index happened to keep.
    music = tmp_path / "music"
    music.mkdir()
    different = music / "track2.mp3"
    different.write_bytes(b"another track entirely")
    same = music / "backup" / "track2.mp3"
    same.parent.mkdir()
    shutil.copy2(FIXTURES / "silence.mp3", same)
    make_track(filename=str(different), title="Decoy")
    make_track(filename=str(same), title="Real copy")

    preview = external_drives.build_pull_preview(db, usb)

    assert {e.title: e for e in preview.entries}["Already Have"].status == "present"


def test_content_verified_match_is_not_imported(db: Session, make_track, usb: Path, tmp_path: Path):
    library_file = tmp_path / "music" / "track2.mp3"
    library_file.parent.mkdir(parents=True)
    shutil.copy2(FIXTURES / "silence.mp3", library_file)
    make_track(filename=str(library_file), title="Already Have")
    before = tree_digest(usb)

    dest = tmp_path / "lib"
    result = external_drives.execute_pull(
        db,
        usb,
        dest,
        expected_fingerprint=external_drives.build_pull_preview(db, usb, dest).fingerprint,
    )

    assert result.skipped_present == 1
    assert result.skipped_uncertain == 0
    assert not (dest / "Contents" / "track2.mp3").exists()  # nothing re-copied
    assert db.query(Track).filter(Track.title == "Already Have").count() == 1
    assert tree_digest(usb) == before


def test_stale_preview_forces_a_fresh_preview(db: Session, make_track, usb: Path, tmp_path: Path):
    stale = external_drives.build_pull_preview(db, usb)
    assert stale.new_count == 3  # track1, track2, twin
    # The library changes between preview and confirm: the confirmed set
    # no longer matches what was reviewed, so the import is refused.
    make_track(filename="/music/track1.mp3", title="Imported meanwhile")

    with pytest.raises(external_drives.PlanChangedError):
        external_drives.execute_pull(
            db, usb, tmp_path / "lib", expected_fingerprint=stale.fingerprint
        )
    assert db.query(Track).filter(Track.title == "Bright Lights").count() == 0

    # Re-previewing binds the new plan and the import proceeds with it.
    fresh = external_drives.build_pull_preview(db, usb, tmp_path / "lib")
    result = external_drives.execute_pull(
        db, usb, tmp_path / "lib", expected_fingerprint=fresh.fingerprint
    )
    assert result.skipped_uncertain == 1
    assert db.query(Track).filter(Track.title == "Bright Lights").count() == 0


def test_device_change_forces_a_fresh_preview(db: Session, usb: Path, tmp_path: Path):
    preview = external_drives.build_pull_preview(db, usb, tmp_path / "lib")
    # A device file changes between preview and confirm.
    (usb / "Contents" / "track1.mp3").write_bytes(b"replaced while reviewing")

    with pytest.raises(external_drives.PlanChangedError):
        external_drives.execute_pull(
            db, usb, tmp_path / "lib", expected_fingerprint=preview.fingerprint
        )
    assert db.query(Track).count() == 0


def test_copy_race_with_identical_content_is_reused(tmp_path: Path, monkeypatch):
    source = tmp_path / "src.mp3"
    source.write_bytes(b"the same bytes")
    dest = tmp_path / "lib" / "track.mp3"

    def racing_link(_temp: str, target: str) -> None:
        Path(target).parent.mkdir(parents=True, exist_ok=True)
        Path(target).write_bytes(b"the same bytes")
        raise FileExistsError("appeared concurrently")

    monkeypatch.setattr(external_drives.os, "link", racing_link)
    used, error, created = external_drives._copy_one(source, dest)
    assert error is None and not created
    assert used == dest
    assert dest.read_bytes() == b"the same bytes"


def test_copy_race_with_different_content_never_clobbers(tmp_path: Path, monkeypatch):
    source = tmp_path / "src.mp3"
    source.write_bytes(b"the pull's bytes")
    dest = tmp_path / "lib" / "track.mp3"

    def racing_link(_temp: str, target: str) -> None:
        Path(target).parent.mkdir(parents=True, exist_ok=True)
        Path(target).write_bytes(b"concurrent different file")
        raise FileExistsError("appeared concurrently")

    monkeypatch.setattr(external_drives.os, "link", racing_link)
    used, error, created = external_drives._copy_one(source, dest)
    assert used is None and not created
    assert error is not None
    assert dest.read_bytes() == b"concurrent different file"


def test_copy_fails_closed_without_hardlink_support(tmp_path: Path, monkeypatch):
    source = tmp_path / "src.mp3"
    source.write_bytes(b"audio bytes")
    dest = tmp_path / "lib" / "track.mp3"

    def no_links(_temp: str, _dest: str) -> None:
        raise OSError(38, "function not implemented")

    monkeypatch.setattr(external_drives.os, "link", no_links)
    used, error, created = external_drives._copy_one(source, dest)
    assert used is None and not created
    assert error is not None and "no-clobber" in error
    assert not dest.exists()
    leftovers = [p for p in dest.parent.rglob("*") if ".part-" in p.name]
    assert leftovers == []  # temp cleaned up


def test_copy_detects_source_changing_mid_copy(tmp_path: Path, monkeypatch):
    source = tmp_path / "src.mp3"
    source.write_bytes(b"original bytes")
    dest = tmp_path / "lib" / "track.mp3"
    real_copy2 = shutil.copy2

    def shifting_copy2(src: str, dst: str) -> None:
        real_copy2(src, dst)
        os.utime(src, (1_000_000, 1_000_000))  # changed while copying

    monkeypatch.setattr(external_drives.shutil, "copy2", shifting_copy2)
    used, error, created = external_drives._copy_one(source, dest)
    assert used is None and not created
    assert error is not None and "changed while copying" in error
    assert not dest.exists()


def test_identical_existing_file_is_reused_by_hash(db: Session, usb: Path, tmp_path: Path):
    dest = tmp_path / "lib"
    existing = dest / "Contents" / "track1.mp3"
    existing.parent.mkdir(parents=True)
    shutil.copy2(usb / "Contents" / "track1.mp3", existing)
    before_mtime = existing.stat().st_mtime_ns

    result = external_drives.execute_pull(
        db,
        usb,
        dest,
        expected_fingerprint=external_drives.build_pull_preview(db, usb, dest).fingerprint,
    )

    assert result.errors == []
    assert result.imported == 3  # track1 (reused), track2, twin
    assert existing.stat().st_mtime_ns == before_mtime  # never rewritten
    track = db.query(Track).filter(Track.title == "Bright Lights").one()
    assert track.filename == str(existing.resolve())


def test_pull_never_overwrites_a_different_file(db: Session, usb: Path, tmp_path: Path):
    dest = tmp_path / "lib"
    existing = dest / "Contents" / "track1.mp3"
    existing.parent.mkdir(parents=True)
    existing.write_bytes(b"not the same audio at all, different length")

    result = external_drives.execute_pull(
        db,
        usb,
        dest,
        expected_fingerprint=external_drives.build_pull_preview(db, usb, dest).fingerprint,
    )

    # track1 refuses to overwrite; the other new tracks still import.
    assert result.imported == 2
    assert len(result.errors) == 1
    assert existing.read_bytes() == b"not the same audio at all, different length"
    assert db.query(Track).filter(Track.title == "Bright Lights").count() == 0


def test_case_variant_existing_file_is_not_clobbered(db: Session, usb: Path, tmp_path: Path):
    dest = tmp_path / "lib"
    existing = dest / "Contents" / "TRACK1.MP3"
    existing.parent.mkdir(parents=True)
    existing.write_bytes(b"someone else's track1")

    result = external_drives.execute_pull(
        db,
        usb,
        dest,
        expected_fingerprint=external_drives.build_pull_preview(db, usb, dest).fingerprint,
    )

    assert result.imported == 2  # track2 + twin; track1 conflicts
    assert len(result.errors) == 1
    assert existing.read_bytes() == b"someone else's track1"
    assert db.query(Track).filter(Track.title == "Bright Lights").count() == 0


def test_failed_commit_rolls_back_and_removes_copied_files(
    db: Session, usb: Path, tmp_path: Path, monkeypatch
):
    dest = tmp_path / "lib"

    def boom():
        raise RuntimeError("disk full")

    monkeypatch.setattr(db, "commit", boom)

    with pytest.raises(external_drives.ExternalDriveError):
        external_drives.execute_pull(
            db,
            usb,
            dest,
            expected_fingerprint=external_drives.build_pull_preview(db, usb, dest).fingerprint,
        )

    db.rollback()
    assert db.query(Track).count() == 0
    leftovers = [p for p in dest.rglob("*") if p.is_file()]
    assert leftovers == []  # no orphaned copies


def test_pull_refuses_destination_on_the_drive(db: Session, usb: Path):
    with pytest.raises(external_drives.ExternalDriveError):
        external_drives.execute_pull(
            db,
            usb,
            usb / "library",
            expected_fingerprint=external_drives.build_pull_preview(
                db, usb, usb / "library"
            ).fingerprint,
        )


def test_engine_pull_imports(db: Session, tmp_path: Path):
    root = tmp_path / "ENGINE_USB"
    root.mkdir()
    make_engine_usb(
        root,
        [
            {
                "path": "Contents/engine1.mp3",
                "title": "Engine One",
                "artist": "Test Artist",
                "bpm": 128,
                "bpmAnalyzed": 128.5,
                "key": 7,
                "length": 300,
            }
        ],
    )
    put_audio(root, "Contents/engine1.mp3")
    dest = tmp_path / "lib"

    preview = external_drives.build_pull_preview(db, root)
    assert preview.kind == "engine"
    assert preview.new_count == 1
    entry = preview.entries[0]
    assert entry.bpm == 128.5
    assert entry.key == Key.from_engine_id(7).musical

    result = external_drives.execute_pull(
        db,
        root,
        dest,
        expected_fingerprint=external_drives.build_pull_preview(db, root, dest).fingerprint,
    )
    assert result.imported == 1
    track = db.query(Track).filter(Track.title == "Engine One").one()
    assert track.bpm == 12850  # bpmAnalyzed preferred, stored in centiBPM
    assert track.key == 7  # Engine key id is manadj's native key space
    assert track.key_provenance == "imported"


# --- router: the confirm gate ------------------------------------------------


def test_import_requires_confirm(
    client: TestClient, db_session: Session, usb: Path, tmp_path: Path
):
    resp = client.post(
        "/api/external-drives/import",
        json={"root": str(usb), "destination": str(tmp_path / "lib")},
    )
    assert resp.status_code == 400
    assert db_session.query(Track).count() == 0
    assert not (tmp_path / "lib").exists()


def test_router_preview_then_confirmed_import(
    client: TestClient, db_session: Session, usb: Path, tmp_path: Path
):
    resp = client.post("/api/external-drives/preview", json={"root": str(usb)})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["kind"] == "rekordbox"
    assert body["new_count"] == 3
    assert body["missing_file_count"] == 1

    # An unbound fingerprint is refused: the confirm must bind the reviewed
    # set AND the destination it lands in.
    resp = client.post(
        "/api/external-drives/import",
        json={
            "root": str(usb),
            "destination": str(tmp_path / "lib"),
            "confirm": True,
            "preview_fingerprint": body["fingerprint"],
        },
    )
    assert resp.status_code == 409
    assert db_session.query(Track).count() == 0

    # The UI re-previews with the destination right before confirming.
    resp = client.post(
        "/api/external-drives/preview",
        json={"root": str(usb), "destination": str(tmp_path / "lib")},
    )
    assert resp.status_code == 200, resp.text
    bound = resp.json()
    assert bound["fingerprint"] != body["fingerprint"]

    resp = client.post(
        "/api/external-drives/import",
        json={
            "root": str(usb),
            "destination": str(tmp_path / "lib"),
            "confirm": True,
            "preview_fingerprint": bound["fingerprint"],
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["imported"] == 3
    assert db_session.query(Track).count() == 3


def test_import_requires_preview_fingerprint(
    client: TestClient, db_session: Session, usb: Path, tmp_path: Path
):
    resp = client.post(
        "/api/external-drives/import",
        json={"root": str(usb), "destination": str(tmp_path / "lib"), "confirm": True},
    )
    assert resp.status_code == 400
    assert db_session.query(Track).count() == 0


def test_import_with_stale_fingerprint_is_refused(
    client: TestClient, db_session: Session, usb: Path, tmp_path: Path
):
    resp = client.post("/api/external-drives/preview", json={"root": str(usb)})
    assert resp.status_code == 200, resp.text
    assert resp.json()["fingerprint"]

    resp = client.post(
        "/api/external-drives/import",
        json={
            "root": str(usb),
            "destination": str(tmp_path / "lib"),
            "confirm": True,
            "preview_fingerprint": "0" * 64,
        },
    )
    assert resp.status_code == 409
    assert db_session.query(Track).count() == 0
    assert not (tmp_path / "lib").exists()


def test_preview_404_on_plain_directory(client: TestClient, tmp_path: Path):
    resp = client.post("/api/external-drives/preview", json={"root": str(tmp_path)})
    assert resp.status_code == 404


# --- content-verified rename matching -----------------------------------------
# A renamed device file matches no library path and no file name, so only the
# device tags can generate candidates. Tag equality never decides identity:
# byte-identical content upgrades to present (matched_path records which
# library file verified, so the UI can show both names); anything else stays
# conservatively uncertain or new.


def renamed_usb(tmp_path: Path, title: str = "Renamed Tune") -> Path:
    root = tmp_path / "RENAMED_USB"
    root.mkdir()
    make_rekordbox_usb(
        root,
        [track_spec(1, title, "/Contents/dj-edit-01.mp3", artist_id=1)],
    )
    put_audio(root, "/Contents/dj-edit-01.mp3")
    return root


def test_renamed_identical_content_is_present_with_matched_path(
    db: Session, make_track, tmp_path: Path
):
    usb = renamed_usb(tmp_path)
    library_file = tmp_path / "music" / "Renamed Tune.mp3"
    library_file.parent.mkdir(parents=True)
    shutil.copy2(FIXTURES / "silence.mp3", library_file)
    make_track(filename=str(library_file), title="Renamed Tune", artist="Lane 8")
    before = tree_digest(usb)

    preview = external_drives.build_pull_preview(db, usb)

    entry = preview.entries[0]
    assert entry.status == "present"
    assert "different file name" in (entry.detail or "")
    assert "content-verified" in (entry.detail or "")
    assert entry.matched_path == str(library_file)
    assert preview.present_count == 1
    assert preview.new_count == 0
    assert tree_digest(usb) == before  # verification never touches the drive

    result = external_drives.execute_pull(
        db,
        usb,
        tmp_path / "lib",
        expected_fingerprint=external_drives.build_pull_preview(
            db, usb, tmp_path / "lib"
        ).fingerprint,
    )
    assert result.imported == 0  # a renamed copy is never re-imported


def test_renamed_tag_match_is_case_insensitive(
    db: Session, make_track, tmp_path: Path
):
    usb = renamed_usb(tmp_path, title="RENAMED TUNE")
    library_file = tmp_path / "music" / "anything.mp3"
    library_file.parent.mkdir(parents=True)
    shutil.copy2(FIXTURES / "silence.mp3", library_file)
    make_track(filename=str(library_file), title=" renamed tune ", artist="lane 8")

    preview = external_drives.build_pull_preview(db, usb)

    assert preview.entries[0].status == "present"


def test_renamed_tag_match_different_bytes_stays_uncertain(
    db: Session, make_track, tmp_path: Path
):
    # Same artist+title tags, same size, different bytes: not the same audio.
    usb = renamed_usb(tmp_path)
    library_file = tmp_path / "music" / "Renamed Tune.mp3"
    library_file.parent.mkdir(parents=True)
    data = bytearray((FIXTURES / "silence.mp3").read_bytes())
    data[-1] ^= 0xFF
    library_file.write_bytes(bytes(data))
    make_track(filename=str(library_file), title="Renamed Tune", artist="Lane 8")

    preview = external_drives.build_pull_preview(db, usb)

    entry = preview.entries[0]
    assert entry.status == "uncertain"
    assert "same artist and title" in (entry.detail or "")
    assert entry.matched_path is None
    assert preview.new_count == 0

    result = external_drives.execute_pull(
        db,
        usb,
        tmp_path / "lib",
        expected_fingerprint=external_drives.build_pull_preview(
            db, usb, tmp_path / "lib"
        ).fingerprint,
    )
    assert result.imported == 0
    assert result.skipped_uncertain == 1


def test_no_tag_candidate_stays_new(db: Session, make_track, tmp_path: Path):
    usb = renamed_usb(tmp_path)
    make_track(title="Some Other Track", artist="Someone Else")

    preview = external_drives.build_pull_preview(db, usb)

    entry = preview.entries[0]
    assert entry.status == "new"
    assert entry.matched_path is None
    assert preview.new_count == 1


def test_engine_renamed_identical_content_is_present(
    db: Session, make_track, tmp_path: Path
):
    # The rename tier must resolve Engine paths through the kind-aware
    # resolver, not the Rekordbox relative-path one.
    root = tmp_path / "ENGINE_USB"
    make_engine_usb(
        root,
        [{"path": "Music/dj-edit-02.mp3", "title": "Engine Tune", "artist": "Lane 8"}],
    )
    put_audio(root, "Music/dj-edit-02.mp3")
    library_file = tmp_path / "music" / "Engine Tune.mp3"
    library_file.parent.mkdir(parents=True)
    shutil.copy2(FIXTURES / "silence.mp3", library_file)
    make_track(filename=str(library_file), title="Engine Tune", artist="Lane 8")

    preview = external_drives.build_pull_preview(db, root)

    entry = preview.entries[0]
    assert entry.status == "present"
    assert entry.matched_path == str(library_file)


def test_engine_renamed_different_bytes_stays_uncertain(
    db: Session, make_track, tmp_path: Path
):
    root = tmp_path / "ENGINE_USB"
    make_engine_usb(
        root,
        [{"path": "Music/dj-edit-02.mp3", "title": "Engine Tune", "artist": "Lane 8"}],
    )
    put_audio(root, "Music/dj-edit-02.mp3")
    library_file = tmp_path / "music" / "Engine Tune.mp3"
    library_file.parent.mkdir(parents=True)
    library_file.write_bytes(b"different audio entirely")
    make_track(filename=str(library_file), title="Engine Tune", artist="Lane 8")

    preview = external_drives.build_pull_preview(db, root)

    assert preview.entries[0].status == "uncertain"


def test_unverified_preview_skips_hashing_and_marks_matches_uncertain(
    db: Session, make_track, usb: Path, tmp_path: Path
):
    # The fast pass must not touch file contents: even byte-identical
    # name-only and renamed matches stay unverified until the full pass.
    library_file = tmp_path / "music" / "track2.mp3"
    library_file.parent.mkdir(parents=True)
    shutil.copy2(FIXTURES / "silence.mp3", library_file)
    make_track(filename=str(library_file), title="Already Have")
    renamed_file = tmp_path / "music" / "Bright Lights.mp3"
    shutil.copy2(FIXTURES / "silence.mp3", renamed_file)
    make_track(filename=str(renamed_file), title="Bright Lights", artist="Lane 8")

    fast = external_drives.build_pull_preview(db, usb, verify=False)
    by_title = {e.title: e for e in fast.entries}
    assert by_title["Already Have"].status == "uncertain"
    assert by_title["Already Have"].matched_path is None
    assert by_title["Bright Lights"].status == "uncertain"
    assert by_title["Bright Lights"].matched_path is None

    full = external_drives.build_pull_preview(db, usb, verify=True)
    by_title = {e.title: e for e in full.entries}
    assert by_title["Already Have"].status == "present"
    assert by_title["Already Have"].matched_path == str(library_file)
    assert by_title["Bright Lights"].status == "present"
    assert by_title["Bright Lights"].matched_path == str(renamed_file)


def test_numbered_title_prefix_matches_cleaned_library_title(
    db: Session, make_track, tmp_path: Path
):
    # "005 Let Me Down" on the drive is the same audio as the library's
    # "Let Me Down": the playlist-position prefix only generates the
    # candidate, identical bytes make it present.
    root = tmp_path / "NUMBERED_USB"
    root.mkdir()
    make_rekordbox_usb(
        root,
        [track_spec(1, "005 Let Me Down", "/Contents/x.mp3", artist_id=1)],
    )
    put_audio(root, "/Contents/x.mp3")
    library_file = tmp_path / "music" / "Let Me Down.mp3"
    library_file.parent.mkdir(parents=True)
    shutil.copy2(FIXTURES / "silence.mp3", library_file)
    make_track(filename=str(library_file), title="Let Me Down", artist="Lane 8")

    preview = external_drives.build_pull_preview(db, root)

    entry = preview.entries[0]
    assert entry.status == "present"
    assert entry.matched_path == str(library_file)


def test_remix_versions_never_collapse(
    db: Session, make_track, tmp_path: Path
):
    # Same base title, different mix: no candidate at all, stays new.
    root = tmp_path / "REMIX_USB"
    root.mkdir()
    make_rekordbox_usb(
        root,
        [track_spec(1, "014 Money (Aries Remix)", "/Contents/y.mp3", artist_id=1)],
    )
    put_audio(root, "/Contents/y.mp3")
    library_file = tmp_path / "music" / "Money (Original Mix).mp3"
    library_file.parent.mkdir(parents=True)
    shutil.copy2(FIXTURES / "silence.mp3", library_file)
    make_track(filename=str(library_file), title="Money (Original Mix)", artist="Lane 8")

    preview = external_drives.build_pull_preview(db, root)

    assert preview.entries[0].status == "new"


def test_numbered_title_prefix_different_bytes_stays_uncertain(
    db: Session, make_track, tmp_path: Path
):
    root = tmp_path / "NUMBERED2_USB"
    root.mkdir()
    make_rekordbox_usb(
        root,
        [track_spec(1, "005 Let Me Down", "/Contents/x.mp3", artist_id=1)],
    )
    put_audio(root, "/Contents/x.mp3")
    library_file = tmp_path / "music" / "Let Me Down.mp3"
    library_file.parent.mkdir(parents=True)
    library_file.write_bytes(b"different audio entirely")
    make_track(filename=str(library_file), title="Let Me Down", artist="Lane 8")

    preview = external_drives.build_pull_preview(db, root)

    assert preview.entries[0].status == "uncertain"


def test_selected_ordinals_import_only_the_checked_tracks(
    db: Session, make_track, usb: Path, tmp_path: Path
):
    dest = tmp_path / "lib"
    preview = external_drives.build_pull_preview(db, usb, dest)
    new_by_title = {e.title: e.ordinal for e in preview.entries if e.status == "new"}
    chosen = {new_by_title["Bright Lights"]}

    result = external_drives.execute_pull(
        db, usb, dest, expected_fingerprint=preview.fingerprint, ordinals=chosen
    )

    assert result.imported == 1
    assert result.skipped_unselected == len(new_by_title) - 1
    assert db.query(Track).filter(Track.title == "Bright Lights").count() == 1
    assert db.query(Track).filter(Track.title == "Name Twin").count() == 0


def test_selection_outside_the_verified_plan_refuses_the_import(
    db: Session, make_track, usb: Path, tmp_path: Path
):
    dest = tmp_path / "lib"
    preview = external_drives.build_pull_preview(db, usb, dest)
    not_new = next(e.ordinal for e in preview.entries if e.status != "new")

    with pytest.raises(external_drives.ExternalDriveError):
        external_drives.execute_pull(
            db, usb, dest, expected_fingerprint=preview.fingerprint,
            ordinals={not_new},
        )
    assert db.query(Track).count() == 0


# --- playlists in the pull preview --------------------------------------------

PAGE_LIST_FOLDER = 100
PAGE_LIST_A = 101
PAGE_LIST_B = 102


def make_rekordbox_usb_with_playlists(root: Path, entry_order_b=(3, 2)) -> Path:
    """Three tracks; folder RIG with "RIG Mix" (1,2,3 in order) and "RIG New"
    (entry_order_b, default reordered with a cross-playlist duplicate)."""
    pdb_dir = root / "PIONEER" / "rekordbox"
    pdb_dir.mkdir(parents=True)
    tracks = [
        track_spec(1, "One", "/Contents/one.mp3", artist_id=1),
        track_spec(2, "Two", "/Contents/two.mp3", artist_id=1),
        track_spec(3, "Three", "/Contents/three.mp3", artist_id=1),
    ]
    tree = [
        PlaylistTreeRowSpec(
            id=PAGE_LIST_FOLDER, name=sql_string("RIG"), parent_id=0,
            sort_order=1, is_folder=True,
        ).encode(),
        PlaylistTreeRowSpec(
            id=PAGE_LIST_A, name=sql_string("RIG Mix"), parent_id=PAGE_LIST_FOLDER,
            sort_order=1, is_folder=False,
        ).encode(),
        PlaylistTreeRowSpec(
            id=PAGE_LIST_B, name=sql_string("RIG New"), parent_id=PAGE_LIST_FOLDER,
            sort_order=2, is_folder=False,
        ).encode(),
    ]
    entries = []
    # written deliberately out of entry_index order: parse must sort
    for i, tid in [(2, 2), (1, 1), (3, 3)]:
        entries.append(
            PlaylistEntryRowSpec(entry_index=i, track_id=tid, playlist_id=PAGE_LIST_A).encode()
        )
    for i, tid in enumerate(entry_order_b, start=1):
        entries.append(
            PlaylistEntryRowSpec(entry_index=i, track_id=tid, playlist_id=PAGE_LIST_B).encode()
        )
    tables = [
        TableData(PAGE_TRACKS, [encode_track_row(t) for t in tracks]),
        TableData(PAGE_ARTISTS, [ArtistRowSpec(id=1, name=sql_string("Lane 8")).encode()]),
        TableData(PAGE_PLAYLIST_TREE, tree),
        TableData(PAGE_PLAYLIST_ENTRIES, entries),
    ]
    (pdb_dir / "export.pdb").write_bytes(build_pdb(tables))
    for name in ("one", "two", "three"):
        put_audio(root, f"/Contents/{name}.mp3")
    return root


def test_device_parse_playlist_tree_and_entries(tmp_path: Path):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    device = external_drives.read_rekordbox_device(usb)
    assert len(device.playlists) == 3
    by_id = {pl.id: pl for pl in device.playlists}
    assert by_id[PAGE_LIST_FOLDER].is_folder is True
    assert by_id[PAGE_LIST_A].is_folder is False
    assert by_id[PAGE_LIST_A].parent_id == PAGE_LIST_FOLDER
    # entries written out of order come back in entry_index order
    assert by_id[PAGE_LIST_A].track_ids == [1, 2, 3]
    assert by_id[PAGE_LIST_B].track_ids == [3, 2]


def test_device_without_playlist_tables_tolerated(usb: Path):
    device = external_drives.read_rekordbox_device(usb)
    assert device.playlists == []


def test_preview_playlist_rollup(db: Session, make_track, tmp_path: Path):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    make_track(filename="/Contents/two.mp3", title="Two")  # full-path match
    preview = external_drives.build_pull_preview(db, usb)
    assert len(preview.playlists) == 2  # folder is not a playlist row
    mix = next(pl for pl in preview.playlists if pl.name == "RIG Mix")
    assert mix.folder_path == "RIG"
    assert mix.track_count == 3
    assert mix.present_count == 1  # Two
    assert mix.new_count == 2  # One, Three
    new_pl = next(pl for pl in preview.playlists if pl.name == "RIG New")
    assert new_pl.track_count == 2
    assert new_pl.present_count == 1
    assert new_pl.new_count == 1


def test_preview_without_playlists_returns_empty_list(db: Session, usb: Path):
    preview = external_drives.build_pull_preview(db, usb)
    assert preview.playlists == []


def test_playlist_order_change_changes_fingerprint(db: Session, tmp_path: Path):
    usb_a = make_rekordbox_usb_with_playlists(tmp_path / "A", entry_order_b=(3, 2))
    usb_b = make_rekordbox_usb_with_playlists(tmp_path / "B", entry_order_b=(2, 3))
    fp_a = external_drives.build_pull_preview(db, usb_a).fingerprint
    fp_b = external_drives.build_pull_preview(db, usb_b).fingerprint
    assert fp_a != fp_b


def test_router_preview_includes_playlists(client: TestClient, tmp_path: Path):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    response = client.post("/api/external-drives/preview", json={"root": str(usb)})
    assert response.status_code == 200
    payload = response.json()
    assert [pl["name"] for pl in payload["playlists"]] == ["RIG Mix", "RIG New"]
    mix = payload["playlists"][0]
    assert mix["folder_path"] == "RIG"
    assert mix["track_count"] == 3
    assert mix["new_count"] == 3


# --- membership diff (dry-run, no writes) --------------------------------------


def _add_local_playlist(db: Session, name: str, track_ids: list[int]) -> None:
    from backend.models import Playlist, PlaylistTrack

    playlist = Playlist(name=name)
    db.add(playlist)
    db.commit()
    db.refresh(playlist)
    for pos, tid in enumerate(track_ids):
        db.add(PlaylistTrack(playlist_id=playlist.id, track_id=tid, position=pos))
    db.commit()


def _device_and_preview(db: Session, usb: Path):
    device = external_drives.read_rekordbox_device(usb)
    preview = external_drives.build_pull_preview(db, usb)
    return device, preview


def test_membership_diff_counts(db: Session, make_track, tmp_path: Path):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    two = make_track(filename="/Contents/two.mp3", title="Two")
    held_elsewhere = make_track(filename="/music/elsewhere.mp3", title="Elsewhere")
    _add_local_playlist(db, "RIG Mix", [two.id, held_elsewhere.id])
    device, preview = _device_and_preview(db, usb)
    mix = next(pl for pl in device.playlists if pl.name == "RIG Mix")

    diff = external_drives.diff_device_playlist(db, device, mix, preview.entries)

    assert diff.counterpart_status == "unique-name-match"
    assert diff.common == 1  # two.mp3
    assert diff.adds_new == 2  # one.mp3, three.mp3 not in the library
    assert diff.adds_in_library == 0
    assert diff.removes == 1  # held_elsewhere is not on the device playlist
    assert diff.order_differs is False  # single common member cannot reorder
    assert diff.uncertain_members == 0


def test_membership_diff_detects_order_change(db: Session, make_track, tmp_path: Path):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    two = make_track(filename="/Contents/two.mp3", title="Two")
    three = make_track(filename="/Contents/three.mp3", title="Three")
    _add_local_playlist(db, "RIG New", [two.id, three.id])  # device order is 3,2
    device, preview = _device_and_preview(db, usb)
    new_pl = next(pl for pl in device.playlists if pl.name == "RIG New")

    diff = external_drives.diff_device_playlist(db, device, new_pl, preview.entries)

    assert diff.common == 2
    assert diff.order_differs is True
    assert diff.adds_in_library == 0
    assert diff.removes == 0


def test_membership_diff_ambiguous_name_never_binds(db: Session, make_track, tmp_path: Path):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    a = make_track(filename="/a.mp3")
    b = make_track(filename="/b.mp3")
    _add_local_playlist(db, "RIG Mix", [a.id])
    _add_local_playlist(db, "RIG Mix", [b.id])
    device, preview = _device_and_preview(db, usb)
    mix = next(pl for pl in device.playlists if pl.name == "RIG Mix")

    diff = external_drives.diff_device_playlist(db, device, mix, preview.entries)

    assert diff.counterpart_status == "ambiguous-name"
    assert diff.counterpart_id is None
    assert diff.order_differs is None  # no silent bind, no order claim


def test_membership_diff_without_local_playlist(db: Session, tmp_path: Path):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    device, preview = _device_and_preview(db, usb)
    mix = next(pl for pl in device.playlists if pl.name == "RIG Mix")

    diff = external_drives.diff_device_playlist(db, device, mix, preview.entries)

    assert diff.counterpart_status == "no-local-playlist"
    assert diff.adds_new == 3
    assert diff.removes == 0
    assert diff.order_differs is None


def test_membership_diff_excludes_uncertain(db: Session, make_track, tmp_path: Path):
    # A library track with the same FILE NAME but different content makes the
    # device member uncertain; it must be excluded from every diff count.
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    make_track(filename="/music/one.mp3", title="One")  # basename twin only
    _add_local_playlist(db, "RIG Mix", [])
    device, preview = _device_and_preview(db, usb)
    mix = next(pl for pl in device.playlists if pl.name == "RIG Mix")

    diff = external_drives.diff_device_playlist(db, device, mix, preview.entries)

    assert diff.uncertain_members == 1  # one.mp3, unverified
    assert diff.common == 0
    assert diff.adds_in_library == 0  # uncertain is not counted as an add


def test_membership_diff_uncertain_makes_removes_provisional(
    db: Session, make_track, tmp_path: Path
):
    # Local playlist holds A; the device playlist has a member that COULD
    # be A (same file name, different bytes: unverified). The diff must
    # not report A as a confirmed remove: removes stay provisional while
    # any device member is unverified.
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    local_a = make_track(filename="/music/one.mp3", title="One")  # basename twin of device one.mp3
    _add_local_playlist(db, "RIG Mix", [local_a.id])
    device, preview = _device_and_preview(db, usb)
    mix = next(pl for pl in device.playlists if pl.name == "RIG Mix")

    diff = external_drives.diff_device_playlist(db, device, mix, preview.entries)

    assert diff.uncertain_members == 1  # device one.mp3, unverified
    assert diff.common == 0  # nothing verified in common
    assert diff.removes == 1  # local_a has no VERIFIED device counterpart
    assert diff.removes_provisional is True  # ...but it might be the uncertain member


def test_membership_diff_removes_confirmed_only_when_all_verified(
    db: Session, make_track, tmp_path: Path
):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    two = make_track(filename="/Contents/two.mp3", title="Two")
    three = make_track(filename="/Contents/three.mp3", title="Three")
    held_elsewhere = make_track(filename="/music/elsewhere.mp3", title="Elsewhere")
    _add_local_playlist(db, "RIG New", [two.id, three.id, held_elsewhere.id])
    device, preview = _device_and_preview(db, usb)
    new_pl = next(pl for pl in device.playlists if pl.name == "RIG New")

    diff = external_drives.diff_device_playlist(db, device, new_pl, preview.entries)

    assert diff.uncertain_members == 0  # every device member resolved (2,3 verified; 1 new)
    assert diff.removes == 1
    assert diff.removes_provisional is False  # confirmed: nothing unverified left


def test_playlist_rollup_flags_folder_gap(db: Session, tmp_path: Path):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    preview = external_drives.build_pull_preview(db, usb)
    mix = next(pl for pl in preview.playlists if pl.name == "RIG Mix")
    assert mix.folder_path == "RIG"
    assert mix.folder_not_representable is True  # surfaced, never auto-resolved


def test_router_membership_in_response(client: TestClient, tmp_path: Path):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    response = client.post("/api/external-drives/preview", json={"root": str(usb)})
    assert response.status_code == 200
    mix = response.json()["playlists"][0]
    assert mix["folder_not_representable"] is True
    assert mix["membership"]["counterpart_status"] == "no-local-playlist"
    assert mix["membership"]["removes_provisional"] is False


# --- playlist pull: import a device playlist as a local playlist --------------


def test_playlist_pull_imports_new_members_and_builds_playlist(
    db: Session, make_track, tmp_path: Path
):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    two = make_track(filename="/Contents/two.mp3", title="Two")  # path-tier present
    dest = tmp_path / "lib"
    before = tree_digest(usb)
    preview = external_drives.build_pull_preview(db, usb, dest)

    result = external_drives.execute_playlist_pull(
        db, usb, dest,
        device_playlist_id=PAGE_LIST_A,
        expected_fingerprint=preview.fingerprint,
    )

    assert result.imported == 2  # one.mp3 and three.mp3
    assert result.already_in_library == 1  # two.mp3
    assert result.skipped_uncertain == 0
    assert result.skipped_other == 0
    assert result.member_count == 3
    assert result.name == "RIG Mix"
    playlist = db.query(Playlist).filter(Playlist.id == result.playlist_id).one()
    members = (
        db.query(PlaylistTrack)
        .filter(PlaylistTrack.playlist_id == playlist.id)
        .order_by(PlaylistTrack.position)
        .all()
    )
    # Device order 1,2,3: the two freshly imported tracks plus the
    # already-present one, positioned exactly as on the drive.
    titles = [db.get(Track, m.track_id).title for m in members]
    assert titles == ["One", "Two", "Three"]
    assert two.id in [m.track_id for m in members]
    assert [m.position for m in members] == [0, 1, 2]
    assert (dest / "Contents" / "one.mp3").exists() and (dest / "Contents" / "three.mp3").exists()
    assert tree_digest(usb) == before  # the drive is never written to


def test_playlist_pull_preserves_device_order_across_reorder(
    db: Session, make_track, tmp_path: Path
):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    two = make_track(filename="/Contents/two.mp3", title="Two")
    three = make_track(filename="/Contents/three.mp3", title="Three")
    dest = tmp_path / "lib"
    preview = external_drives.build_pull_preview(db, usb, dest)

    # "RIG New" is (3, 2) on the drive: order must round-trip, not sort.
    result = external_drives.execute_playlist_pull(
        db, usb, dest,
        device_playlist_id=PAGE_LIST_B,
        expected_fingerprint=preview.fingerprint,
    )
    members = (
        db.query(PlaylistTrack)
        .filter(PlaylistTrack.playlist_id == result.playlist_id)
        .order_by(PlaylistTrack.position)
        .all()
    )
    assert [m.track_id for m in members] == [three.id, two.id]
    assert result.imported == 0  # both already in the library


def test_playlist_pull_existing_local_name_refuses_before_any_copy(
    db: Session, make_track, tmp_path: Path
):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    _add_local_playlist(db, "RIG Mix", [])
    dest = tmp_path / "lib"
    preview = external_drives.build_pull_preview(db, usb, dest)

    with pytest.raises(external_drives.ExternalDriveError, match="already exists"):
        external_drives.execute_playlist_pull(
            db, usb, dest,
            device_playlist_id=PAGE_LIST_A,
            expected_fingerprint=preview.fingerprint,
        )
    assert db.query(Track).count() == 0
    assert not dest.exists()

    # A distinct name resolves the conflict without merging.
    result = external_drives.execute_playlist_pull(
        db, usb, dest,
        device_playlist_id=PAGE_LIST_A,
        expected_fingerprint=preview.fingerprint,
        playlist_name="RIG Mix (USB)",
    )
    assert result.name == "RIG Mix (USB)"
    assert db.query(Playlist).filter(Playlist.name == "RIG Mix (USB)").count() == 1


def test_playlist_pull_uncertain_member_is_skipped_and_counted(
    db: Session, make_track, tmp_path: Path
):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    # Basename-only candidate with no readable identical file: uncertain,
    # never silently placed into the playlist and never imported.
    make_track(filename="/music/one.mp3", title="One")
    make_track(filename="/Contents/two.mp3", title="Two")
    dest = tmp_path / "lib"
    preview = external_drives.build_pull_preview(db, usb, dest)

    result = external_drives.execute_playlist_pull(
        db, usb, dest,
        device_playlist_id=PAGE_LIST_A,
        expected_fingerprint=preview.fingerprint,
    )
    assert result.skipped_uncertain == 1
    assert result.imported == 1  # only three.mp3
    assert result.member_count == 2
    members = (
        db.query(PlaylistTrack)
        .filter(PlaylistTrack.playlist_id == result.playlist_id)
        .order_by(PlaylistTrack.position)
        .all()
    )
    titles = [db.get(Track, m.track_id).title for m in members]
    assert titles == ["Two", "Three"]
    assert not (dest / "Contents" / "one.mp3").exists()


def test_playlist_pull_unknown_or_folder_id_refuses(db: Session, tmp_path: Path):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    dest = tmp_path / "lib"
    preview = external_drives.build_pull_preview(db, usb, dest)
    for bad_id in (9999, PAGE_LIST_FOLDER):
        with pytest.raises(external_drives.ExternalDriveError):
            external_drives.execute_playlist_pull(
                db, usb, dest,
                device_playlist_id=bad_id,
                expected_fingerprint=preview.fingerprint,
            )
    assert db.query(Playlist).count() == 0
    assert db.query(Track).count() == 0


def test_playlist_pull_stale_fingerprint_refuses(db: Session, tmp_path: Path):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    with pytest.raises(external_drives.PlanChangedError):
        external_drives.execute_playlist_pull(
            db, usb, tmp_path / "lib",
            device_playlist_id=PAGE_LIST_A,
            expected_fingerprint="0" * 64,
        )
    assert db.query(Playlist).count() == 0
    assert db.query(Track).count() == 0


def test_router_playlist_import_end_to_end(
    client: TestClient, db_session: Session, make_track, tmp_path: Path
):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    make_track(filename="/Contents/two.mp3", title="Two")
    dest = tmp_path / "lib"
    resp = client.post(
        "/api/external-drives/preview",
        json={"root": str(usb), "destination": str(dest)},
    )
    assert resp.status_code == 200, resp.text
    fingerprint = resp.json()["fingerprint"]

    # The playlist selection and an explicit ordinal selection can never
    # disagree, so combining them is refused.
    resp = client.post(
        "/api/external-drives/import",
        json={
            "root": str(usb),
            "destination": str(dest),
            "confirm": True,
            "preview_fingerprint": fingerprint,
            "create_playlist_id": PAGE_LIST_A,
            "ordinals": [0],
        },
    )
    assert resp.status_code == 400

    resp = client.post(
        "/api/external-drives/import",
        json={
            "root": str(usb),
            "destination": str(dest),
            "confirm": True,
            "preview_fingerprint": fingerprint,
            "create_playlist_id": PAGE_LIST_A,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["imported"] == 2
    playlist = body["playlist"]
    assert playlist["name"] == "RIG Mix"
    assert playlist["member_count"] == 3
    assert playlist["imported"] == 2
    assert playlist["already_in_library"] == 1
    assert playlist["skipped_uncertain"] == 0
    assert db_session.query(Playlist).count() == 1


def test_playlist_pull_all_missing_members_refuses_without_empty_playlist(
    db: Session, tmp_path: Path
):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    # Remove the audio for every member of "RIG Mix": all missing-file.
    for name in ("one", "two", "three"):
        (usb / "Contents" / f"{name}.mp3").unlink()
    dest = tmp_path / "lib"
    preview = external_drives.build_pull_preview(db, usb, dest)

    with pytest.raises(external_drives.ExternalDriveError, match="no member"):
        external_drives.execute_playlist_pull(
            db, usb, dest,
            device_playlist_id=PAGE_LIST_A,
            expected_fingerprint=preview.fingerprint,
        )
    assert db.query(Playlist).count() == 0
    assert db.query(Track).count() == 0
    assert not dest.exists()


def test_playlist_pull_copied_bytes_match_and_present_tracks_not_recopied(
    db: Session, make_track, tmp_path: Path
):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    make_track(filename="/Contents/two.mp3", title="Two")
    dest = tmp_path / "lib"
    preview = external_drives.build_pull_preview(db, usb, dest)

    external_drives.execute_playlist_pull(
        db, usb, dest,
        device_playlist_id=PAGE_LIST_A,
        expected_fingerprint=preview.fingerprint,
    )
    for name in ("one", "three"):
        copied = dest / "Contents" / f"{name}.mp3"
        assert hashlib.sha256(copied.read_bytes()).hexdigest() == hashlib.sha256(
            (usb / "Contents" / f"{name}.mp3").read_bytes()
        ).hexdigest()
    # the already-present member is referenced, never copied again
    assert not (dest / "Contents" / "two.mp3").exists()


def test_playlist_rollup_exposes_ordered_member_ordinals(db: Session, tmp_path: Path):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    preview = external_drives.build_pull_preview(db, usb)
    mix = next(pl for pl in preview.playlists if pl.name == "RIG Mix")
    new_pl = next(pl for pl in preview.playlists if pl.name == "RIG New")
    assert mix.track_ordinals == [0, 1, 2]  # device order 1,2,3
    assert new_pl.track_ordinals == [2, 1]  # device order 3,2 preserved


def test_post_import_queue_failure_keeps_committed_tracks_and_files(
    db: Session, usb: Path, tmp_path: Path, monkeypatch
):
    import backend.waveform_tasks as waveform_tasks

    def boom(_session):
        raise RuntimeError("queue down")

    monkeypatch.setattr(waveform_tasks, "enqueue_missing_waveforms", boom)
    dest = tmp_path / "lib"
    preview = external_drives.build_pull_preview(db, usb, dest)
    result = external_drives.execute_pull(
        db, usb, dest, expected_fingerprint=preview.fingerprint
    )
    # The waveforms step failed AFTER the library commit: the tracks and
    # their copied files must survive, the failure is reported, and the
    # remaining pipeline steps still ran.
    assert result.imported == 3
    assert db.query(Track).count() == 3
    for name in ("track1", "track2", "twin"):
        assert (dest / "Contents" / f"{name}.mp3").exists()
    assert any("waveforms" in e for e in result.errors)


def test_source_plan_token_ignores_destination_but_binds_source_and_match(tmp_path: Path):
    from dataclasses import replace

    root = tmp_path / "USB"
    root.mkdir()
    source = root / "track.mp3"
    source.write_bytes(b"original")
    entry = external_drives.PullEntry(
        ordinal=0, title="Test", artist="Test", bpm=None, key=None,
        duration_secs=None, device_path="track.mp3", status="present",
        matched_path="/library/one.mp3",
    )
    first = external_drives._preview(root, "rekordbox", 1, [entry], tmp_path / "one")
    second = external_drives._preview(root, "rekordbox", 1, [entry], tmp_path / "two")
    assert first.fingerprint != second.fingerprint
    assert first.source_fingerprint == second.source_fingerprint
    changed_match = external_drives._preview(
        root, "rekordbox", 1, [replace(entry, matched_path="/library/two.mp3")]
    )
    assert first.source_fingerprint != changed_match.source_fingerprint
    source.write_bytes(b"replacement of different length")
    changed_source = external_drives._preview(root, "rekordbox", 1, [entry])
    assert first.source_fingerprint != changed_source.source_fingerprint


# --- playlist update: sync an existing local playlist from the drive ---------


def test_playlist_update_adds_orders_and_keeps_local_only(
    db: Session, make_track, tmp_path: Path
):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    two = make_track(filename="/Contents/two.mp3", title="Two")
    held_elsewhere = make_track(filename="/music/elsewhere.mp3", title="Elsewhere")
    _add_local_playlist(db, "RIG Mix", [two.id, held_elsewhere.id])
    local = db.query(Playlist).filter(Playlist.name == "RIG Mix").one()
    dest = tmp_path / "lib"
    before = tree_digest(usb)
    preview = external_drives.build_pull_preview(db, usb, dest)

    token = external_drives.local_playlist_snapshot_token(
        local.id, local.name, [two.id, held_elsewhere.id]
    )
    result = external_drives.execute_playlist_update(
        db, usb, dest,
        device_playlist_id=PAGE_LIST_A,
        local_playlist_id=local.id,
        expected_fingerprint=preview.fingerprint,
        expected_target_token=token,
    )

    assert result.added_imported == 2  # one.mp3, three.mp3 copied in
    assert result.added_from_library == 0  # two.mp3 was already a member
    assert result.kept_local_only == 1  # held_elsewhere preserved
    assert result.skipped_uncertain == 0
    assert result.member_count == 4
    members = (
        db.query(PlaylistTrack)
        .filter(PlaylistTrack.playlist_id == local.id)
        .order_by(PlaylistTrack.position)
        .all()
    )
    titles = [db.get(Track, m.track_id).title for m in members]
    # device order first, the kept local-only track after, prior order kept
    assert titles == ["One", "Two", "Three", "Elsewhere"]
    assert (dest / "Contents" / "one.mp3").exists()
    assert (dest / "Contents" / "three.mp3").exists()
    assert tree_digest(usb) == before
    # no second playlist appeared
    assert db.query(Playlist).count() == 1


def test_playlist_update_uncertain_member_skipped_local_member_kept(
    db: Session, make_track, tmp_path: Path
):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    # one.mp3 has only a basename-level candidate: unverified, never dropped
    # onto the playlist silently, and the local member it MIGHT be stays.
    maybe_one = make_track(filename="/music/one.mp3", title="One")
    _add_local_playlist(db, "RIG Mix", [maybe_one.id])
    local = db.query(Playlist).filter(Playlist.name == "RIG Mix").one()
    dest = tmp_path / "lib"
    preview = external_drives.build_pull_preview(db, usb, dest)

    token = external_drives.local_playlist_snapshot_token(
        local.id, local.name, [maybe_one.id]
    )
    result = external_drives.execute_playlist_update(
        db, usb, dest,
        device_playlist_id=PAGE_LIST_A,
        local_playlist_id=local.id,
        expected_fingerprint=preview.fingerprint,
        expected_target_token=token,
    )
    assert result.skipped_uncertain == 1
    members = (
        db.query(PlaylistTrack)
        .filter(PlaylistTrack.playlist_id == local.id)
        .order_by(PlaylistTrack.position)
        .all()
    )
    titles = [db.get(Track, m.track_id).title for m in members]
    # unverified device one.mp3 did not import; local maybe-one stays put
    assert "One" in titles
    assert not (dest / "Contents" / "one.mp3").exists()


def test_playlist_update_requires_real_counterpart_and_fingerprint(
    db: Session, make_track, tmp_path: Path
):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    dest = tmp_path / "lib"
    preview = external_drives.build_pull_preview(db, usb, dest)

    with pytest.raises(external_drives.ExternalDriveError):
        external_drives.execute_playlist_update(
            db, usb, dest,
            device_playlist_id=PAGE_LIST_A,
            local_playlist_id=424242,
            expected_fingerprint=preview.fingerprint,
            expected_target_token="irrelevant",
        )
    with pytest.raises(external_drives.PlanChangedError):
        external_drives.execute_playlist_update(
            db, usb, dest,
            device_playlist_id=PAGE_LIST_A,
            local_playlist_id=1,
            expected_fingerprint="0" * 64,
            expected_target_token="irrelevant",
        )
    assert db.query(Track).count() == 0
    assert not dest.exists()


def test_playlist_update_stale_target_rejected_before_copies(
    db: Session, make_track, tmp_path: Path
):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    two = make_track(filename="/Contents/two.mp3", title="Two")
    other = make_track(filename="/music/other.mp3", title="Other")
    _add_local_playlist(db, "RIG Mix", [two.id])
    local = db.query(Playlist).filter(Playlist.name == "RIG Mix").one()
    dest = tmp_path / "lib"
    preview = external_drives.build_pull_preview(db, usb, dest)
    token = external_drives.local_playlist_snapshot_token(
        local.id, local.name, [two.id]
    )

    # The local target changes after the review: membership edit.
    db.add(PlaylistTrack(playlist_id=local.id, track_id=other.id, position=1))
    db.commit()

    with pytest.raises(external_drives.ExternalDriveError, match="changed since the review"):
        external_drives.execute_playlist_update(
            db, usb, dest,
            device_playlist_id=PAGE_LIST_A,
            local_playlist_id=local.id,
            expected_fingerprint=preview.fingerprint,
            expected_target_token=token,
        )
    # refused before any copy, and the local playlist is untouched
    assert not dest.exists()
    members = (
        db.query(PlaylistTrack)
        .filter(PlaylistTrack.playlist_id == local.id)
        .order_by(PlaylistTrack.position)
        .all()
    )
    assert [m.track_id for m in members] == [two.id, other.id]


def test_playlist_update_refuses_device_duplicate_members(
    db: Session, make_track, tmp_path: Path
):
    # The device playlist repeats two.mp3; the local model keeps one row
    # per track in a playlist, so the repeat collapses and is counted.
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB", entry_order_b=(2, 2))
    two = make_track(filename="/Contents/two.mp3", title="Two")
    _add_local_playlist(db, "RIG New", [two.id])
    local = db.query(Playlist).filter(Playlist.name == "RIG New").one()
    dest = tmp_path / "lib"
    preview = external_drives.build_pull_preview(db, usb, dest)
    token = external_drives.local_playlist_snapshot_token(
        local.id, local.name, [two.id]
    )

    with pytest.raises(external_drives.ExternalDriveError, match="repeats tracks"):
        external_drives.execute_playlist_update(
            db, usb, dest,
            device_playlist_id=PAGE_LIST_B,
            local_playlist_id=local.id,
            expected_fingerprint=preview.fingerprint,
            expected_target_token=token,
        )
    assert not dest.exists()
    members = (
        db.query(PlaylistTrack)
        .filter(PlaylistTrack.playlist_id == local.id)
        .order_by(PlaylistTrack.position)
        .all()
    )
    assert [db.get(Track, m.track_id).title for m in members] == ["Two"]


def test_router_playlist_update_flow(
    client: TestClient, db_session: Session, make_track, tmp_path: Path
):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    two = make_track(filename="/Contents/two.mp3", title="Two")
    _add_local_playlist(db_session, "RIG Mix", [two.id])
    local = db_session.query(Playlist).filter(Playlist.name == "RIG Mix").one()
    dest = tmp_path / "lib"
    resp = client.post(
        "/api/external-drives/preview",
        json={"root": str(usb), "destination": str(dest)},
    )
    assert resp.status_code == 200, resp.text
    fingerprint = resp.json()["fingerprint"]
    playlists = resp.json()["playlists"]
    membership = next(pl["membership"] for pl in playlists if pl["id"] == PAGE_LIST_A)
    # The device playlist sits in folder RIG; a same-name local playlist is only
    # a candidate. It is never reported as the counterpart, but the user can
    # pair explicitly by id and the token still binds that exact target.
    assert membership["counterpart_status"] == "candidate-name-match"
    assert membership["counterpart_id"] is None
    assert membership["candidate_id"] == local.id
    assert membership["candidate_name"] == "RIG Mix"
    token = membership["target_token"]
    assert token

    # update without the device playlist is refused
    resp = client.post(
        "/api/external-drives/import",
        json={
            "root": str(usb),
            "destination": str(dest),
            "confirm": True,
            "preview_fingerprint": fingerprint,
            "update_playlist_id": local.id,
            "update_target_token": token,
        },
    )
    assert resp.status_code == 400

    # update without the reviewed target snapshot is refused
    resp = client.post(
        "/api/external-drives/import",
        json={
            "root": str(usb),
            "destination": str(dest),
            "confirm": True,
            "preview_fingerprint": fingerprint,
            "create_playlist_id": PAGE_LIST_A,
            "update_playlist_id": local.id,
        },
    )
    assert resp.status_code == 400

    # a target that changed since the review is refused, with no copies made
    resp = client.post(
        "/api/external-drives/import",
        json={
            "root": str(usb),
            "destination": str(dest),
            "confirm": True,
            "preview_fingerprint": fingerprint,
            "create_playlist_id": PAGE_LIST_A,
            "update_playlist_id": local.id,
            "update_target_token": "0" * 16,
        },
    )
    assert resp.status_code == 400
    assert "changed since the review" in resp.json()["detail"]
    assert not dest.exists()

    resp = client.post(
        "/api/external-drives/import",
        json={
            "root": str(usb),
            "destination": str(dest),
            "confirm": True,
            "preview_fingerprint": fingerprint,
            "create_playlist_id": PAGE_LIST_A,
            "update_playlist_id": local.id,
            "update_target_token": token,
        },
    )
    assert resp.status_code == 200, resp.text
    update = resp.json()["playlist_update"]
    assert update["playlist_id"] == local.id
    assert update["added_imported"] == 2
    assert update["member_count"] == 3
    assert update["kept_local_only"] == 0
    assert db_session.query(Playlist).count() == 1


def test_playlist_update_write_reservation_blocks_concurrent_editor(
    db: Session, make_track, tmp_path: Path
):
    from sqlalchemy import create_engine, event
    import sqlite3

    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    two = make_track(filename="/Contents/two.mp3", title="Two")
    three = make_track(filename="/Contents/three.mp3", title="Three")
    _add_local_playlist(db, "RIG New", [two.id, three.id])
    local = db.query(Playlist).filter(Playlist.name == "RIG New").one()
    local_id = local.id
    db.commit()
    filename = tmp_path / "concurrent.db"
    raw = db.get_bind().raw_connection()
    with sqlite3.connect(filename) as target:
        raw.driver_connection.backup(target)
    raw.close()
    engine = create_engine(f"sqlite:///{filename}")
    attempts = []
    @event.listens_for(engine, "before_cursor_execute")
    def competing_editor(conn, cursor, statement, parameters, context, many):
        if statement.lstrip().upper().startswith("DELETE FROM PLAYLIST_TRACKS"):
            with sqlite3.connect(filename, timeout=0) as writer:
                with pytest.raises(sqlite3.OperationalError, match="locked"):
                    writer.execute("UPDATE playlists SET name='concurrent' WHERE id=?", (local_id,))
            attempts.append(True)
    try:
        with Session(engine) as session:
            dest = tmp_path / "dest"
            preview = external_drives.build_pull_preview(session, usb, dest)
            token = external_drives.local_playlist_snapshot_token(local_id, "RIG New", [two.id, three.id])
            external_drives.execute_playlist_update(
                session, usb, dest, device_playlist_id=PAGE_LIST_B,
                local_playlist_id=local_id, expected_fingerprint=preview.fingerprint,
                expected_target_token=token,
            )
            assert session.get(Playlist, local_id).name == "RIG New"
        assert attempts
    finally:
        engine.dispose()


@pytest.mark.parametrize("change", ["rename", "order"])
def test_playlist_update_target_changed_during_copy_is_preserved(
    db: Session, make_track, tmp_path: Path, monkeypatch, change: str
):
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB")
    two = make_track(filename="/Contents/two.mp3", title="Two")
    held = make_track(filename="/music/held.mp3", title="Held")
    _add_local_playlist(db, "RIG Mix", [two.id, held.id])
    local = db.query(Playlist).filter(Playlist.name == "RIG Mix").one()
    local_id = local.id
    original = external_drives.execute_pull
    def edit_during_copy(*args, **kwargs):
        result = original(*args, **kwargs)
        if change == "rename":
            db.get(Playlist, local_id).name = "Edited concurrently"
        else:
            rows = db.query(PlaylistTrack).filter(PlaylistTrack.playlist_id == local_id).all()
            for row in rows:
                row.position = 1 - row.position
        db.commit()
        return result
    monkeypatch.setattr(external_drives, "execute_pull", edit_during_copy)
    dest = tmp_path / "lib"
    preview = external_drives.build_pull_preview(db, usb, dest)
    token = external_drives.local_playlist_snapshot_token(local_id, "RIG Mix", [two.id, held.id])
    with pytest.raises(external_drives.ExternalDriveError, match="imported tracks stay"):
        external_drives.execute_playlist_update(
            db, usb, dest, device_playlist_id=PAGE_LIST_A,
            local_playlist_id=local_id, expected_fingerprint=preview.fingerprint,
            expected_target_token=token,
        )
    assert (dest / "Contents" / "one.mp3").exists()
    assert db.query(Track).filter(Track.title == "One").count() == 1
    rows = db.query(PlaylistTrack).filter(PlaylistTrack.playlist_id == local_id).order_by(PlaylistTrack.position).all()
    assert [row.track_id for row in rows] == ([held.id, two.id] if change == "order" else [two.id, held.id])
    assert db.get(Playlist, local_id).name == ("Edited concurrently" if change == "rename" else "RIG Mix")

def test_playlist_pull_repeated_device_track_refuses_before_any_copy(
    db: Session, tmp_path: Path
):
    # "RIG New" lists track 3 twice: local playlists cannot represent a
    # repeated track (migration 0011), so the pull must refuse before
    # copying anything, not fail the commit after the files are copied.
    usb = make_rekordbox_usb_with_playlists(tmp_path / "RB", entry_order_b=(3, 3))
    dest = tmp_path / "lib"
    preview = external_drives.build_pull_preview(db, usb, dest)

    with pytest.raises(external_drives.ExternalDriveError, match="repeats tracks"):
        external_drives.execute_playlist_pull(
            db, usb, dest,
            device_playlist_id=PAGE_LIST_B,
            expected_fingerprint=preview.fingerprint,
        )
    assert db.query(Track).count() == 0
    assert db.query(Playlist).count() == 0
    assert not dest.exists()


def test_playlist_pull_resolved_duplicate_refuses_before_copy(db, tmp_path, monkeypatch):
    usb = make_rekordbox_usb_with_playlists(tmp_path / 'RB')
    dest = tmp_path / 'lib'
    preview = external_drives.build_pull_preview(db, usb, dest)
    monkeypatch.setattr(external_drives, '_library_track_id', lambda index, entry: 42)
    with pytest.raises(external_drives.ExternalDriveError, match='same library track'):
        external_drives.execute_playlist_pull(db, usb, dest, device_playlist_id=PAGE_LIST_A,
            expected_fingerprint=preview.fingerprint)
    assert db.query(Track).count() == 0
    assert db.query(Playlist).count() == 0
    assert not dest.exists()


def test_playlist_pull_postcopy_duplicate_reports_retained_tracks(db, tmp_path, monkeypatch):
    usb = make_rekordbox_usb_with_playlists(tmp_path / 'RB', entry_order_b=(3, 2))
    dest = tmp_path / 'lib'
    preview = external_drives.build_pull_preview(db, usb, dest)
    original = external_drives.execute_pull
    def coalesced(*args, **kwargs):
        result = original(*args, **kwargs)
        ids = list(result.imported_by_ordinal)
        if len(ids) >= 2:
            result.imported_by_ordinal[ids[1]] = result.imported_by_ordinal[ids[0]]
        return result
    monkeypatch.setattr(external_drives, 'execute_pull', coalesced)
    with pytest.raises(external_drives.ExternalDriveError, match='imported tracks stay in the library'):
        external_drives.execute_playlist_pull(db, usb, dest, device_playlist_id=PAGE_LIST_B,
            expected_fingerprint=preview.fingerprint)
    assert db.query(Track).count() == 2
    assert db.query(Playlist).count() == 0
    assert dest.exists()


def test_check_endpoint_is_read_only_and_labels_unchecked_engine(client: TestClient, usb: Path, tmp_path: Path):
    def tree(root: Path):
        return {str(f.relative_to(root)): hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(root.rglob("*")) if f.is_file()}

    before = tree(usb)
    body = client.post("/api/external-drives/check", json={"root": str(usb)}).json()
    assert body["kind"] == "rekordbox" and body["checked"] is True
    assert isinstance(body["error_count"], int)
    assert tree(usb) == before  # a check never writes

    engine = tmp_path / "ENGINE_USB"
    engine.mkdir()
    make_engine_usb(engine, [{"path": "Contents/engine1.mp3", "title": "Engine One"}])
    assert client.post("/api/external-drives/check", json={"root": str(engine)}).json()["checked"] is False
    assert client.post("/api/external-drives/check", json={"root": str(tmp_path)}).status_code == 404


def test_field_comparison_is_per_track_read_only_and_says_cues_are_not_compared(
    client: TestClient, db: Session, make_track, tmp_path: Path
):
    usb = renamed_usb(tmp_path, title="Renamed Tune")
    library_file = tmp_path / "music" / "dj-edit-01.mp3"
    library_file.parent.mkdir(parents=True)
    shutil.copy2(FIXTURES / "silence.mp3", library_file)
    track = make_track(filename=str(library_file), title="Renamed Tune (Old Title)", artist="Lane 8")
    before = tree_digest(usb)

    body = client.post("/api/external-drives/fields", json={"root": str(usb)}).json()

    assert tree_digest(usb) == before
    assert [t["track_id"] for t in body["tracks"]] == [track.id]
    row = body["tracks"][0]
    assert [f["field"] for f in row["fields"]] == ["title"]
    assert row["fields"][0]["drive"] == "Renamed Tune"
    assert row["fields"][0]["library"] == "Renamed Tune (Old Title)"
    assert "cues" in body["not_compared"] and "not available" in body["not_compared"]["cues"]
    assert body["fingerprint"]

    # identical metadata produces no row at all
    track.title = "renamed tune"  # case-only difference is not a difference
    db.commit()
    again = client.post("/api/external-drives/fields", json={"root": str(usb)}).json()
    assert again["tracks"] == []


def _reviewed(body: dict, track_id: int, field: str) -> dict:
    """The change a client sends: the pair plus the drive/library values it reviewed."""
    f = next(x for t in body["tracks"] if t["track_id"] == track_id for x in t["fields"] if x["field"] == field)
    return {"track_id": track_id, "field": field, "drive": f["drive"], "library": f["library"]}


def test_field_apply_is_bound_to_review_and_writes_library_only(
    client: TestClient, db: Session, make_track, tmp_path: Path
):
    usb = renamed_usb(tmp_path, title="Renamed Tune")
    library_file = tmp_path / "music" / "dj-edit-01.mp3"
    library_file.parent.mkdir(parents=True)
    shutil.copy2(FIXTURES / "silence.mp3", library_file)
    track = make_track(filename=str(library_file), title="Old Title", artist="Lane 8")
    body = client.post("/api/external-drives/fields", json={"root": str(usb)}).json()
    fp = body["fingerprint"]
    change = _reviewed(body, track.id, "title")
    before = tree_digest(usb)
    pair = lambda f: {"track_id": track.id, "field": f, "drive": "x", "library": "y"}

    # a stale fingerprint, a field that does not differ, and bpm are all refused
    for bad in (
        {"preview_fingerprint": "stale", "changes": [change]},
        {"preview_fingerprint": fp, "changes": [pair("artist")]},
        {"preview_fingerprint": fp, "changes": [pair("bpm")]},
        {"preview_fingerprint": fp, "changes": []},
    ):
        assert client.post("/api/external-drives/fields/apply", json={"root": str(usb), **bad}).status_code == 409
    # reviewed values are required by the API, not optional: a bare pair is rejected
    bare = {"track_id": track.id, "field": "title"}
    assert client.post("/api/external-drives/fields/apply", json={"root": str(usb), "preview_fingerprint": fp, "changes": [bare]}).status_code == 422
    # and the backend refuses a change that arrives without them
    with pytest.raises(external_drives.FieldChangeRefused):
        external_drives.apply_field_changes(db, usb, fp, [bare])
    db.refresh(track)
    assert track.title == "Old Title"

    ok = client.post("/api/external-drives/fields/apply", json={"root": str(usb), "preview_fingerprint": fp, "changes": [change]})
    assert ok.status_code == 200 and ok.json()["applied"][0]["value"] == "Renamed Tune"
    db.refresh(track)
    assert track.title == "Renamed Tune"
    assert tree_digest(usb) == before  # the drive is never written


def two_track_usb(tmp_path: Path, titles=("Drive One", "Drive Two"), paths=("/Contents/dj-edit-01.mp3", "/Contents/dj-edit-02.mp3")) -> Path:
    root = tmp_path / "TWO_USB"
    root.mkdir()
    make_rekordbox_usb(root, [track_spec(i + 1, t, p, artist_id=1) for i, (t, p) in enumerate(zip(titles, paths))])
    for p in paths:
        put_audio(root, p)
    return root


def _lib(tmp_path: Path, name: str) -> Path:
    f = tmp_path / "music" / name
    f.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(FIXTURES / "silence.mp3", f)
    return f


def test_field_apply_is_atomic_across_tracks_with_late_invalid_or_stale_member(
    client: TestClient, db: Session, make_track, tmp_path: Path
):
    usb = two_track_usb(tmp_path)
    t1 = make_track(filename=str(_lib(tmp_path, "dj-edit-01.mp3")), title="Old One", artist="Lane 8")
    t2 = make_track(filename=str(_lib(tmp_path, "dj-edit-02.mp3")), title="Old Two", artist="Lane 8")
    body = client.post("/api/external-drives/fields", json={"root": str(usb)}).json()
    assert {t["track_id"] for t in body["tracks"]} == {t1.id, t2.id}
    fp = body["fingerprint"]
    url = "/api/external-drives/fields/apply"

    # valid first member, then a late invalid one (bpm / unknown track / non-differing field): nothing is written
    for late in (
        {"track_id": t2.id, "field": "bpm", "drive": 1.0, "library": None},
        {"track_id": 99999, "field": "title", "drive": "x", "library": "y"},
        {"track_id": t2.id, "field": "artist", "drive": "x", "library": "y"},
    ):
        r = client.post(url, json={"root": str(usb), "preview_fingerprint": fp, "changes": [_reviewed(body, t1.id, "title"), late]})
        assert r.status_code == 409
        db.expire_all()
        assert db.get(type(t1), t1.id).title == "Old One"
        assert db.get(type(t2), t2.id).title == "Old Two"

    # a library value that moved after review makes the whole batch stale
    reviewed = {t["track_id"]: {f["field"]: f for f in t["fields"]} for t in body["tracks"]}
    def rev(t):
        f = reviewed[t.id]["title"]
        return {"track_id": t.id, "field": "title", "drive": f["drive"], "library": f["library"]}
    t2.title = "Edited elsewhere"
    db.commit()
    stale = client.post(url, json={"root": str(usb), "preview_fingerprint": fp, "changes": [rev(t1), rev(t2)]})
    assert stale.status_code == 409
    db.expire_all()
    assert db.get(type(t1), t1.id).title == "Old One"  # the valid first member was not written
    t2.title = "Old Two"
    db.commit()

    # a fresh, fully valid batch writes both, and the same pair twice is one write
    body = client.post("/api/external-drives/fields", json={"root": str(usb)}).json()
    both = [_reviewed(body, t1.id, "title"), _reviewed(body, t2.id, "title"), _reviewed(body, t1.id, "title")]
    ok = client.post(url, json={"root": str(usb), "preview_fingerprint": body["fingerprint"], "changes": both})
    assert ok.status_code == 200 and len(ok.json()["applied"]) == 2
    db.expire_all()
    assert db.get(type(t1), t1.id).title == "Drive One" and db.get(type(t2), t2.id).title == "Drive Two"


def test_field_comparison_duplicate_drive_entries_never_create_conflicting_writes(
    client: TestClient, db: Session, make_track, tmp_path: Path
):
    usb = two_track_usb(tmp_path, titles=("Copy A", "Copy B"), paths=("/Contents/a/x.mp3", "/Contents/b/x.mp3"))
    track = make_track(filename=str(_lib(tmp_path, "x.mp3")), title="Library Title", artist="Lane 8")
    body = client.post("/api/external-drives/fields", json={"root": str(usb)}).json()
    rows = [t for t in body["tracks"] if t["track_id"] == track.id]
    assert len(rows) <= 1  # one row per library track, however many drive entries match it
    for row in rows:
        title = [f for f in row["fields"] if f["field"] == "title"]
        assert all(not f["applicable"] for f in title if f["drive"] in ("Copy A", "Copy B")) or len(title) == 1
    # taking whatever is offered writes exactly one consistent value
    taken = [{"track_id": track.id, "field": f["field"], "drive": f["drive"], "library": f["library"]} for r in rows for f in r["fields"] if f["applicable"] and f["field"] == "title"]
    if taken:
        r = client.post("/api/external-drives/fields/apply", json={"root": str(usb), "preview_fingerprint": body["fingerprint"], "changes": taken})
        assert r.status_code == 200 and len(r.json()["applied"]) == 1


def test_field_comparison_conflicting_duplicate_entries_are_not_takeable(db: Session, make_track, tmp_path: Path):
    from types import SimpleNamespace

    f = _lib(tmp_path, "x.mp3")
    track = make_track(filename=str(f), title="Library Title", artist="Lane 8")
    def entry(ordinal, title):
        return external_drives.PullEntry(ordinal=ordinal, title=title, artist="Lane 8", bpm=None, key=None,
                                         duration_secs=None, device_path=str(f), status="present")
    # two drive entries resolve to the same library track
    same = external_drives.compare_matched_fields(db, SimpleNamespace(entries=[entry(0, "Same"), entry(1, "Same")], fingerprint="x"))
    assert len(same["tracks"]) == 1 and same["tracks"][0]["fields"][0]["applicable"] is True
    conflict = external_drives.compare_matched_fields(db, SimpleNamespace(entries=[entry(0, "A"), entry(1, "B")], fingerprint="x"))
    assert len(conflict["tracks"]) == 1
    field = conflict["tracks"][0]["fields"][0]
    assert field["applicable"] is False and "twice" in field["conflict"]

    # One duplicate equals the library and the other differs: still a conflict,
    # in either order, never "the differing one wins".
    for order in ((entry(0, "Library Title"), entry(1, "B")), (entry(0, "B"), entry(1, "Library Title"))):
        mixed = external_drives.compare_matched_fields(db, SimpleNamespace(entries=list(order), fingerprint="x"))
        (row,) = mixed["tracks"]
        (title,) = [f for f in row["fields"] if f["field"] == "title"]
        assert title["applicable"] is False and "twice" in title["conflict"]
    # both equal to the library: nothing differs
    quiet = external_drives.compare_matched_fields(db, SimpleNamespace(entries=[entry(0, "Library Title"), entry(1, "library title")], fingerprint="x"))
    assert quiet["tracks"] == []


# --- export impact (read-only; a rebuild is not an update) ----------------------


def test_export_impact_describes_a_rebuild_writes_nothing_and_is_not_executable(db: Session, make_track, client: TestClient, usb: Path):
    audio = usb / "Contents/track1.mp3"
    t1 = make_track(filename=str(audio), title="Bright Lights")
    t2 = make_track(filename="/nowhere/missing.mp3", title="Gone")
    _add_local_playlist(db, "Set A", [t1.id, t2.id])
    from backend.models import Playlist

    pid = db.query(Playlist).filter(Playlist.name == "Set A").one().id
    before = tree_digest(usb)

    res = client.post("/api/external-drives/export/impact", json={"root": str(usb), "playlist_ids": [pid]})

    assert res.status_code == 200
    body = res.json()
    assert body["mode"] == "rebuild"
    assert body["selected"] == [{"id": pid, "name": "Set A", "tracks": 1, "missing_audio": 1}]
    assert body["drive"]["read"] is True and body["drive"]["tracks"] == 4
    assert body["deletes"] == []
    assert body["executable"] is False
    assert "PIONEER/rekordbox/export.pdb" in body["rewrites"]
    assert tree_digest(usb) == before  # nothing written


def test_export_impact_refuses_a_non_rekordbox_folder(client: TestClient, tmp_path: Path):
    res = client.post("/api/external-drives/export/impact", json={"root": str(tmp_path), "playlist_ids": []})
    assert res.status_code == 404


def test_preview_copy_candidates_are_response_only_not_identity_or_import_eligibility(client, db_session, usb, tmp_path, monkeypatch):
    from backend.sync_common import suggestions
    before = external_drives.build_pull_preview(db_session, usb)
    entry = next(item for item in before.entries if item.status == 'new')
    monkeypatch.setattr(suggestions, 'suggest_copies', lambda entries, tracks: {entry.ordinal: [{'track_id': 999, 'title': 'Possible copy', 'evidence': 'audio unverified'}]})
    response = client.post('/api/external-drives/preview', json={'root': str(usb)})
    assert response.status_code == 200
    body = response.json()
    assert body['fingerprint'] == before.fingerprint
    row = next(item for item in body['entries'] if item['ordinal'] == entry.ordinal)
    assert row['status'] == 'new' and row['candidates'][0]['track_id'] == 999
    # Internal import preview never consumes candidate IDs from the response.
    after = external_drives.build_pull_preview(db_session, usb)
    assert after.fingerprint == before.fingerprint
    assert next(item for item in after.entries if item.ordinal == entry.ordinal).status == 'new'


@pytest.mark.parametrize('status,matched,expected', [
    ('present', True, True), ('new', True, False),
    ('uncertain', True, False), ('present', False, False),
])
def test_preview_waveform_identity_requires_verified_match(client, db_session, usb, make_track, monkeypatch, status, matched, expected):
    from dataclasses import replace
    track = make_track(filename='/synthetic/library/audio.mp3')
    original = external_drives.build_pull_preview(db_session, usb)
    entry = replace(original.entries[0], status=status, matched_path=track.filename if matched else None)
    monkeypatch.setattr(external_drives, 'build_pull_preview', lambda *args, **kwargs: replace(original, entries=[entry]))
    before = tree_digest(usb)
    response = client.post('/api/external-drives/preview', json={'root': str(usb)})
    assert response.status_code == 200
    row = response.json()['entries'][0]
    assert row['matched_track_id'] == (track.id if expected else None)
    assert row['status'] == status
    assert tree_digest(usb) == before
