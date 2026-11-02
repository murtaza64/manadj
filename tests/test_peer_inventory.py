"""Read-only production API between independently migrated disposable libraries."""
import copy
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from backend.database import apply_sqlite_pragmas, get_db
from backend.models import Track
from backend.routers.device_sync import build_snapshot

A = "00000000-0000-4000-8000-000000000001"
B = "00000000-0000-4000-8000-000000000002"
LOGICAL = "00000000-0000-4000-8000-000000000003"


@pytest.fixture
def library(tmp_path):
    from backend.peer_inventory.router import router
    engines = []

    def make(name, rows):
        root = tmp_path / name
        root.mkdir()
        engine = create_engine(f"sqlite:///{root / 'library.db'}", connect_args={"check_same_thread": False})
        event.listen(engine, "connect", apply_sqlite_pragmas)
        engines.append(engine)
        with engine.connect() as connection:
            cfg = Config(str(Path(__file__).parents[1] / "alembic.ini"))
            cfg.attributes.update(connection=connection, configure_logger=False)
            command.upgrade(cfg, "head")
        sessions = sessionmaker(bind=engine, autoflush=False)
        with sessions() as db:
            for row in rows:
                db.add(Track(**row))
            db.commit()
        app = FastAPI()
        app.include_router(router, prefix="/api/peer-inventory")

        def database():
            with sessions() as db:
                yield db
        app.dependency_overrides[get_db] = database
        return SimpleNamespace(client=TestClient(app), engine=engine, sessions=sessions)

    yield make
    for engine in engines:
        engine.dispose()


def config(replica=A, root="/one/music", flavor="posix", bindings=None):
    return {"replica_id": replica, "roots": [{"key": "tracks", "path": root, "flavor": flavor}],
            "logical_ids": bindings or {}}


def export(peer, request):
    response = peer.client.post("/api/peer-inventory/export", json=request)
    assert response.status_code == 200, response.text
    return response.json()


def compare(peer, local, remote):
    response = peer.client.post("/api/peer-inventory/compare", json={"local": local, "remote": remote})
    assert response.status_code == 200, response.text
    return response.json()


def dump(peer):
    with peer.engine.connect() as connection:
        return "\n".join(connection.connection.driver_connection.iterdump())


def test_real_two_library_api_is_read_only_and_ids_hashes_paths_are_not_identity(library):
    a = library("a", [{"id": 1, "filename": "/one/music/same.wav", "title": "One", "artist": "DJ"},
                      {"id": 2, "filename": "/one/music/second.wav", "title": "Other"}])
    b = library("b", [{"id": 88, "filename": r"D:\Audio\same.wav", "title": "One", "artist": "DJ"},
                      {"id": 1, "filename": r"D:\Audio\unrelated.wav", "title": "Unrelated"}])
    before = dump(a), dump(b)
    remote = export(a, config())
    assert remote["tracks"][0]["logical_track_id"] is None
    assert remote["tracks"][0]["legacy_hash_hint"] is None
    assert "/one/music" not in json.dumps(remote) and "filename" not in json.dumps(remote)
    report = compare(b, config(B, r"D:\Audio", "windows"), remote)
    row = report["items"][0]
    assert row["source_local_id"] == 1 and row["local_id_overlap"] is True
    assert row["status"] == "candidate" and row["candidates"][0]["local_id"] == 88
    assert "relative_location" in row["candidates"][0]["reasons"]
    assert row["resolved_local_id"] is None
    assert report["items"][1]["status"] == "unresolved"
    assert report["local_without_candidate_ids"] == [1]
    assert all(value is False for value in report["capabilities"].values())
    assert (dump(a), dump(b)) == before
    assert compare(b, config(B, r"D:\Audio", "windows"), remote) == report  # retry is a pure read


def test_explicit_uuid_claims_remain_separate_from_hash_and_report_divergence_and_ambiguity(library):
    a = library("a", [{"id": 1, "filename": "/one/music/a.wav", "title": "Before", "file_hash": "a" * 64}])
    b = library("b", [{"id": 7, "filename": "/two/a.wav", "title": "After", "file_hash": "a" * 64},
                      {"id": 8, "filename": "/two/b.wav", "title": "Other", "file_hash": "a" * 64}])
    remote = export(a, config(bindings={"1": LOGICAL}))
    row = compare(b, config(B, "/two", bindings={"7": LOGICAL}), remote)["items"][0]
    assert row["status"] == "ambiguous" and row["candidate_total"] == 2
    assert row["resolved_local_id"] is None
    first = row["candidates"][0]
    assert first["local_id"] == 7 and "logical_id_claim" in first["reasons"]
    assert "title" in first["divergent_fields"]
    assert "legacy_hash_hint" in row["candidates"][1]["reasons"]
    assert remote["tracks"][0]["logical_track_id"] == LOGICAL


def test_reused_id_is_a_changed_snapshot_not_a_new_global_identity(library):
    a = library("a", [{"id": 1, "filename": "/one/music/new.wav", "title": "Replacement"}])
    remote = export(a, config())
    with a.sessions() as db:
        db.query(Track).filter(Track.id == 1).update({"filename": "/one/music/reused.wav", "title": "Different"})
        db.commit()
    row = compare(a, config(), remote)["items"][0]
    assert row["origin_row_changed"] is True
    assert row["resolved_local_id"] is None
    assert row["status"] == "unresolved"


@pytest.mark.parametrize("mutation", ["version", "bool-version", "duplicate-row", "unsafe-path", "unknown-field"])
def test_import_rejects_unknown_or_unsafe_contract_without_writes(library, mutation):
    a = library("a", [{"id": 1, "filename": "/one/music/a.wav"}])
    remote = export(a, config())
    if mutation == "version":
        remote["version"] = 2
    elif mutation == "bool-version":
        remote["version"] = True
    elif mutation == "duplicate-row":
        remote["tracks"].append(copy.deepcopy(remote["tracks"][0]))
    elif mutation == "unsafe-path":
        remote["tracks"][0]["location"]["parts"] = ["..", "private"]
    else:
        remote["audio_rev"] = "not-a-logical-id"
    before = dump(a)
    response = a.client.post("/api/peer-inventory/compare", json={"local": config(), "remote": remote})
    assert response.status_code == 422, response.text
    assert dump(a) == before


def test_unmapped_missing_files_hashes_and_archive_are_facts_not_availability_or_deletes(library):
    a = library("a", [{"id": 1, "filename": "/elsewhere/missing.wav", "title": "Missing"}])
    body = export(a, config())
    assert body["tracks"][0]["location"] is None
    assert body["tracks"][0]["availability"] == "not_checked"
    assert body["tracks"][0]["logical_track_id"] is None
    assert body["tracks"][0]["legacy_hash_hint"] is None


def test_stream_budget_duplicate_keys_and_local_control(library):
    a = library("a", [])
    assert a.client.post("/api/peer-inventory/export", content='{"replica_id":"x","replica_id":"y"}').status_code == 422
    assert a.client.post("/api/peer-inventory/compare", content=b" " * (4 * 1024 * 1024 + 1)).status_code == 413
    assert a.client.post("/api/peer-inventory/export", json=config(), headers={"Origin": "https://evil.invalid"}).status_code == 403
    assert a.client.post("/api/peer-inventory/export", json=config(), headers={"Origin": "http://["}).status_code == 403
    assert a.client.post("/api/peer-inventory/export", json=config(), headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
    remote_client = TestClient(a.client.app, client=("192.0.2.10", 1234))
    assert remote_client.post("/api/peer-inventory/export", json=config()).status_code == 403


def test_phone_snapshot_namespace_and_journal_schema_are_unchanged(library):
    a = library("a", [{"id": 5, "filename": "/one/music/a.wav", "title": "Phone reference"}])
    with a.sessions() as db:
        before = build_snapshot(db)
    snapshot = export(a, config())
    compare(a, config(), snapshot)
    with a.sessions() as db:
        after = build_snapshot(db)
    before.pop("generated_at")
    after.pop("generated_at")
    assert before == after
    assert after["version"] == 1 and after["tracks"][0]["id"] == 5


def test_phone_pairing_does_not_expose_inventory_management():
    from backend.device_listener import PAIR_HEADER, build_app
    client = TestClient(build_app(lambda: "ABCDE-FGHJK"))
    for route in ("export", "compare"):
        response = client.post(f"/api/peer-inventory/{route}", json=config(),
                               headers={PAIR_HEADER: "ABCDE-FGHJK"})
        assert response.status_code == 404


def test_portable_windows_unc_longest_root_and_unknown_logical_binding(library):
    a = library("a", [{"id": 1, "filename": r"\\NAS\Music\Folder\a.wav"}])
    request = config(root=r"\\nas\music", flavor="windows")
    request["roots"].append({"key": "selected", "flavor": "windows", "path": r"\\NAS\Music\Folder"})
    row = export(a, request)["tracks"][0]
    assert row["location"] == {"root_key": "selected", "parts": ["a.wav"]}
    request["logical_ids"] = {"2": LOGICAL}
    assert a.client.post("/api/peer-inventory/export", json=request).status_code == 422
    request = config(root="C:relative", flavor="windows")
    assert a.client.post("/api/peer-inventory/export", json=request).status_code == 422


def test_candidate_expansion_is_bounded_and_never_silently_picks_first(library):
    a = library("a", [{"id": 1, "filename": "/one/music/a.wav", "title": "Same", "artist": "DJ"}])
    b = library("b", [{"id": n, "filename": f"/two/{n}.wav", "title": "Same", "artist": "DJ"}
                      for n in range(1, 32)])
    row = compare(b, config(B, "/two"), export(a, config()))["items"][0]
    assert row["candidate_total"] == 31 and len(row["candidates"]) == 20
    assert row["status"] == "ambiguous" and row["resolved_local_id"] is None


def test_disappeared_remote_rows_are_not_deletions_and_no_media_io_is_needed(library):
    a = library("a", [{"id": 1, "filename": "/one/music/not-present.wav"}])
    remote = export(a, config(B))
    remote["tracks"] = []
    before = dump(a)
    report = compare(a, config(), remote)
    assert report["items"] == [] and report["capabilities"]["merge"] is False
    assert report["local_without_candidate_ids"] == [1]  # not a deletion instruction
    assert dump(a) == before
