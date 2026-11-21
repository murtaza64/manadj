"""file_version fingerprints a regular file's bytes and fails closed when the file changes, is swapped, or is not regular."""
import os
import time

from backend.peer_sync.service import file_version

BODY = b"generated-decoy-selected-audio" * 20


def test_rewritten_in_place_file_is_fingerprinted(tmp_path):
    path = tmp_path / "generated.wav"
    for _ in range(3):  # rewrite over the same path, as the exchange fixtures do
        path.write_bytes(BODY)
        asset = file_version(str(path))
        assert asset is not None and asset.byte_length == len(BODY)
    os.utime(path, ns=(1_700_000_000_000_000_000,) * 2)
    assert file_version(str(path)) is not None


def test_missing_empty_and_changed_files_have_no_fingerprint(tmp_path):
    path = tmp_path / "a.wav"
    assert file_version(str(path)) is None
    path.write_bytes(b"")
    assert file_version(str(path)) is None


class _Mutating:
    """Wraps sha256 so the file changes after the bytes were read but before the re-check."""
    def __init__(self, real, action):
        self.real, self.action = real, action

    def update(self, block):
        self.real.update(block)
        self.action()

    def hexdigest(self):
        return self.real.hexdigest()


def _mutate_during_hash(monkeypatch, action):
    import hashlib

    import backend.peer_sync.service as service
    real_sha256 = hashlib.sha256
    done = []

    def once():
        if not done:
            done.append(1)
            action()
    monkeypatch.setattr(service.hashlib, "sha256", lambda: _Mutating(real_sha256(), once))


def test_append_while_hashing_is_refused(tmp_path, monkeypatch):
    path = tmp_path / "a.wav"
    path.write_bytes(BODY)
    _mutate_during_hash(monkeypatch, lambda: path.write_bytes(BODY + b"more"))
    assert file_version(str(path)) is None


def test_same_size_rewrite_while_hashing_is_refused(tmp_path, monkeypatch):
    path = tmp_path / "a.wav"
    path.write_bytes(BODY)
    before = path.stat()
    def rewrite():
        time.sleep(0.05)  # coarse kernel timestamps: ctime must visibly move
        path.write_bytes(b"x" * len(BODY))
        os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))  # even with the mtime restored
    _mutate_during_hash(monkeypatch, rewrite)
    # POSIX: ctime moves on any write. Windows: handle ctime is creation time, which a
    # rewrite in place does not move; only the bytes differ, so this guard is POSIX-only.
    if os.name == "posix":
        assert file_version(str(path)) is None


def test_path_replaced_by_another_file_while_hashing_is_refused(tmp_path, monkeypatch):
    path = tmp_path / "a.wav"
    path.write_bytes(BODY)
    other = tmp_path / "other.wav"
    other.write_bytes(BODY)  # identical bytes and size: only the identity differs

    def swap():
        try:
            os.replace(other, path)
        except OSError:  # Windows refuses while the original is open: also a refusal path
            pass
    _mutate_during_hash(monkeypatch, swap)
    if os.name == "posix":
        assert file_version(str(path)) is None


def test_directory_target_has_no_fingerprint(tmp_path):
    assert file_version(str(tmp_path)) is None


import pytest


@pytest.mark.skipif(not hasattr(os, "mkfifo"), reason="needs POSIX FIFOs")
def test_fifo_target_is_refused_without_blocking(tmp_path):
    fifo = tmp_path / "pipe.wav"
    os.mkfifo(fifo)
    assert file_version(str(fifo)) is None  # would hang forever if opened blocking


@pytest.mark.skipif(not hasattr(os, "mkfifo"), reason="needs POSIX FIFOs")
def test_fifo_swapped_in_after_hashing_is_refused_without_blocking(tmp_path, monkeypatch):
    path = tmp_path / "a.wav"
    path.write_bytes(BODY)

    def swap_for_fifo():
        os.replace(path, tmp_path / "kept.wav")
        os.mkfifo(path)
    _mutate_during_hash(monkeypatch, swap_for_fifo)
    assert file_version(str(path)) is None


def test_descriptor_is_closed_when_fdopen_fails(tmp_path, monkeypatch):
    import backend.peer_sync.service as service
    path = tmp_path / "a.wav"
    path.write_bytes(BODY)
    opened, closed = [], []
    real_open, real_close = os.open, os.close
    monkeypatch.setattr(service.os, "open", lambda *a, **k: opened.append(real_open(*a, **k)) or opened[-1])
    monkeypatch.setattr(service.os, "close", lambda fd: (closed.append(fd), real_close(fd))[1])
    monkeypatch.setattr(service.os, "fdopen", lambda *a, **k: (_ for _ in ()).throw(OSError("boom")))
    assert file_version(str(path)) is None
    assert opened and closed == opened
