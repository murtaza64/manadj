"""Rekordbox hotcue reading + divergence (rekordbox-perf-export/02).

Cue-row decoding tested via the pure helper; aggregator behavior via the
FakeSurfaceReader seam (ADR 0002/0004) with position-fidelity readers.
"""

from types import SimpleNamespace

import pytest

from backend.sync_status import compute_sync_status
from backend.sync_status.adapters import rb_hotcues_from_cue_rows
from backend.sync_status.compare import hotcue_positions_equal
from backend.sync_status.models import HotCueValue, SurfaceTrackRef, TrackFields


def row(kind: int, ms: int, comment: str | None = None, color: int = -1):
    return SimpleNamespace(Kind=kind, InMsec=ms, Comment=comment, Color=color)


def cues_no_offset(rows, monkeypatch=None):
    return rb_hotcues_from_cue_rows(rows, "/music/t.flac")  # flac: offset 0


# -- rb_hotcues_from_cue_rows -------------------------------------------------


def test_no_rows_is_an_empty_actionable_set():
    """[] not None: RB always carries the cue field for present tracks —
    empty vs a non-empty Library must diverge (export-only), else the
    export verbs are unreachable exactly where they're needed (07)."""
    assert rb_hotcues_from_cue_rows([], "/music/t.flac") == ([], None)


def test_hot_and_memory_mirror():
    rows = [row(1, 30000), row(0, 30000), row(3, 60000), row(0, 60000)]
    hotcues, mirror_ok = cues_no_offset(rows)
    assert [(c.slot, c.time) for c in hotcues] == [(1, 30.0), (3, 60.0)]
    assert mirror_ok is True


def test_stray_memory_cue_breaks_mirror():
    rows = [row(1, 30000), row(0, 30000), row(0, 90000)]
    _, mirror_ok = cues_no_offset(rows)
    assert mirror_ok is False


def test_missing_memory_twin_breaks_mirror():
    rows = [row(1, 30000)]
    _, mirror_ok = cues_no_offset(rows)
    assert mirror_ok is False


def test_empty_comment_is_no_label():
    hotcues, _ = cues_no_offset([row(2, 1000, ""), row(0, 1000)])
    assert hotcues[0].label is None


def test_offset_translated_into_manadj_frame(tmp_path):
    # a LAME mp3 (+49): RB ms 30049 is manadj 30.0 s
    mp3 = tmp_path / "t.mp3"
    frame = bytes([0xFF, 0xFB, 0xE0, 0x44]) + b"\x00" * 32
    flags = (1).to_bytes(4, "big")
    mp3.write_bytes(frame + b"Xing" + flags + (100).to_bytes(4, "big") + b"LAME3.100")
    hotcues, _ = rb_hotcues_from_cue_rows([row(1, 30049), row(0, 30049)], str(mp3))
    assert hotcues[0].time == pytest.approx(30.0)


# -- comparison fidelity -------------------------------------------------------


def test_position_equality_ignores_label_and_color():
    lib = [HotCueValue(slot=1, time=30.0, label="Drop", color="#FF0080")]
    rb = [HotCueValue(slot=1, time=30.0, label=None, color=None)]
    assert hotcue_positions_equal(lib, rb)
    assert not hotcue_positions_equal(lib, [HotCueValue(slot=1, time=30.1, label=None, color=None)])
    assert not hotcue_positions_equal(lib, [HotCueValue(slot=2, time=30.0, label=None, color=None)])


# -- aggregator ---------------------------------------------------------------


class FakeReader:
    def __init__(self, refs, fields, fidelity=None):
        self._refs = refs
        self.fields = frozenset(fields)
        if fidelity:
            self.hotcue_fidelity = fidelity

    def list_tracks(self):
        return self._refs


def make_track(db, filename="/music/t.flac", **kw):
    from backend.models import HotCue, Track

    t = Track(filename=filename, title="T", **kw)
    db.add(t)
    db.commit()
    db.add(HotCue(track_id=t.id, slot_number=1, time_seconds=30.0,
                  label="Drop", color="#FF0080"))
    db.commit()
    return t


def ref(path, **fields):
    return SurfaceTrackRef(path=path, fields=TrackFields(**fields))


RB_FIELDS = ("title", "artist", "key", "energy", "tags", "hotcues")


def rb_reader(refs, fidelity="position"):
    return FakeReader(refs, RB_FIELDS, fidelity)


def row_for(result, path):
    return next(r for r in result.rows if r.path == path)


def test_matching_positions_are_clean_despite_labels(db):
    make_track(db)
    refs = [ref("/music/t.flac",
                hotcues=[HotCueValue(slot=1, time=30.0, label=None, color=None)],
                hotcue_mirror_ok=True)]
    result = compute_sync_status(db, {"rekordbox": rb_reader(refs)})
    r = row_for(result, "/music/t.flac")
    assert not any(d.field == "hotcues" for d in r.diverged)
    assert not r.warnings


def test_moved_cue_diverges(db):
    make_track(db)
    refs = [ref("/music/t.flac",
                hotcues=[HotCueValue(slot=1, time=31.0, label=None, color=None)],
                hotcue_mirror_ok=True)]
    result = compute_sync_status(db, {"rekordbox": rb_reader(refs)})
    r = row_for(result, "/music/t.flac")
    d = next(d for d in r.diverged if d.field == "hotcues")
    assert "rekordbox" in d.surface_values


def test_full_fidelity_still_compares_labels(db):
    """Engine keeps whole-value comparison (labels/colors count)."""
    make_track(db)
    refs = [ref("/music/t.flac",
                hotcues=[HotCueValue(slot=1, time=30.0, label=None, color=None)])]
    reader = FakeReader(refs, RB_FIELDS)  # no fidelity attr -> full
    result = compute_sync_status(db, {"engine": reader})
    r = row_for(result, "/music/t.flac")
    assert any(d.field == "hotcues" for d in r.diverged)


def test_broken_mirror_warns(db):
    make_track(db)
    refs = [ref("/music/t.flac",
                hotcues=[HotCueValue(slot=1, time=30.0, label=None, color=None)],
                hotcue_mirror_ok=False)]
    result = compute_sync_status(db, {"rekordbox": rb_reader(refs)})
    r = row_for(result, "/music/t.flac")
    assert any("memory cues" in w for w in r.warnings)


def test_pad_mapping_final_table():
    """Final table (cue_mapping.py): Kind 5 = pad D = slot 4,
    Kind 9 = pad H = slot 8; Kind 4 is never a hot cue."""
    hotcues, _ = rb_hotcues_from_cue_rows(
        [row(5, 40000), row(9, 80000), row(0, 40000), row(0, 80000)], "/music/t.flac"
    )
    assert [(c.slot, c.time) for c in hotcues] == [(4, 40.0), (8, 80.0)]


def test_color_index_reads_as_hex():
    hotcues, _ = rb_hotcues_from_cue_rows(
        [row(1, 1000, "x", color=2), row(0, 1000)], "/music/t.flac"
    )
    assert hotcues[0].color == "#E8A029"  # palette 2 = orange


def test_library_cues_vs_empty_rb_diverge_export_only(db):
    make_track(db)  # library has 1 cue
    refs = [ref("/music/t.flac", hotcues=[])]
    result = compute_sync_status(db, {"rekordbox": rb_reader(refs)})
    r = row_for(result, "/music/t.flac")
    d = next(dd for dd in r.diverged if dd.field == "hotcues")
    assert d.surface_values["rekordbox"] == []
    assert "rekordbox" not in d.importable_from  # nothing to import; export-only
