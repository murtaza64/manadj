import json
from pathlib import Path

import pytest

from backend.mirror.plan import PathRejected, build_plan, relative_key

POSIX_ROOT = "/home/me/Music"
WIN_ROOT = "D:\\Music\\DJ"


def test_posix_relative():
    assert relative_key("/home/me/Music/House/a.mp3", [POSIX_ROOT]) == "House/a.mp3"


def test_windows_relative_case_insensitive_drive():
    assert relative_key("d:\\music\\dj\\Techno\\b.flac", [WIN_ROOT]) == "Techno/b.flac"


def test_longest_root_wins():
    roots = ["/home/me/Music", "/home/me/Music/House"]
    assert relative_key("/home/me/Music/House/a.mp3", roots) == "a.mp3"


@pytest.mark.parametrize("bad", ["relative/a.mp3", "/etc/passwd", "/home/me/Music/../x.mp3", "/home/me/Music"])
def test_rejects_unsafe(bad):
    with pytest.raises(PathRejected):
        relative_key(bad, [POSIX_ROOT])


def _fixture(tmp_path: Path):
    lib = tmp_path / "lib"
    (lib / "House").mkdir(parents=True)
    (lib / "House" / "a.mp3").write_bytes(b"AAAA")
    (lib / "b.mp3").write_bytes(b"BBBBBB")
    snap = {"version": 1, "tracks": [
        {"id": 1, "filename": "/home/me/Music/House/a.mp3", "title": "A"},
        {"id": 2, "filename": "/home/me/Music/b.mp3", "title": "B"},
        {"id": 3, "filename": "/home/me/Music/gone.mp3", "title": "C"},
        {"id": 4, "filename": "/outside/z.mp3", "title": "D"},
    ], "tags": [{"id": 9}]}
    resolve = lambda p: lib / p[len("/home/me/Music/"):] if p.startswith("/home/me/Music/") else Path("/nonexistent") / p.lstrip("/")
    return snap, resolve


def test_plan_first_run(tmp_path):
    snap, resolve = _fixture(tmp_path)
    plan = build_plan(snap, [POSIX_ROOT], resolve=resolve)
    assert [u["key"] for u in plan.uploads] == ["House/a.mp3", "b.mp3"]
    assert plan.upload_bytes == 10
    assert {m["track_id"] for m in plan.missing} == {3, 4}
    t = {t["id"]: t for t in plan.snapshot["tracks"]}
    assert "filename" not in t[1] and t[1]["remote_key"] == "House/a.mp3"
    assert t[3]["remote_key"] is None
    assert plan.snapshot["tags"] == [{"id": 9}]
    assert "/home/me" not in json.dumps(plan.snapshot["tracks"][:2])


def test_input_snapshot_not_mutated(tmp_path):
    snap, resolve = _fixture(tmp_path)
    before = json.dumps(snap, sort_keys=True)
    build_plan(snap, [POSIX_ROOT], resolve=resolve)
    assert json.dumps(snap, sort_keys=True) == before


def test_idempotent_rerun_and_changed_detection(tmp_path):
    snap, resolve = _fixture(tmp_path)
    first = build_plan(snap, [POSIX_ROOT], resolve=resolve)
    index = {u["key"]: u["sha256"] for u in first.uploads}
    again = build_plan(snap, [POSIX_ROOT], remote_index=index, resolve=resolve)
    assert again.uploads == [] and sorted(again.unchanged) == ["House/a.mp3", "b.mp3"]
    index["b.mp3"] = "0" * 64  # remote has different bytes at same key
    third = build_plan(snap, [POSIX_ROOT], remote_index=index, resolve=resolve)
    assert [u["key"] for u in third.uploads] == ["b.mp3"] and third.changed == ["b.mp3"]


def test_case_collision_different_content_refused(tmp_path):
    lib = tmp_path / "lib"; lib.mkdir()
    (lib / "x.mp3").write_bytes(b"1"); (lib / "X.mp3").write_bytes(b"2")
    snap = {"tracks": [{"id": 1, "filename": "/m/x.mp3"}, {"id": 2, "filename": "/m/X.mp3"}]}
    resolve = lambda p: lib / p[3:]
    plan = build_plan(snap, ["/m"], resolve=resolve)
    assert len(plan.uploads) == 1 and plan.collisions == ["X.mp3"]
    assert plan.missing[0]["track_id"] == 2


def test_duplicate_track_same_file_uploaded_once(tmp_path):
    lib = tmp_path / "lib"; lib.mkdir(); (lib / "a.mp3").write_bytes(b"1")
    snap = {"tracks": [{"id": 1, "filename": "/m/a.mp3"}, {"id": 2, "filename": "/m/a.mp3"}]}
    plan = build_plan(snap, ["/m"], resolve=lambda p: lib / p[3:])
    assert len(plan.uploads) == 1 and plan.uploads[0]["track_ids"] == [1, 2]



@pytest.mark.parametrize("content2", [b"2", b"1"])  # different and IDENTICAL bytes
def test_case_variant_keys_refused_even_when_bytes_identical(tmp_path, content2):
    lib = tmp_path / "lib"; lib.mkdir()
    (lib / "x.mp3").write_bytes(b"1"); (lib / "X.mp3").write_bytes(content2)
    snap = {"tracks": [{"id": 1, "filename": "/m/x.mp3"}, {"id": 2, "filename": "/m/X.mp3"}]}
    plan = build_plan(snap, ["/m"], resolve=lambda p: lib / p[3:])
    assert [u["key"] for u in plan.uploads] == ["x.mp3"]
    assert plan.collisions == ["X.mp3"]
    assert plan.missing[0]["track_id"] == 2 and "case-insensitive" in plan.missing[0]["reason"]
    t = {t["id"]: t for t in plan.snapshot["tracks"]}
    assert t[1]["remote_key"] == "x.mp3" and t[2]["remote_key"] is None


def test_same_exact_key_identical_file_still_single_upload(tmp_path):
    lib = tmp_path / "lib"; lib.mkdir(); (lib / "a.mp3").write_bytes(b"1")
    snap = {"tracks": [{"id": 1, "filename": "/m/a.mp3"}, {"id": 2, "filename": "/m/a.mp3"}]}
    plan = build_plan(snap, ["/m"], resolve=lambda p: lib / p[3:])
    assert plan.collisions == [] and len(plan.uploads) == 1


def test_windows_drive_case_same_key_not_a_collision(tmp_path):
    lib = tmp_path / "lib"; lib.mkdir(); (lib / "a.mp3").write_bytes(b"1")
    snap = {"tracks": [{"id": 1, "filename": "D:\\M\\a.mp3"}, {"id": 2, "filename": "d:\\m\\a.mp3"}]}
    plan = build_plan(snap, ["D:\\M"], resolve=lambda p: lib / "a.mp3")
    assert plan.collisions == [] and len(plan.uploads) == 1


def test_unreadable_file_is_reported_not_fatal(tmp_path, monkeypatch):
    """A file that exists but cannot be read becomes an attention row and the
    rest of the plan still completes."""
    lib = tmp_path / "lib"
    lib.mkdir()
    (lib / "locked.mp3").write_bytes(b"nope")
    (lib / "ok.mp3").write_bytes(b"fine")
    snap = {"tracks": [
        {"id": 1, "filename": "/home/me/Music/locked.mp3"},
        {"id": 2, "filename": "/home/me/Music/ok.mp3"},
    ]}
    resolve = lambda p: lib / p[len("/home/me/Music/"):]

    import backend.mirror.plan as plan_mod

    real = plan_mod.sha256_file

    def flaky_hash(path, chunk=1 << 20):
        if path.name == "locked.mp3":
            raise PermissionError(13, "Permission denied")
        return real(path, chunk)

    monkeypatch.setattr(plan_mod, "sha256_file", flaky_hash)
    plan = build_plan(snap, [POSIX_ROOT], resolve=resolve)
    assert [u["key"] for u in plan.uploads] == ["ok.mp3"]
    assert [m["track_id"] for m in plan.missing] == [1]
    assert "unreadable" in plan.missing[0]["reason"]


def test_non_audio_regular_path_is_missing(tmp_path):
    """A directory where an audio file should be is 'missing', not fatal."""
    lib = tmp_path / "lib"
    (lib / "dirtrack.mp3").mkdir(parents=True)
    snap = {"tracks": [{"id": 1, "filename": "/home/me/Music/dirtrack.mp3"}]}
    resolve = lambda p: lib / p[len("/home/me/Music/"):]
    plan = build_plan(snap, [POSIX_ROOT], resolve=resolve)
    assert plan.uploads == []
    assert plan.missing == [{"track_id": 1, "reason": "audio file missing"}]


def test_file_changing_during_scan_is_reported(tmp_path, monkeypatch):
    """If size/mtime moves while hashing, the digest is untrustworthy: the
    track is reported for a re-run and gets no upload entry."""
    lib = tmp_path / "lib"
    lib.mkdir()
    target = lib / "live.mp3"
    target.write_bytes(b"original")
    snap = {"tracks": [{"id": 1, "filename": "/home/me/Music/live.mp3"}]}
    resolve = lambda p: lib / p[len("/home/me/Music/"):]

    import backend.mirror.plan as plan_mod

    real = plan_mod.sha256_file

    def mutating_hash(path, chunk=1 << 20):
        digest = real(path, chunk)
        path.write_bytes(b"changed mid-scan!")
        return digest

    monkeypatch.setattr(plan_mod, "sha256_file", mutating_hash)
    plan = build_plan(snap, [POSIX_ROOT], resolve=resolve)
    assert plan.uploads == []
    assert [m["track_id"] for m in plan.missing] == [1]
    assert "changed while scanning" in plan.missing[0]["reason"]
