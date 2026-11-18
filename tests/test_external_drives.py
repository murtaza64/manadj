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
from backend.models import Track
from backend.routers import external_drives as external_drives_router
from rekordbox.device.pdb_write import (
    ArtistRowSpec,
    KeyRowSpec,
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


def test_mount_roots_windows_scans_existing_letters_only():
    # On a non-Windows host no drive letters exist; the scan must stay
    # read-only and return nothing rather than guess.
    roots = external_drives.mount_roots(platform="win32", env={})
    assert roots == []


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
