"""Snapshot storage uses the user data root; all assets here are decoys."""
from backend.onboarding import rekordbox_import


def test_snapshot_uses_configured_root_and_keeps_source_untouched(tmp_path, monkeypatch):
    source = tmp_path / "decoy-rekordbox"
    source.mkdir()
    (source / "master.db").write_bytes(b"synthetic snapshot fixture, not a database")
    root = tmp_path / "user-data"
    monkeypatch.setenv("MANADJ_DATA_DIR", str(root))
    monkeypatch.setattr(rekordbox_import, "_snapshots", {})

    snapshot = rekordbox_import.snapshot_rekordbox_library(source)
    assert snapshot.parent == root / "data" / "rekordbox-snapshots"
    assert (snapshot / "master.db").read_bytes() == (source / "master.db").read_bytes()
    assert rekordbox_import.snapshot_rekordbox_library(source) == snapshot

    # A data-root switch must not reuse a snapshot from the previous root.
    other = tmp_path / "other-user-data"
    monkeypatch.setenv("MANADJ_DATA_DIR", str(other))
    second = rekordbox_import.snapshot_rekordbox_library(source)
    assert second.parent == other / "data" / "rekordbox-snapshots"
    assert (source / "master.db").read_bytes() == b"synthetic snapshot fixture, not a database"
