"""Device ANLZ writer: from-scratch builds verified through the read oracle."""

import pytest

from rekordbox.device.anlz_read import read_anlz
from rekordbox.device.anlz_write import (
    Beat,
    BeatGridSection,
    CueEntry,
    CueExtendedEntry,
    CueExtendedListSection,
    CueListSection,
    PathSection,
    VbrSection,
    WaveEntrySection,
    WavePreviewSection,
    build_anlz,
)

AUDIO_PATH = "/Contents/Artist/Album/Track.mp3"


def build_dat(tmp_path, sections):
    path = tmp_path / "ANLZ0000.DAT"
    path.write_bytes(build_anlz(sections))
    return read_anlz(path)


def test_minimal_dat_parses_through_oracle(tmp_path):
    beats = [Beat(beat_number=(i % 4) + 1, tempo_centibpm=17400, time_ms=21 + i * 345) for i in range(8)]
    data = build_dat(
        tmp_path,
        [
            PathSection(path=AUDIO_PATH),
            VbrSection(),
            BeatGridSection(beats=beats),
            WavePreviewSection(fourcc=b"PWAV", data=bytes([0x25] * 400)),
            WavePreviewSection(fourcc=b"PWV2", data=bytes([0x05] * 100)),
            CueListSection(list_type=0, cues=[CueEntry(hot_cue=0, time_ms=1425)]),
            CueListSection(list_type=1),
        ],
    )
    assert data.audio_path == AUDIO_PATH
    assert [b.time_ms for b in data.beats] == [21 + i * 345 for i in range(8)]
    assert all(b.tempo_centibpm == 17400 for b in data.beats)
    assert data.has_vbr_index
    assert {w.kind for w in data.waveforms} == {"PWAV", "PWV2"}
    assert len(data.cues) == 1
    assert data.cues[0].time_ms == 1425
    assert data.cues[0].list_type == "memory_cues"


def test_extended_cues_with_colors_and_comments(tmp_path):
    cue = CueExtendedEntry(
        hot_cue=1,
        time_ms=34528,
        color_id=3,
        color_code=22,
        color_rgb=(40, 226, 20),
        comment="Drop\x00",
    )
    data = build_dat(
        tmp_path,
        [
            PathSection(path=AUDIO_PATH),
            CueExtendedListSection(list_type=1, cues=[cue]),
        ],
    )
    parsed = data.cues_extended[0]
    assert parsed.hot_cue == 1
    assert parsed.time_ms == 34528
    assert parsed.color_id == 3
    assert parsed.color_code == 22
    assert parsed.color_rgb == (40, 226, 20)
    assert parsed.comment == "Drop\x00"


def test_color_waveform_sections_parse(tmp_path):
    data = build_dat(
        tmp_path,
        [
            PathSection(path=AUDIO_PATH),
            WaveEntrySection(fourcc=b"PWV4", entries=bytes(6 * 1200)),
            WaveEntrySection(fourcc=b"PWV5", entries=bytes(2 * 300)),
        ],
    )
    kinds = {w.kind: w for w in data.waveforms}
    assert kinds["PWV4"].len_entries == 1200
    assert kinds["PWV5"].len_entries == 300


def test_entry_section_rejects_misaligned_data():
    with pytest.raises(ValueError):
        WaveEntrySection(fourcc=b"PWV4", entries=bytes(7)).encode()


def test_unicode_paths_survive(tmp_path):
    path = "/Contents/Ünïcode Artist/Träck.m4a"
    data = build_dat(tmp_path, [PathSection(path=path)])
    assert data.audio_path == path
