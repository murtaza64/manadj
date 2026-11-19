"""Diagnostic probe: do handle fstat and path stat agree for a fresh file?

Peer exchange file_version() requires st_dev, st_ino, st_size, st_mtime_ns and
st_ctime_ns to match between fstat(handle) and Path.stat(). This test names the
fields that differ, plus whether a second handle may rename the open file.
"""
import os
import sys

FIELDS = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")


def test_handle_and_path_stat_agree_for_fresh_file(tmp_path):
    path = tmp_path / "probe.wav"
    path.write_bytes(b"generated-decoy-selected-audio" * 20)
    report = []
    for attempt in range(3):
        with path.open("rb") as stream:
            by_handle = os.fstat(stream.fileno())
            by_path = path.stat()
            diff = {f: (getattr(by_handle, f), getattr(by_path, f)) for f in FIELDS
                    if getattr(by_handle, f) != getattr(by_path, f)}
            report.append(diff)
            renamed = None
            try:
                os.rename(path, tmp_path / "moved.wav")
                renamed = True
                os.rename(tmp_path / "moved.wav", path)
            except OSError as error:
                renamed = repr(error)
        print(f"probe {sys.platform} py{sys.version_info[:3]} attempt={attempt} diff={diff} rename_while_open={renamed}")
    assert not any(report), report


def test_file_version_after_fixture_style_rewrite(tmp_path):
    from backend.peer_sync.service import file_version
    path = tmp_path / "generated.wav"
    for stage in ("initial", "rewrite", "mtime"):
        path.write_bytes(b"generated-decoy-selected-audio" * 20)
        if stage == "mtime":
            os.utime(path, ns=(1_700_000_000_000_000_000,) * 2)
        with path.open("rb") as stream:
            handle = os.fstat(stream.fileno())
            current = path.stat()
            diff = {f: (getattr(handle, f), getattr(current, f)) for f in FIELDS if getattr(handle, f) != getattr(current, f)}
        asset = file_version(str(path))
        print(f"fixture probe {sys.platform} stage={stage} diff={diff} asset={asset}")
        assert asset is not None

