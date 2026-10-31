"""Actual release files, restart receipts and HTTP boundary; no app bootstrap."""

import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.release_notes import ReleaseNotes, identity, load_release
from backend.routers.release_notes import make_router
from scripts.release.metadata import cut_metadata, stage_metadata


def cut(tmp_path, version="1.2.3", body="Notes — café\n- <b>plain text</b>"):
    source = tmp_path / "source"
    source.mkdir(exist_ok=True)
    (source / "CHANGELOG.md").write_text(f"## [{version}]\n\n{body}\n", encoding="utf-8")
    destination = tmp_path / version
    build = cut_metadata(source, version, "a" * 40, destination)
    return destination, build


def test_cut_load_seen_restart_and_other_release(tmp_path):
    directory, build = cut(tmp_path)
    root = tmp_path / "install"
    service = ReleaseNotes(load_release(directory), root)
    rid = build["release_id"]
    assert service.current(rid)["seen"] is False
    assert service.current("b" * 64) is None
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(service.acknowledge, [rid] * 8))
    restarted = ReleaseNotes(load_release(directory), root)
    assert restarted.current(rid)["seen"] is True
    assert list(restarted.seen_dir.iterdir()) == [restarted.seen_dir / f"{rid}.json"]
    other_dir, other = cut(tmp_path, "1.2.4")
    newer = ReleaseNotes(load_release(other_dir), root)
    with pytest.raises(ValueError):
        newer.acknowledge(rid)
    assert newer.current(other["release_id"])["seen"] is False
    assert restarted.current(rid)["seen"] is True


@pytest.mark.parametrize("damage", ["missing", "malformed", "wrong-id", "changed-body", "oversize", "wrong-schema"])
def test_invalid_metadata_is_not_a_release(tmp_path, damage):
    directory, build = cut(tmp_path)
    path = directory / "release-notes.json"
    notes = json.loads(path.read_text())
    if damage == "missing":
        path.unlink()
    elif damage == "malformed":
        path.write_text("not JSON")
    else:
        if damage == "wrong-id":
            notes["release_id"] = "f" * 64
        elif damage == "changed-body":
            notes["body"] = "different release notes"
        elif damage == "oversize":
            notes["body"] = "x" * 32769
        else:
            notes["schema"] = 2
        path.write_text(json.dumps(notes))
    assert load_release(directory) is None
    assert ReleaseNotes(None, tmp_path).current(build["release_id"]) is None


def test_corrupt_receipt_and_failed_write_never_claim_seen(tmp_path, monkeypatch):
    directory, build = cut(tmp_path)
    service = ReleaseNotes(load_release(directory), tmp_path / "install")
    service.seen_dir.mkdir(parents=True)
    receipt = service.seen_dir / f'{build["release_id"]}.json'
    receipt.write_text("broken")
    assert not service.current(build["release_id"])["seen"]
    def fail(*args):
        raise OSError("decoy disk full")
    monkeypatch.setattr("backend.release_notes.os.replace", fail)
    with pytest.raises(OSError):
        service.acknowledge(build["release_id"])
    assert not service.current(build["release_id"])["seen"]
    assert list(service.seen_dir.iterdir()) == [receipt]


def test_router_exact_frontend_and_stale_ack(tmp_path):
    directory, build = cut(tmp_path)
    service = ReleaseNotes(load_release(directory), tmp_path / "install")
    app = FastAPI()
    app.include_router(make_router(service))
    with TestClient(app) as client:
        assert client.get("/api/release", params={"release_id": "b" * 64}).json() == {"release": None}
        response = client.get("/api/release", params={"release_id": build["release_id"]})
        assert response.headers["cache-control"] == "no-store"
        assert response.json()["release"]["seen"] is False
        assert client.post("/api/release/seen", json={"release_id": "b" * 64}).status_code == 409
        assert client.post("/api/release/seen", json={"release_id": "../escape"}).status_code == 422
        assert client.post("/api/release/seen", json={"release_id": build["release_id"]}).json() == {"seen": True}
        # Replacing files cannot change the running process's release.
        (directory / "build-info.json").unlink()
        assert client.get("/api/release", params={"release_id": build["release_id"]}).json()["release"]["seen"]


def test_http_write_failure_and_no_release(tmp_path, monkeypatch):
    directory, build = cut(tmp_path)
    service = ReleaseNotes(load_release(directory), tmp_path / "install")
    app = FastAPI()
    app.include_router(make_router(service))
    with TestClient(app) as client:
        def fail(*args):
            raise OSError("decoy write refusal")
        monkeypatch.setattr("backend.release_notes.os.replace", fail)
        assert client.post("/api/release/seen", json={"release_id": build["release_id"]}).status_code == 503
        assert not client.get("/api/release", params={"release_id": build["release_id"]}).json()["release"]["seen"]
    missing = FastAPI()
    missing.include_router(make_router(ReleaseNotes(None, tmp_path)))
    with TestClient(missing) as client:
        assert client.get("/api/release", params={"release_id": build["release_id"]}).json() == {"release": None}
        assert client.post("/api/release/seen", json={"release_id": build["release_id"]}).status_code == 409


def test_canonical_utf8_identity_and_exact_notes_only(tmp_path):
    import hashlib
    body = "Notes — café\n- <b>plain text</b>"
    directory, build = cut(tmp_path, body=body)
    expected = ('{"notes_sha256":"' + hashlib.sha256(body.encode("utf-8")).hexdigest()
                + '","schema":1,"source_revision":"' + "a" * 40 + '","version":"1.2.3"}')
    assert build["release_id"] == hashlib.sha256(expected.encode("utf-8")).hexdigest()
    assert load_release(directory).body == body
    assert identity("1.2.3", "a" * 40, body) == build
    with pytest.raises(ValueError, match="exact release"):
        cut_metadata(tmp_path / "source", "1.2.3-rc.1", "a" * 40, tmp_path / "bad")


def test_packaging_stages_exact_pair_and_refuses_stale_frontend(tmp_path):
    directory, build = cut(tmp_path)
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "build-info.json").write_text(json.dumps(build))
    for platform in ("macos", "windows"):
        backend = tmp_path / platform
        backend.mkdir()
        stage_metadata(directory, dist, backend, "1.2.3")
        assert load_release(backend) == load_release(directory)
    with pytest.raises(ValueError, match="mismatched"):
        stage_metadata(directory, dist, tmp_path / "macos", "1.2.4")
    (dist / "build-info.json").write_text('{}')
    with pytest.raises(ValueError, match="another release"):
        stage_metadata(directory, dist, tmp_path / "macos", "1.2.3")
