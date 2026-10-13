"""Corpus-gated device read tests (rekordbox-usb-export/01).

Run against real rekordbox-written exports, which stay out of the repo
(ADR 0004). Point MANADJ_RB_EXPORT_CORPUS at an export root (a directory
containing PIONEER/) or at a directory of such roots; unset, this module
skips entirely.
"""

import os
from pathlib import Path

import pytest

from rekordbox.device.anlz_read import read_anlz
from rekordbox.device.pdb_read import read_pdb

_CORPUS = os.environ.get("MANADJ_RB_EXPORT_CORPUS")

pytestmark = pytest.mark.skipif(
    not _CORPUS, reason="MANADJ_RB_EXPORT_CORPUS not set"
)


def _roots() -> list[Path]:
    if not _CORPUS:
        return []
    base = Path(_CORPUS)
    if (base / "PIONEER").is_dir():
        return [base]
    return sorted(p for p in base.iterdir() if (p / "PIONEER").is_dir())


@pytest.fixture(scope="module", params=_roots(), ids=lambda p: p.name)
def export_root(request) -> Path:
    return request.param


@pytest.fixture(scope="module")
def pdb(export_root):
    return read_pdb(export_root / "PIONEER" / "rekordbox" / "export.pdb")


def test_core_tables_populated(pdb):
    for table in ("tracks", "artists", "keys", "colors", "playlist_tree", "playlist_entries"):
        assert pdb.tables[table].row_count > 0, table


def test_track_rows_decode(pdb):
    tracks = pdb.tables["tracks"].rows
    for track in tracks:
        assert track.title, track.id
        assert track.analyze_path and track.analyze_path.startswith("/PIONEER/USBANLZ/"), (
            track.id
        )
        assert track.file_path and track.file_path.startswith("/Contents/"), track.id
        assert track.duration_secs > 0, track.id
    with_tempo = [t for t in tracks if t.tempo_centibpm > 0]
    assert len(with_tempo) > len(tracks) // 2


def test_playlist_entries_reference_tracks(pdb):
    track_ids = {t.id for t in pdb.tables["tracks"].rows}
    playlist_ids = {p.id for p in pdb.tables["playlist_tree"].rows}
    for entry in pdb.tables["playlist_entries"].rows:
        assert entry.track_id in track_ids
        assert entry.playlist_id in playlist_ids


def test_export_ext_parses(export_root):
    ext_path = export_root / "PIONEER" / "rekordbox" / "exportExt.pdb"
    if not ext_path.is_file():
        pytest.skip("no exportExt.pdb in this export")
    ext = read_pdb(ext_path)
    assert ext.is_ext
    assert "tags" in ext.tables


def test_all_dat_files_parse_with_sane_grids(export_root, pdb):
    tracks = pdb.tables["tracks"].rows
    assert tracks
    gridless = 0
    for track in tracks:
        dat_path = export_root / track.analyze_path.lstrip("/")
        assert dat_path.is_file(), track.analyze_path
        data = read_anlz(dat_path)
        assert data.audio_path == track.file_path
        if not data.beats:
            gridless += 1
            continue
        times = [b.time_ms for b in data.beats]
        assert times == sorted(times), track.analyze_path
        assert all(b.beat_number in (1, 2, 3, 4) for b in data.beats)
        assert all(b.tempo_centibpm > 0 for b in data.beats)
    # rekordbox analyzes nearly everything; a mostly-gridless corpus means
    # we are misreading PQTZ, not that the DJ skipped analysis
    assert gridless < len(tracks) // 10


def test_ext_anlz_sample_parses_with_waveforms_and_cue_colors(export_root, pdb):
    tracks = pdb.tables["tracks"].rows
    sampled = 0
    saw_color_waveform = False
    saw_extended_cue = False
    for track in tracks:
        ext_path = (export_root / track.analyze_path.lstrip("/")).with_suffix(".EXT")
        if not ext_path.is_file():
            continue
        data = read_anlz(ext_path)
        sampled += 1
        kinds = {w.kind for w in data.waveforms}
        if {"PWV4", "PWV5"} & kinds:
            saw_color_waveform = True
        if data.cues_extended:
            saw_extended_cue = True
        if sampled >= 25 and saw_color_waveform and saw_extended_cue:
            break
    assert sampled > 0
    assert saw_color_waveform
    assert saw_extended_cue
