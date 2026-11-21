"""Independent path replacement regressions for the proposed second-handle check."""
import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

from backend.peer_sync import service

BODY = b"generated-test-audio" * 20


def replace_after_hash(monkeypatch, path, replacement):
    original = service.os.fstat
    calls = 0

    def fstat(fd):
        nonlocal calls
        result = original(fd)
        calls += 1
        if calls == 2:
            replacement()
        return result

    monkeypatch.setattr(service.os, "fstat", fstat)


@pytest.mark.skipif(os.name == "nt", reason="Windows denies replacement while original handle is open")
def test_replaced_regular_file_is_refused(tmp_path, monkeypatch):
    path = tmp_path / "audio.wav"
    path.write_bytes(BODY)
    old = path.stat()
    other = tmp_path / "other.wav"
    other.write_bytes(BODY)
    os.utime(other, ns=(old.st_atime_ns, old.st_mtime_ns))
    replace_after_hash(monkeypatch, path, lambda: os.replace(other, path))
    assert service.file_version(str(path)) is None


@pytest.mark.skipif(os.name == "nt", reason="POSIX replacement race")
@pytest.mark.parametrize("kind", ["missing", "directory"])
def test_path_removed_or_nonregular_after_hash_is_refused(tmp_path, monkeypatch, kind):
    path = tmp_path / "audio.wav"
    path.write_bytes(BODY)

    def replace():
        path.unlink()
        if kind == "directory":
            path.mkdir()

    replace_after_hash(monkeypatch, path, replace)
    assert service.file_version(str(path)) is None


@pytest.mark.skipif(not hasattr(os, "mkfifo"), reason="POSIX FIFO race")
def test_fifo_replacement_does_not_block(tmp_path):
    # A subprocess lets the regression fail promptly, without hanging pytest.
    child = r'''
import os, sys
from pathlib import Path
from backend.peer_sync import service
path = Path(sys.argv[1])
path.write_bytes(b"generated-audio" * 20)
original = service.os.fstat
calls = 0
def fstat(fd):
    global calls
    value = original(fd)
    calls += 1
    if calls == 2:
        path.unlink()
        os.mkfifo(path)
    return value
service.os.fstat = fstat
assert service.file_version(str(path)) is None
'''
    try:
        result = subprocess.run([sys.executable, "-c", child, str(tmp_path / "audio.wav")],
                                timeout=3, capture_output=True, text=True)
    except subprocess.TimeoutExpired:
        pytest.fail("file_version blocked reopening a FIFO substituted after hashing")
    assert result.returncode == 0, result.stderr


def test_fdopen_failure_closes_descriptor(tmp_path, monkeypatch):
    path = tmp_path / "audio.wav"
    path.write_bytes(BODY)
    real_open = service.os.open
    opened = []

    def remember(*args, **kwargs):
        descriptor = real_open(*args, **kwargs)
        opened.append(descriptor)
        return descriptor

    def refuse(*args, **kwargs):
        raise OSError("injected fdopen failure")

    monkeypatch.setattr(service.os, "open", remember)
    monkeypatch.setattr(service.os, "fdopen", refuse)
    assert service.file_version(str(path)) is None
    assert len(opened) == 1
    with pytest.raises(OSError):
        service.os.fstat(opened[0])


@pytest.mark.skipif(os.name != "nt", reason="Windows device path")
def test_windows_null_device_has_no_fingerprint():
    assert service.file_version("NUL") is None
