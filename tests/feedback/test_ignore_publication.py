"""Independent publication checks, no filesystem permission emulation claim."""
from pathlib import Path
import pytest
from backend import feedback


def test_valid_ignore_does_not_open_replacement_window(tmp_path, monkeypatch):
    target = tmp_path / ".gitignore"
    target.write_bytes(b"*\n")
    def unexpected(*args, **kwargs):
        pytest.fail("An already correct ignore file must not be replaced")
    monkeypatch.setattr(feedback.os, "replace", unexpected)
    feedback._ensure_ignore_file(target)
    assert list(tmp_path.iterdir()) == [target]


def test_replace_retry_really_publishes_without_peer(tmp_path, monkeypatch):
    target = tmp_path / ".gitignore"
    original = feedback.os.replace
    calls = []
    def transient(src, dst):
        calls.append(src)
        if len(calls) == 1:
            raise PermissionError("temporary sharing conflict")
        return original(src, dst)
    monkeypatch.setattr(feedback.os, "replace", transient)
    monkeypatch.setattr(feedback.time, "sleep", lambda _: None)
    feedback._ensure_ignore_file(target, attempts=2)
    assert len(calls) == 2
    assert target.read_bytes() == b"*\n"
    assert list(tmp_path.iterdir()) == [target]


def test_wrong_peer_content_cannot_turn_denial_into_success(tmp_path, monkeypatch):
    target = tmp_path / ".gitignore"
    def denied(src, dst):
        target.write_bytes(b"not-private\n")
        raise PermissionError("denied")
    monkeypatch.setattr(feedback.os, "replace", denied)
    monkeypatch.setattr(feedback.time, "sleep", lambda _: None)
    with pytest.raises(PermissionError):
        feedback._ensure_ignore_file(target, attempts=2)
    assert target.read_bytes() == b"not-private\n"
    assert list(tmp_path.iterdir()) == [target]


def test_non_permission_failure_is_not_swallowed(tmp_path, monkeypatch):
    def unavailable(*args):
        raise OSError("disk unavailable")
    monkeypatch.setattr(feedback.os, "replace", unavailable)
    with pytest.raises(OSError, match="disk unavailable"):
        feedback._ensure_ignore_file(tmp_path / ".gitignore")
    assert list(tmp_path.iterdir()) == []
