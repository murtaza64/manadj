"""Production filesystem/transaction seam over independent migrated decoy libraries."""
import json
import shutil
import time
from uuid import uuid4

import pytest

from backend.peer_sync.folder import FolderTransport, MARKER
from tests import test_peer_session_exchange as exchange
from tests.test_peer_history_integration import history
from tests.test_peer_session_exchange import bind, export, post, seed, setup_pair


@pytest.fixture
def instance(tmp_path):
    yield from exchange.instance.__wrapped__(tmp_path)


def configured(peer):
    root = peer.root / "exchange"
    root.mkdir()
    post(peer, "transport", {"root": str(root), "enabled": True})
    return FolderTransport(peer.sessions), root


def artifact(root):
    return next(p for p in root.iterdir() if p.is_dir())


def copy_artifacts(source, target):
    for directory in source.iterdir():
        if directory.is_dir():
            shutil.copytree(directory, target / directory.name, dirs_exist_ok=True)


def test_automatic_folder_partial_restart_binding_normal_history_ack_noecho(instance):
    a, b, ai, bi, sid = setup_pair(instance)
    post(a, "sources", {"replica_id": bi["replica_id"], "label": "Own B"})
    ta, ra = configured(a)
    tb, rb = configured(b)
    post(a, f"transport/selections/{sid}")
    assert ta.run_once()["publications"][0]["state"] == "published_waiting_ack"
    source = artifact(ra)
    target = rb / source.name
    target.mkdir()
    shutil.copy2(source / "manifest.json", target)
    shutil.copy2(source / "complete.json", target)
    assert tb.run_once()["receipts"][0]["state"] == "partial"
    assert history(b).get("/api/sessions").json() == []
    b = instance("b")
    tb = FolderTransport(b.sessions)
    copy_artifacts(ra, rb)
    result = tb.run_once()["receipts"][0]
    assert result["received"] and result["state"] == "acknowledged"
    assert result["readiness"] == "unresolved_references"
    assert history(b).get("/api/sessions").json() == []
    packet = export(a, sid)
    bind(b, 9, packet["manifest"]["tracks"][0]["logical_track_id"])
    assert tb.run_once()["receipts"][0]["readiness"] == "materialized"
    detail = history(b).get(f"/api/sessions/{sid}").json()
    assert detail["events"][0]["trackId"] == 9
    copy_artifacts(rb, ra)
    assert ta.run_once()["publications"][0]["state"] == "acknowledged"
    before = {str(p.relative_to(ra)): (p.read_bytes(), p.stat().st_mtime_ns) for p in ra.rglob("*") if p.is_file()}
    ta, tb = FolderTransport(instance("a").sessions), FolderTransport(instance("b").sessions)
    for _ in range(2):
        ta.run_once()
        tb.run_once()
    after = {str(p.relative_to(ra)): (p.read_bytes(), p.stat().st_mtime_ns) for p in ra.rglob("*") if p.is_file()}
    assert before == after
    assert tb.status()["publications"] == []
    post(b, f"transport/selections/{sid}", status=409)
    (b.root / "generated.wav").unlink()
    assert tb.run_once()["receipts"][0]["readiness"] == "assets_unavailable"
    assert history(b).get(f"/api/sessions/{sid}").status_code == 409
    (source / "complete.json").unlink()
    assert ta.run_once()["publications"][0]["state"] == "file_missing"
    assert not (source / "complete.json").exists()


def test_unknown_source_never_autoaccepted_and_disable_never_opens_root(instance, monkeypatch):
    a, b, ai, _, sid = setup_pair(instance)
    from backend.peer_sync.models import SyncSource
    with b.sessions() as db:
        db.delete(db.get(SyncSource, ai["replica_id"]))
        db.commit()
    ta, ra = configured(a)
    tb, rb = configured(b)
    ta.select(sid)
    ta.run_once()
    copy_artifacts(ra, rb)
    assert tb.run_once()["receipts"][0]["state"] == "unknown_source"
    assert not list(artifact(rb).glob("ack-*"))
    tb = FolderTransport(instance("b").sessions)
    assert tb.run_once()["receipts"][0]["state"] == "unknown_source"
    post(b, "sources", {"replica_id": ai["replica_id"], "label": "Explicitly accepted after restart"})
    assert tb.run_once()["receipts"][0]["state"] == "acknowledged"
    from backend.peer_sync import folder
    post(b, "transport", {"root": str(rb), "enabled": False})
    def fail(*args, **kwargs):
        raise AssertionError("disabled transport touched filesystem")
    monkeypatch.setattr(folder, "root_fd", fail)
    assert tb.run_once()["state"] == "disabled"


@pytest.mark.parametrize("kind", ["missing", "populated", "symlink", "ancestor_symlink", "traversal", "marker"])
def test_root_authorization_is_explicit_and_no_follow(instance, kind):
    peer = instance("root-guard")
    post(peer, "identity")
    root = peer.root / "new-root"
    if kind != "missing":
        root.mkdir()
    if kind == "populated":
        (root / "unrelated").write_text("decoy")
    if kind == "marker":
        (root / MARKER).write_text('{"format":"manadj-peer-folder","version":true,"token":"' + 'a' * 32 + '"}')
    if kind == "symlink":
        link = peer.root / "link"
        link.symlink_to(root, target_is_directory=True)
        root = link
    if kind == "ancestor_symlink":
        (root / "child").mkdir()
        link = peer.root / "link"
        link.symlink_to(root, target_is_directory=True)
        root = link / "child"
    if kind == "traversal":
        root = root / ".." / "new-root"
    post(peer, "transport", {"root": str(root), "enabled": True}, status=422)


@pytest.mark.parametrize("kind", ["digest", "file_symlink", "dir_symlink", "oversized", "complete", "duplicate_keys"])
def test_bad_artifact_isolated_from_another_selected_session(instance, kind):
    a, b, _, _, sid = setup_pair(instance)
    ta, ra = configured(a)
    tb, rb = configured(b)
    ta.select(sid)
    ta.run_once()
    copy_artifacts(ra, rb)
    bad = artifact(rb)
    if kind == "digest":
        manifest = json.loads((bad / "manifest.json").read_text())
        manifest["recording_origin"] = "changed"
        (bad / "manifest.json").write_text(json.dumps(manifest))
    elif kind == "file_symlink":
        (bad / "manifest.json").unlink()
        (bad / "manifest.json").symlink_to(artifact(ra) / "manifest.json")
    elif kind == "dir_symlink":
        shutil.rmtree(bad)
        bad.symlink_to(artifact(ra), target_is_directory=True)
    elif kind == "oversized":
        with (bad / "manifest.json").open("wb") as stream:
            stream.truncate(1024 * 1024 + 1)
    elif kind == "duplicate_keys":
        data = (bad / "manifest.json").read_text()
        (bad / "manifest.json").write_text('{"grammar":"wrong",' + data[1:])
    else:
        (bad / "complete.json").write_text('{}')
    second = str(uuid4())
    seed(a, 2, session_uuid=second, filename="second.wav")
    ta.select(second)
    ta.run_once()
    # Copy only the other valid artifact, preserving the decoy corruption.
    for directory in ra.iterdir():
        if directory.is_dir() and directory.name != bad.name:
            shutil.copytree(directory, rb / directory.name)
    states = {row["artifact"]: row for row in tb.run_once()["receipts"]}
    assert states[bad.name]["state"] != "acknowledged"
    assert any(row["state"] == "acknowledged" for row in states.values())
    assert history(b).get("/api/sessions").json() == []


def test_offline_root_never_recreated_and_worker_stops(instance):
    from backend.peer_sync.folder_worker import FolderWorker
    a = instance("worker")
    post(a, "identity")
    transport, root = configured(a)
    root.rename(root.with_name("temporarily-offline"))
    assert transport.run_once()["state"] == "offline"
    assert not root.exists()
    worker = FolderWorker(a.sessions, interval=0.01)
    worker.start()
    thread = worker.thread
    worker.stop()
    assert not thread.is_alive() and worker.thread is None


@pytest.mark.parametrize("crash", ["publication_cursor", "publication_partial", "receipt_cursor", "ack"])
def test_crash_windows_recover_immutable_bytes_and_durable_receipt(instance, monkeypatch, crash):
    from backend.peer_sync import folder
    from backend.peer_sync.models import SyncSession
    a, b, _, _, sid = setup_pair(instance)
    ta, ra = configured(a)
    tb, rb = configured(b)
    ta.select(sid)
    if crash in {"publication_cursor", "publication_partial"}:
        with monkeypatch.context() as patch:
            if crash == "publication_cursor":
                def fail(*args, **kwargs):
                    raise RuntimeError("simulated exit before publication cursor commit")
                patch.setattr(ta, "_publication", fail)
            else:
                original = folder.immutable_json
                def fail(fd, name, value):
                    if name == "complete.json":
                        raise RuntimeError("simulated exit before complete marker")
                    return original(fd, name, value)
                patch.setattr(folder, "immutable_json", fail)
            with pytest.raises(RuntimeError):
                ta.run_once()
        before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in artifact(ra).iterdir()}
        if crash == "publication_partial":
            copy_artifacts(ra, rb)
            assert tb.run_once()["receipts"][0]["state"] == "partial"
            assert history(b).get("/api/sessions").json() == []
        ta = FolderTransport(instance("a").sessions)
        assert ta.run_once()["publications"][0]["published"]
        after = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in artifact(ra).iterdir()}
        assert all(after[name] == value for name, value in before.items())
    else:
        ta.run_once()
    copy_artifacts(ra, rb)
    if crash == "receipt_cursor":
        original = tb._receipt
        def fail(*args, **kwargs):
            raise RuntimeError("simulated exit after inbox before receipt cursor")
        monkeypatch.setattr(tb, "_receipt", fail)
        with pytest.raises(RuntimeError):
            tb.run_once()
        monkeypatch.setattr(tb, "_receipt", original)
    elif crash == "ack":
        original = folder.immutable_json
        def fail(fd, name, value):
            if name.startswith("ack-"):
                raise OSError("simulated unavailable ack destination")
            return original(fd, name, value)
        monkeypatch.setattr(folder, "immutable_json", fail)
        assert tb.run_once()["receipts"][0]["received"]
        monkeypatch.setattr(folder, "immutable_json", original)
    tb = FolderTransport(instance("b").sessions)
    assert tb.run_once()["receipts"][0]["state"] == "acknowledged"
    with b.sessions() as db:
        assert db.query(SyncSession).count() == 1
    assert len(list(artifact(rb).glob("ack-*"))) == 1
    assert tb.status()["publications"] == []


def test_real_polling_workers_deliver_and_materialize_without_manual_cycle(instance):
    from backend.peer_sync.folder_worker import FolderWorker
    a, b, ai, bi, sid = setup_pair(instance)
    post(a, "sources", {"replica_id": bi["replica_id"], "label": "Own B"})
    ta, root = configured(a)
    post(b, "transport", {"root": str(root), "enabled": True})
    packet = export(a, sid)
    bind(b, 9, packet["manifest"]["tracks"][0]["logical_track_id"])
    ta.select(sid)
    workers = [FolderWorker(peer.sessions, interval=0.02) for peer in (a, b)]
    try:
        for worker in workers:
            worker.start()
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            status = ta.status()
            rows = history(b).get("/api/sessions").json()
            if status["publications"][0]["state"] == "acknowledged" and rows:
                break
            time.sleep(0.02)
        else:
            pytest.fail(f"workers did not deliver: {status}")
        assert rows[0]["uuid"] == sid
        assert history(b).get(f"/api/sessions/{sid}").json()["events"][0]["trackId"] == 9
    finally:
        for worker in workers:
            worker.stop()


def test_accepted_namespace_conflicts_preserved_and_unaccepted_ack_does_not_count(instance):
    from backend.peer_sync.contracts import digest
    from backend.peer_sync.models import SyncConflict
    a, b, _, bi, sid = setup_pair(instance)
    ta, ra = configured(a)
    tb, rb = configured(b)
    ta.select(sid)
    ta.run_once()
    copy_artifacts(ra, rb)
    tb.run_once()
    copy_artifacts(rb, ra)
    assert ta.run_once()["publications"][0]["state"] == "published_waiting_ack"  # B not accepted by A
    post(a, "sources", {"replica_id": bi["replica_id"], "label": "Now accepted B"})
    assert ta.run_once()["publications"][0]["state"] == "acknowledged"
    original = artifact(rb)
    manifest = json.loads((original / "manifest.json").read_text())
    manifest["recording_origin"] = "conflicting immutable claim"
    hashed = digest(manifest)
    key = f'{manifest["origin_replica_id"]}_{sid}_{hashed}'
    target = rb / key
    shutil.copytree(original, target)
    (target / "manifest.json").write_text(json.dumps(manifest))
    complete = json.loads((target / "complete.json").read_text())
    complete["manifest"] = hashed
    (target / "complete.json").write_text(json.dumps(complete))
    states = {row["artifact"]: row["state"] for row in tb.run_once()["receipts"]}
    assert states[key] == "immutable_session_conflict_preserved"
    with b.sessions() as db:
        assert db.query(SyncConflict).count() == 1
    assert target.exists()  # No destructive quarantine/move/prune.


def test_transport_api_rejects_untrusted_and_invalid_configuration_before_mutation(instance):
    peer = instance("api-guards")
    post(peer, "identity")
    for content in ['{}', '{"root":"/decoy","enabled":1}', '{"root":"/decoy","root":"/decoy","enabled":true}', '{', '[]']:
        result = peer.client.post("/api/peer-sync/transport", content=content, headers={"Content-Type": "application/json"})
        assert result.status_code == 422, result.text
    response = peer.client.post("/api/peer-sync/transport", json={}, headers={"Origin": "https://untrusted.invalid"})
    assert response.status_code == 403
    assert FolderTransport(peer.sessions).status()["state"] == "unconfigured"


def test_bounded_round_robin_cursor_survives_restart_without_stranding_later_artifacts(instance):
    a, b, _, _, sid = setup_pair(instance)
    ta, ra = configured(a)
    tb, rb = configured(b)
    ta.select(sid)
    for track_id in range(2, 11):
        selected = str(uuid4())
        seed(a, track_id, session_uuid=selected, filename=f"decoy-{track_id}.wav")
        ta.select(selected)
    assert sum(row["published"] for row in ta.run_once()["publications"]) == 8
    ta = FolderTransport(instance("a").sessions)
    assert sum(row["published"] for row in ta.run_once()["publications"]) == 10
    copy_artifacts(ra, rb)
    assert len(tb.run_once()["receipts"]) == 8
    tb = FolderTransport(instance("b").sessions)
    assert len(tb.run_once()["receipts"]) == 10
    assert tb.status()["publications"] == []


def test_pinned_folder_marker_replacement_is_not_adopted(instance):
    a = instance("marker-replacement")
    post(a, "identity")
    transport, root = configured(a)
    path = root / MARKER
    value = json.loads(path.read_text())
    value["token"] = uuid4().hex
    path.write_text(json.dumps(value))
    assert transport.run_once()["state"] == "folder_ownership_changed"
    assert json.loads(path.read_text()) == value
    post(a, "transport", {"root": str(root), "enabled": True}, status=409)


def test_missing_posix_flags_do_not_break_import_or_disabled_transport(instance, monkeypatch):
    import importlib
    import os
    from backend.peer_sync import folder
    a = instance("unsupported")
    post(a, "identity")
    transport, root = configured(a)
    before = list(root.iterdir())
    with monkeypatch.context() as patch:
        patch.delattr(os, "O_NOFOLLOW")
        patch.delattr(os, "O_DIRECTORY")
        importlib.reload(folder)  # Formerly raised AttributeError, preventing ALL app startup.
        from backend.peer_sync import router
        importlib.reload(router)
        assert folder.FolderTransport(a.sessions).run_once()["state"] == "folder_transport_unsupported_platform"
        post(a, "transport", {"root": str(root), "enabled": True}, status=422)
        post(a, "transport", {"root": str(root), "enabled": False})
        assert folder.FolderTransport(a.sessions).run_once()["state"] == "disabled"
    importlib.reload(folder)
    assert before == list(root.iterdir())


def test_inflight_cycle_cannot_overwrite_operator_disable_and_restart_is_honest(instance, monkeypatch):
    from backend.peer_sync.models import FolderConfig
    a = instance("disable-interleave")
    post(a, "identity")
    sid = str(uuid4())
    seed(a, 1, session_uuid=sid)
    transport, root = configured(a)
    transport.select(sid)
    original = transport._publish
    def disable_then_finish(*args):
        post(a, "transport", {"root": str(root), "enabled": False})
        return original(*args)
    monkeypatch.setattr(transport, "_publish", disable_then_finish)
    result = transport.run_once()
    assert result["state"] == "disabled" and result["enabled"] is False
    with a.sessions() as db:
        assert db.get(FolderConfig, 1).state == "disabled"
    restarted = FolderTransport(instance("disable-interleave").sessions)
    assert restarted.run_once()["state"] == "disabled"
    post(a, "transport", {"root": str(root), "enabled": True})
    assert restarted.run_once()["state"] == "ready"
