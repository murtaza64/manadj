"""backend/fs_clone.py (#303): CoW clone with a plain-copy fallback on
every platform. Decoy files only."""

import sys

import pytest

from backend import fs_clone


@pytest.fixture(params=[sys.platform, "linux", "win32"])
def platform(request, monkeypatch):
    monkeypatch.setattr(fs_clone.sys, "platform", request.param)
    return request.param


def test_clone_file(tmp_path, platform):
    src = tmp_path / "decoy.db"
    src.write_bytes(b"decoy")
    dest = tmp_path / "out" / "copy.db"
    dest.parent.mkdir()
    fs_clone.clone_file(src, dest)
    assert dest.read_bytes() == b"decoy"
    src.write_bytes(b"changed")
    assert dest.read_bytes() == b"decoy"


def test_clone_tree(tmp_path, platform):
    src = tmp_path / "Database2"
    (src / "sub").mkdir(parents=True)
    (src / "m.db").write_bytes(b"decoy")
    (src / "sub" / "x").write_text("y")
    dest = tmp_path / "snapshots" / "snap"
    dest.parent.mkdir()
    fs_clone.clone_tree(src, dest)
    assert (dest / "m.db").read_bytes() == b"decoy"
    assert (dest / "sub" / "x").read_text() == "y"
    with pytest.raises(FileExistsError):
        fs_clone.clone_tree(src, dest)


def test_clone_falls_back_when_cp_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(fs_clone.sys, "platform", "darwin")

    def no_cp(*a, **k):
        raise FileNotFoundError("cp")

    monkeypatch.setattr(fs_clone.subprocess, "run", no_cp)
    src = tmp_path / "decoy"
    src.write_text("x")
    fs_clone.clone_file(src, tmp_path / "copy")
    assert (tmp_path / "copy").read_text() == "x"
