"""Point reconciliation against actual disposable pyrekordbox/native loop data."""
# ruff: noqa: F811
import pytest
from pyrekordbox.db6.tables import DjmdCue

from rekordbox.device.anlz_read import read_anlz
from tests.test_playlist_export_integration import destinations, playlist_members  # noqa: F401
from tests.test_rekordbox_anlz_cues import native_export  # noqa: F401


@pytest.fixture
def existing_loop(native_export):
    exporter, track, content, dat, ext, rb = native_export
    exporter.export_hotcues(track.filename, [(1, 0.1, "Loop", None)], "replace-all")
    rows = rb.session.query(DjmdCue).filter(DjmdCue.rb_local_deleted == 0).all()
    for row in rows:
        row.OutMsec = 2000
        row.OutFrame = 150
        row.OutMpegFrame = 77
        row.OutMpegAbs = 88
        row.OutPointSeekInfo = "decoy loop end"
        row.ActiveLoop = 1
        row.BeatLoopSize = 4
    rb.commit(autoinc=True)
    exporter._sync_cue_analysis(content)
    return native_export


@pytest.mark.parametrize("seconds", [0.1, 0.3, 3.0])
def test_replace_all_point_normalizes_loop_before_commit(existing_loop, seconds, monkeypatch):
    from rekordbox.decode_offset import manadj_seconds_to_rb_ms

    exporter, track, content, dat, ext, rb = existing_loop
    expected_ms = manadj_seconds_to_rb_ms(seconds, track.filename)
    original_commit = rb.commit
    commits = []

    def checked_commit(*args, **kwargs):
        pending = rb.session.query(DjmdCue).filter(DjmdCue.rb_local_deleted == 0).all()
        state = [(r.Kind, r.InMsec, r.OutMsec, r.ActiveLoop) for r in pending]
        commits.append(state)
        assert all(r.OutMsec == -1 and r.ActiveLoop == 0 for r in pending), state
        return original_commit(*args, **kwargs)

    monkeypatch.setattr(rb, "commit", checked_commit)
    # Same position AND same decoration exercises the former empty-plan return.
    exporter.export_hotcues(track.filename, [(1, seconds, "Loop", None)], "replace-all")
    assert commits, "Loop conversion must be persisted even without a position/decor change"
    rows = rb.session.query(DjmdCue).filter(DjmdCue.rb_local_deleted == 0).all()
    assert len(rows) == 2
    for row in rows:
        assert row.InMsec == expected_ms
        assert (row.OutMsec, row.OutFrame, row.OutMpegFrame, row.OutMpegAbs) == (-1, 0, 0, 0)
        assert row.OutPointSeekInfo is None
        assert (row.ActiveLoop, row.BeatLoopSize) == (0, 0)
    for cue in read_anlz(ext).cues_extended:
        assert cue.time_ms == expected_ms
        assert cue.type == "memory_cue"  # native type1 point, including hot cues
        assert cue.loop_time_ms == 0xFFFFFFFF
    for cue in read_anlz(dat).cues:
        assert cue.type == "memory_cue" and cue.status == "disabled"  # status0 = regular point
    once = (dat.read_bytes(), ext.read_bytes())
    commits.clear()
    exporter.export_hotcues(track.filename, [(1, seconds, "Loop", None)], "replace-all")
    assert not commits
    assert (dat.read_bytes(), ext.read_bytes()) == once


def test_add_only_preserves_existing_true_loop_and_native_bytes(existing_loop):
    exporter, track, content, dat, ext, rb = existing_loop
    before = (dat.read_bytes(), ext.read_bytes())
    result = exporter.export_hotcues(track.filename, [(1, 3.0, "Point not authorized", None)], "add-only")
    assert result["skipped_slots"] == [1]
    rows = rb.session.query(DjmdCue).filter(DjmdCue.rb_local_deleted == 0).all()
    assert all(r.OutMsec == 2000 and r.ActiveLoop == 1 and r.BeatLoopSize == 4 for r in rows)
    assert (dat.read_bytes(), ext.read_bytes()) == before
    assert all(c.type == "loop" and c.loop_time_ms == 2000 for c in read_anlz(ext).cues_extended)
    assert all(c.status == "active_loop" for c in read_anlz(dat).cues)


def test_add_only_new_point_keeps_other_true_loop(existing_loop):
    exporter, track, content, dat, ext, rb = existing_loop
    exporter.export_hotcues(track.filename, [(2, 3.0, "New point", None)], "add-only")
    rows = rb.session.query(DjmdCue).filter(DjmdCue.rb_local_deleted == 0).all()
    loop_rows = [r for r in rows if r.InMsec < 2000]
    assert len(loop_rows) == 2
    assert all(r.OutMsec == 2000 and r.ActiveLoop == 1 and r.BeatLoopSize == 4 for r in loop_rows)
    parsed = read_anlz(ext)
    assert sum(c.type == "loop" for c in parsed.cues_extended) == 2
    assert sum(c.type == "memory_cue" for c in parsed.cues_extended) == 2


def test_missing_ext_after_conversion_reports_saved_valid_db(existing_loop):
    from rekordbox.anlz_cues import CueAnalysisSyncError

    exporter, track, content, dat, ext, rb = existing_loop
    before = dat.read_bytes()
    ext.unlink()  # generated fixture only
    with pytest.raises(CueAnalysisSyncError, match="Cue DB committed; native DAT/EXT not synchronized"):
        exporter.export_hotcues(track.filename, [(1, 3.0, "Point", None)], "replace-all")
    rows = rb.session.query(DjmdCue).filter(DjmdCue.rb_local_deleted == 0).all()
    assert all(r.OutMsec == -1 and r.ActiveLoop == 0 for r in rows)
    assert dat.read_bytes() == before


def test_native_validation_still_rejects_invalid_true_loop(existing_loop):
    from rekordbox.anlz_cues import CueAnalysisSyncError

    exporter, track, content, dat, ext, rb = existing_loop
    before = (dat.read_bytes(), ext.read_bytes())
    for row in rb.session.query(DjmdCue).filter(DjmdCue.rb_local_deleted == 0):
        row.OutMsec = row.InMsec - 1
    rb.commit(autoinc=True)  # deliberately invalid decoy control, never a real asset
    with pytest.raises(CueAnalysisSyncError, match="Invalid Rekordbox cue/loop time"):
        exporter._sync_cue_analysis(content)
    assert (dat.read_bytes(), ext.read_bytes()) == before


def test_failed_backup_does_not_mutate_loop_state_or_native_pair(existing_loop, monkeypatch):
    from rekordbox import perf_export

    exporter, track, content, dat, ext, rb = existing_loop
    before = (dat.read_bytes(), ext.read_bytes())

    def refuse(*args):
        raise OSError("decoy backup failure")

    monkeypatch.setattr(perf_export, "snapshot_library", refuse)
    with pytest.raises(OSError, match="decoy backup failure"):
        exporter.export_hotcues(track.filename, [(1, 3.0, "Point", None)], "replace-all")
    assert all(r.OutMsec == 2000 and r.ActiveLoop == 1 for r in rb.session.query(DjmdCue))
    assert (dat.read_bytes(), ext.read_bytes()) == before
