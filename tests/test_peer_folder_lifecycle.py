"""Root lifecycle through production local-control APIs and generated-only files."""
from uuid import uuid4

import json

import pytest

from tests import test_peer_session_exchange as exchange
from tests.test_peer_folder_transport import configured
from tests.test_peer_session_exchange import post, seed
from backend.peer_sync.folder import FolderTransport


@pytest.fixture
def instance(tmp_path):
    yield from exchange.instance.__wrapped__(tmp_path)


def archive(peer, transport):
    status = transport.status()
    return post(peer, "transport/archive", {
        "generation": status["generation"], "pending": status["pending"], "retain_all_files": True,
    })


def test_archive_rotate_restart_reactivate_retains_outbox_without_autoexport(instance, monkeypatch):
    peer = instance("rotation")
    post(peer, "identity")
    sid = str(uuid4())
    seed(peer, 1, session_uuid=sid)
    transport, root = configured(peer)
    transport.select(sid)
    transport.run_once()
    before = {str(p.relative_to(root)): p.read_bytes() for p in root.rglob("*") if p.is_file()}
    post(peer, "transport", {"root": str(root), "enabled": False})
    assert transport.status()["pending"] == 1
    archive(peer, transport)
    fresh = peer.root / "fresh"
    fresh.mkdir()
    post(peer, "transport", {"root": str(fresh), "enabled": True})
    status = FolderTransport(instance("rotation").sessions).run_once()
    assert status["publications"] == []
    assert status["roots"][0]["archived"] and status["roots"][0]["pending"] == 1
    from backend.peer_sync import folder
    with monkeypatch.context() as patch:
        def forbidden(*args):
            raise AssertionError('Retained evidence inspection must not open any root')
        patch.setattr(folder, 'root_fd', forbidden)
        evidence = peer.client.get(f'/api/peer-sync/transport/roots/{status["roots"][0]["id"]}')
        assert evidence.status_code == 200
        assert evidence.json()['publications'][0]['session_uuid'] == sid
    assert list(fresh.iterdir()) and not any(p.is_dir() for p in fresh.iterdir())
    assert before == {str(p.relative_to(root)): p.read_bytes() for p in root.rglob("*") if p.is_file()}
    post(peer, "transport", {"root": str(fresh), "enabled": False})
    archive(peer, transport)
    post(peer, "transport", {"root": str(root), "enabled": True})
    assert transport.run_once()["publications"][0]["state"] == "published_waiting_ack"
    assert before == {str(p.relative_to(root)): p.read_bytes() for p in root.rglob("*") if p.is_file()}


def test_capacity_is_per_root_and_reselection_keeps_immutable_evidence(instance):
    peer = instance("capacity")
    post(peer, "identity")
    transport, root = configured(peer)
    ids = []
    for i in range(1, 257):
        sid = str(uuid4())
        seed(peer, i, session_uuid=sid, filename=f"generated-{i}.wav")
        ids.append(sid)
        post(peer, f"transport/selections/{sid}", status=200 if i <= 255 else 422)
    for _ in range(32):
        transport.run_once()
    assert len(list(root.iterdir())) == 256
    assert all(r["published"] for r in transport.status()["publications"])
    post(peer, "transport", {"root": str(root), "enabled": False})
    archive(peer, transport)
    fresh = peer.root / "fresh"
    fresh.mkdir()
    post(peer, "transport", {"root": str(fresh), "enabled": True})
    post(peer, f"transport/selections/{ids[-1]}")
    assert len(transport.run_once()["publications"]) == 1
    post(peer, f"transport/selections/{ids[0]}")
    transport.run_once()
    old = next(root.glob(f"*_{ids[0]}_*"))
    new = fresh / old.name
    assert {p.name: p.read_bytes() for p in old.iterdir()} == {p.name: p.read_bytes() for p in new.iterdir()}
    assert len(list(root.iterdir())) == 256  # No pruning.


def test_archive_requires_disable_fresh_counts_and_explicit_retention(instance):
    peer = instance("consent")
    post(peer, "identity")
    transport, root = configured(peer)
    fresh = peer.root / "fresh"
    fresh.mkdir()
    post(peer, "transport", {"root": str(fresh), "enabled": True}, status=409)
    s = transport.status()
    body = {"generation": s["generation"], "pending": 0, "retain_all_files": True}
    post(peer, "transport/archive", body, status=409)
    post(peer, "transport", {"root": str(root), "enabled": False})
    post(peer, "transport/archive", body, status=409)
    body["generation"] = transport.status()["generation"]
    post(peer, "transport/archive", {**body, "retain_all_files": False}, status=422)
    post(peer, "transport/archive", {**body, "retain_all_files": 1}, status=422)
    post(peer, "transport/archive", {**body, "pending": 1}, status=409)
    archive(peer, transport)
    marker = root / ".manadj-peer-folder.json"
    data = json.loads(marker.read_text())
    data["token"] = uuid4().hex
    marker.write_text(json.dumps(data))
    post(peer, "transport", {"root": str(root), "enabled": True}, status=409)
    assert transport.status()["state"] == "archived"


@pytest.mark.parametrize("failure", [False, True])
def test_late_old_root_result_cannot_change_new_root_state_or_outbox(instance, monkeypatch, failure):
    peer = instance("late-rotation")
    post(peer, "identity")
    sid = str(uuid4())
    seed(peer, 1, session_uuid=sid)
    transport, root = configured(peer)
    transport.select(sid)
    fresh = peer.root / "fresh"
    fresh.mkdir()
    original = transport._publish
    def rotate_then_finish(*args):
        post(peer, "transport", {"root": str(root), "enabled": False})
        archive(peer, transport)
        post(peer, "transport", {"root": str(fresh), "enabled": True})
        if failure:
            raise OSError("decoy old-root failure")
        return original(*args)
    monkeypatch.setattr(transport, "_publish", rotate_then_finish)
    result = transport.run_once()
    assert result["state"] == "pending" and result["root"] == str(fresh)
    assert result["publications"] == [] and result["roots"][0]["pending"] == 1
    assert result["roots"][0]["last_success"] is None
    assert not any(p.is_dir() for p in fresh.iterdir())


def test_migration_preserves_legacy_root_outbox_and_refuses_lossy_multi_root_downgrade(instance):
    from pathlib import Path
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import text
    peer = instance("migration")
    post(peer, "identity")
    sid = str(uuid4())
    seed(peer, 1, session_uuid=sid)
    transport, root = configured(peer)
    transport.select(sid)
    transport.run_once()
    before = transport.status()
    with peer.engine.connect() as connection:
        cfg = Config(str(Path(__file__).parents[1] / 'alembic.ini'))
        cfg.attributes.update(connection=connection, configure_logger=False)
        command.downgrade(cfg, '0051_pqtxo')
        assert connection.execute(text('SELECT session_uuid, state FROM peer_folder_publications')).all() == [(sid, 'published_waiting_ack')]
        connection.commit()
        command.upgrade(cfg, 'head')
    assert transport.status()['publications'] == before['publications']
    assert transport.run_once()['publications'] == before['publications']
    post(peer, 'transport', {'root': str(root), 'enabled': False})
    archive(peer, transport)
    fresh = peer.root / 'fresh'
    fresh.mkdir()
    post(peer, 'transport', {'root': str(fresh), 'enabled': True})
    with peer.engine.connect() as connection:
        cfg.attributes['connection'] = connection
        with pytest.raises(RuntimeError, match='losing provenance'):
            command.downgrade(cfg, '0051_pqtxo')
    assert len(transport.status()['roots']) == 2


def test_selection_started_on_old_root_cannot_silently_publish_to_rotated_root(instance, monkeypatch):
    from backend.peer_sync.service import PeerSync
    peer = instance('selection-rotation')
    post(peer, 'identity')
    sid = str(uuid4())
    seed(peer, 1, session_uuid=sid)
    transport, root = configured(peer)
    fresh = peer.root / 'fresh'
    fresh.mkdir()
    original = PeerSync.export
    def rotate_before_export(service, *args):
        post(peer, 'transport', {'root': str(root), 'enabled': False})
        archive(peer, transport)
        post(peer, 'transport', {'root': str(fresh), 'enabled': True})
        return original(service, *args)
    monkeypatch.setattr(PeerSync, 'export', rotate_before_export)
    result = post(peer, f'transport/selections/{sid}', status=409)
    assert result['detail'] == 'selection_root_changed_retry_required'
    assert transport.status()['publications'] == []
    assert transport.run_once()['publications'] == []
