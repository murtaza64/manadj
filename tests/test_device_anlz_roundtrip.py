"""Corpus-gated byte round-trip for ANLZ files (.DAT/.EXT/.2EX).

Every ANLZ file of a real rekordbox export is parsed, each section is
re-encoded from parsed fields via rekordbox/device/anlz_write, and the
rebuilt file must be byte-identical. Sections with un-reverse-engineered
bodies (PSSI, PQT2, PVB2, PWVC) pass through verbatim; everything else is
genuinely re-derived.
"""

import os
import struct
from collections import Counter
from pathlib import Path

import pytest

from rekordbox.device.anlz_write import (
    Beat,
    BeatGridSection,
    CueEntry,
    CueExtendedEntry,
    CueExtendedListSection,
    CueListSection,
    PathSection,
    RawSection,
    VbrSection,
    WaveEntrySection,
    WavePreviewSection,
    build_anlz,
)
from rekordbox.device.generated.rekordbox_anlz import RekordboxAnlz

_CORPUS = os.environ.get("MANADJ_RB_EXPORT_CORPUS")

pytestmark = pytest.mark.skipif(not _CORPUS, reason="MANADJ_RB_EXPORT_CORPUS not set")

RAW_OK = {b"PSSI", b"PQT2", b"PVB2", b"PWVC"}


def _roots() -> list[Path]:
    if not _CORPUS:
        return []
    base = Path(_CORPUS)
    if (base / "PIONEER").is_dir():
        return [base]
    return sorted(p for p in base.iterdir() if (p / "PIONEER").is_dir())


def _fourcc_bytes(section) -> bytes:
    value = int(section.fourcc)
    return struct.pack(">i", value)


def adapt_section(section, raw_stats: Counter):
    tags = RekordboxAnlz.SectionTags
    fourcc = section.fourcc
    body = section.body
    if fourcc == tags.path:
        return PathSection(path=body.path)
    if fourcc == tags.vbr:
        # the generated parser reads only 400 entries; VBR files carry 401 —
        # recover the full index from the raw section body
        raw = section._raw_body
        count = (len(raw) - 4) // 4
        unknown0, *index = struct.unpack(f">{count + 1}I", raw[: 4 + 4 * count])
        return VbrSection(index=index, unknown0=unknown0)
    if fourcc == tags.beat_grid:
        return BeatGridSection(
            beats=[Beat(b.beat_number, b.tempo, b.time) for b in body.beats],
            unknown0=body._unnamed0,
            unknown1=body._unnamed1,
        )
    if fourcc == tags.cues:
        return CueListSection(
            list_type=int(body.type),
            memory_count=body.memory_count,
            unknown1=int.from_bytes(body._unnamed1, "big"),
            cues=[
                CueEntry(
                    hot_cue=c.hot_cue,
                    time_ms=c.time,
                    type=int(c.type),
                    loop_time_ms=c.loop_time,
                    status=int(c.status),
                    order_first=c.order_first,
                    order_last=c.order_last,
                    unknown5=c._unnamed5,
                    unknown9=c._unnamed9,
                    unknown12=c._unnamed12,
                )
                for c in body.cues
            ],
        )
    if fourcc == tags.cues_2:
        return CueExtendedListSection(
            list_type=int(body.type),
            unknown2=int.from_bytes(body._unnamed2, "big"),
            cues=[
                CueExtendedEntry(
                    hot_cue=c.hot_cue,
                    time_ms=c.time,
                    type=int(c.type),
                    loop_time_ms=c.loop_time,
                    color_id=c.color_id,
                    comment=getattr(c, "comment", ""),
                    color_code=getattr(c, "color_code", 0),
                    color_rgb=(
                        getattr(c, "color_red", 0),
                        getattr(c, "color_green", 0),
                        getattr(c, "color_blue", 0),
                    ),
                    loop_numerator=c.loop_numerator,
                    loop_denominator=c.loop_denominator,
                    unknown5=c._unnamed5,
                    unknown9=c._unnamed9,
                    tail=getattr(c, "_unnamed18", b""),
                )
                for c in body.cues
            ],
        )
    if fourcc in (tags.wave_preview, tags.wave_tiny):
        return WavePreviewSection(
            fourcc=_fourcc_bytes(section), data=body.data, unknown1=body._unnamed1
        )
    if fourcc in (
        tags.wave_scroll,
        tags.wave_color_preview,
        tags.wave_color_scroll,
        tags.wave_3band_preview,
        tags.wave_3band_scroll,
    ):
        return WaveEntrySection(
            fourcc=_fourcc_bytes(section),
            entries=body.entries,
            len_entry_bytes=body.len_entry_bytes,
            unknown2=getattr(body, "_unnamed2", 0),
        )
    raw_stats[_fourcc_bytes(section)] += 1
    return RawSection(
        fourcc=_fourcc_bytes(section),
        len_header=section.len_header,
        body=section._raw_body if hasattr(section, "_raw_body") else section.body.data,
    )


def reassemble(path: Path, raw_stats: Counter) -> bytes:
    root = RekordboxAnlz.from_file(str(path))
    sections = [adapt_section(s, raw_stats) for s in root.sections]
    return build_anlz(sections)


@pytest.fixture(scope="module", params=_roots(), ids=lambda p: p.name)
def export_root(request) -> Path:
    return request.param


def anlz_files(root: Path) -> list[Path]:
    usbanlz = root / "PIONEER" / "USBANLZ"
    return sorted(
        p
        for p in usbanlz.rglob("*")
        if p.is_file() and p.suffix.lower() in {".dat", ".ext", ".2ex"}
    )


def test_all_anlz_files_roundtrip_byte_identical(export_root):
    files = anlz_files(export_root)
    assert files
    raw_stats: Counter = Counter()
    failures = []
    for path in files:
        original = path.read_bytes()
        rebuilt = reassemble(path, raw_stats)
        if rebuilt != original:
            diff = next(
                (i for i, (a, b) in enumerate(zip(original, rebuilt)) if a != b),
                min(len(original), len(rebuilt)),
            )
            failures.append((path.name, str(path.parent)[-20:], diff, len(original), len(rebuilt)))
    assert not failures, failures[:5]
    # verbatim fallbacks must be exactly the known undocumented tags
    assert set(raw_stats) <= RAW_OK, raw_stats
