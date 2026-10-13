"""Typed read layer over the Kaitai-generated ANLZ parser (.DAT/.EXT/.2EX).

Surfaces the performance-relevant sections (path, beat grid, cue lists,
extended cue lists, song structure) as dataclasses, waveform tags as size
summaries (their payloads are bulk bytes), and unknown tags gracefully as
raw section records.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from rekordbox.device.generated.rekordbox_anlz import RekordboxAnlz


def _fourcc_str(fourcc: Any) -> str:
    if hasattr(fourcc, "name"):
        value = int(fourcc)
    else:
        value = int(fourcc)
    try:
        return struct.pack(">i", value).decode("ascii")
    except (UnicodeDecodeError, struct.error):
        return f"0x{value & 0xFFFFFFFF:08x}"


def _enum_name(value: Any) -> str | int:
    return value.name if hasattr(value, "name") else int(value)


@dataclass
class AnlzBeat:
    beat_number: int  # position within the bar, 1-4
    tempo_centibpm: int
    time_ms: int


@dataclass
class AnlzCue:
    list_type: str | int  # memory_cues / hot_cues
    hot_cue: int  # 0 = memory cue; 1-based hot cue slot otherwise
    status: str | int
    type: str | int  # point / loop
    time_ms: int
    loop_time_ms: int


@dataclass
class AnlzCueExtended:
    list_type: str | int
    hot_cue: int
    type: str | int
    time_ms: int
    loop_time_ms: int
    color_id: int
    color_code: int | None
    color_rgb: tuple[int, int, int] | None
    comment: str | None
    loop_numerator: int
    loop_denominator: int


@dataclass
class AnlzWaveform:
    kind: str  # section fourcc
    len_entry_bytes: int
    len_entries: int
    data_len: int


@dataclass
class AnlzPhrase:
    index: int
    beat: int
    kind: str | int


@dataclass
class AnlzSongStructure:
    mood: str | int
    end_beat: int
    bank: str | int
    phrases: list[AnlzPhrase] = field(default_factory=list)


@dataclass
class AnlzSection:
    fourcc: str
    len_tag: int


@dataclass
class AnlzData:
    path: str  # path of the parsed ANLZ file itself
    audio_path: str | None  # PPTH: path of the analyzed audio file
    len_file: int
    sections: list[AnlzSection] = field(default_factory=list)
    beats: list[AnlzBeat] = field(default_factory=list)
    cues: list[AnlzCue] = field(default_factory=list)
    cues_extended: list[AnlzCueExtended] = field(default_factory=list)
    waveforms: list[AnlzWaveform] = field(default_factory=list)
    song_structure: AnlzSongStructure | None = None
    has_vbr_index: bool = False


_WAVEFORM_TAGS = {
    "wave_preview",
    "wave_tiny",
    "wave_scroll",
    "wave_color_preview",
    "wave_color_scroll",
    "wave_3band_preview",
    "wave_3band_scroll",
}


def _convert_cues(body: Any) -> list[AnlzCue]:
    list_type = _enum_name(body.type)
    return [
        AnlzCue(
            list_type=list_type,
            hot_cue=cue.hot_cue,
            status=_enum_name(cue.status),
            type=_enum_name(cue.type),
            time_ms=cue.time,
            loop_time_ms=cue.loop_time,
        )
        for cue in body.cues
    ]


def _convert_cues_extended(body: Any) -> list[AnlzCueExtended]:
    list_type = _enum_name(body.type)
    result = []
    for cue in body.cues:
        rgb = None
        if getattr(cue, "color_red", None) is not None:
            rgb = (cue.color_red, cue.color_green, cue.color_blue)
        result.append(
            AnlzCueExtended(
                list_type=list_type,
                hot_cue=cue.hot_cue,
                type=_enum_name(cue.type),
                time_ms=cue.time,
                loop_time_ms=cue.loop_time,
                color_id=cue.color_id,
                color_code=getattr(cue, "color_code", None),
                color_rgb=rgb,
                comment=getattr(cue, "comment", None),
                loop_numerator=cue.loop_numerator,
                loop_denominator=cue.loop_denominator,
            )
        )
    return result


def _convert_song_structure(body: Any) -> AnlzSongStructure | None:
    try:
        inner = body.body
        phrases = [
            AnlzPhrase(index=e.index, beat=e.beat, kind=_enum_name(e.kind.id))
            for e in inner.entries
        ]
        return AnlzSongStructure(
            mood=_enum_name(inner.mood),
            end_beat=inner.end_beat,
            bank=_enum_name(inner.bank),
            phrases=phrases,
        )
    except Exception:  # noqa: BLE001
        # Masked/undocumented variants: keep the section record, drop detail.
        return None


def read_anlz(path: str | Path) -> AnlzData:
    """Parse one ANLZ file (.DAT, .EXT, or .2EX)."""
    path = Path(path)
    root = RekordboxAnlz.from_file(str(path))

    data = AnlzData(path=str(path), audio_path=None, len_file=root.len_file)
    tags = RekordboxAnlz.SectionTags
    for section in root.sections:
        fourcc = section.fourcc
        data.sections.append(
            AnlzSection(fourcc=_fourcc_str(fourcc), len_tag=section.len_tag)
        )
        body = section.body
        if fourcc == tags.path:
            if getattr(body, "path", None):
                data.audio_path = body.path
        elif fourcc == tags.beat_grid:
            data.beats = [
                AnlzBeat(beat_number=b.beat_number, tempo_centibpm=b.tempo, time_ms=b.time)
                for b in body.beats
            ]
        elif fourcc == tags.cues:
            data.cues.extend(_convert_cues(body))
        elif fourcc == tags.cues_2:
            data.cues_extended.extend(_convert_cues_extended(body))
        elif fourcc == tags.vbr:
            data.has_vbr_index = True
        elif fourcc == tags.song_structure:
            data.song_structure = _convert_song_structure(body)
        elif hasattr(fourcc, "name") and fourcc.name in _WAVEFORM_TAGS:
            data.waveforms.append(
                AnlzWaveform(
                    kind=_fourcc_str(fourcc),
                    len_entry_bytes=getattr(body, "len_entry_bytes", 1),
                    len_entries=getattr(body, "len_entries", getattr(body, "len_data", 0)),
                    data_len=len(getattr(body, "entries", getattr(body, "data", b"") or b"")),
                )
            )
    return data
