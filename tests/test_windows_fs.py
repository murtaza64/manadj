"""#310: Windows open-file deletes, case-insensitive scan. Decoy files only.

Windows raises PermissionError deleting a file another handle holds open;
these tests inject that failure to exercise the retry/report paths on any OS.
"""

from pathlib import Path

import pytest

from backend import fs_retry, models, schemas, stems
from backend.config import StemsConfig
from backend.library.scanner import scan_directory
from backend.routers.tracks import relocate_track_files


@pytest.fixture(autouse=True)
def fast_retry(monkeypatch):
    monkeypatch.setattr(fs_retry, "DELAY_S", 0)
    monkeypatch.setattr(fs_retry.time, "sleep", lambda s: None)


def test_retry_locked_retries_then_raises():
    calls = []

    def flaky():
        calls.append(1)
        if len(calls) < 3:
            raise PermissionError("in use")
        return "ok"

    assert fs_retry.retry_locked(flaky) == "ok"
    assert len(calls) == 3

    def stuck():
        raise PermissionError("in use")

    with pytest.raises(PermissionError):
        fs_retry.retry_locked(stuck, attempts=2)


def test_scan_matches_extensions_case_insensitively(tmp_path):
    (tmp_path / "a.MP3").write_bytes(b"x")
    (tmp_path / "b.flac").write_bytes(b"x")
    (tmp_path / "c.txt").write_bytes(b"x")
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "d.M4A").write_bytes(b"x")
    names = [p.name for p in scan_directory(tmp_path)]
    assert names == ["a.MP3", "b.flac"]
    names = [p.name for p in scan_directory(tmp_path, recursive=True)]
    assert sorted(names) == ["a.MP3", "b.flac", "d.M4A"]


def test_relocate_reports_undeletable_source_after_commit(db_session, tmp_path, monkeypatch):
    source = tmp_path / "decoy.m4a"
    source.write_bytes(b"audio")
    track = models.Track(filename=str(source), title="One")
    db_session.add(track)
    db_session.commit()

    real_unlink = Path.unlink

    def locked_unlink(self, *a, **k):
        if self == source:
            raise PermissionError("[WinError 32] in use")
        return real_unlink(self, *a, **k)

    monkeypatch.setattr(Path, "unlink", locked_unlink)
    dest = tmp_path / "moved.m4a"
    result = relocate_track_files(
        schemas.TrackFileRelocationRequest(
            relocations=[schemas.TrackFileRelocation(track_id=track.id, destination=str(dest))]
        ),
        db_session,
    )
    assert result["leftover_sources"] == [str(source)]
    db_session.refresh(track)
    assert track.filename == str(dest)
    assert dest.read_bytes() == b"audio"


def _fake_pipeline(monkeypatch, config):
    def fake_decode(src, wav):
        wav.write_bytes(b"wav")

    def fake_run(cmd, env=None):
        out = Path(cmd[cmd.index("-o") + 1]) / config.model
        out.mkdir(parents=True)
        for s in stems.STEM_NAMES:
            (out / f"{s}.wav").write_bytes(b"wav")

    def fake_encode(wav, dest):
        dest.write_bytes(b"new")

    monkeypatch.setattr(stems, "decode_to_wav", fake_decode)
    monkeypatch.setattr(stems, "_run", fake_run)
    monkeypatch.setattr(stems, "encode_stem", fake_encode)


def _old_split(config, track_id=7):
    old = stems.stems_dir(track_id, config)
    old.mkdir(parents=True)
    (old / "drums.m4a").write_bytes(b"old")
    (old / stems.META_FILENAME).write_text("{}", encoding="utf-8")
    return old


def test_split_replace_retries_locked_stems_dir(tmp_path, monkeypatch):
    config = StemsConfig(directory=str(tmp_path / "stems"))
    _fake_pipeline(monkeypatch, config)
    _old_split(config)
    source = tmp_path / "src.m4a"
    source.write_bytes(b"src")

    real_rmtree = stems.shutil.rmtree
    attempts = []

    def flaky_rmtree(path, *a, **k):
        if Path(path) != stems.stems_dir(7, config):
            return real_rmtree(path, *a, **k)  # the pipeline's temp dir
        attempts.append(path)
        if len(attempts) == 1:
            raise PermissionError("[WinError 32] in use")
        return real_rmtree(path, *a, **k)

    monkeypatch.setattr(stems.shutil, "rmtree", flaky_rmtree)
    dest = stems.split_track(7, source, config)
    assert (dest / "drums.m4a").read_bytes() == b"new"
    assert stems.read_meta(7, config) is not None


def test_split_replace_invalidates_before_failing(tmp_path, monkeypatch):
    config = StemsConfig(directory=str(tmp_path / "stems"))
    _fake_pipeline(monkeypatch, config)
    old = _old_split(config)
    source = tmp_path / "src.m4a"
    source.write_bytes(b"src")

    real_rmtree = stems.shutil.rmtree

    def stuck_rmtree(path, *a, **k):
        if Path(path) != old:
            return real_rmtree(path, *a, **k)  # the pipeline's temp dir
        raise PermissionError("[WinError 32] in use")

    monkeypatch.setattr(stems.shutil, "rmtree", stuck_rmtree)
    with pytest.raises(PermissionError):
        stems.split_track(7, source, config)
    # Never stale-but-valid: the marker is gone, so the old split reads absent.
    assert not (old / stems.META_FILENAME).exists()
    assert stems.read_meta(7, config) is None
