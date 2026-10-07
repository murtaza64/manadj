"""Strict bounded-tag checks: the Kaitai oracle leaves some constants unchecked."""

import struct

import pytest
from pyrekordbox.anlz.tags import TAGS

from rekordbox.device.anlz_write import CueEntry, CueListSection, VbrSection


def test_vbr_has_fixed_index_and_trailing_word():
    data = VbrSection().encode()
    assert len(data) == 0x654
    TAGS["PVBR"](data)


def test_default_cue_constants_are_readable():
    data = CueListSection(list_type=0, cues=[CueEntry(hot_cue=0, time_ms=1000)]).encode()
    TAGS["PCOB"](data)


@pytest.mark.parametrize("count", [0, 1, 3])
def test_cue_list_sentinels(count):
    cues = [CueEntry(hot_cue=0, time_ms=i * 1000) for i in range(count)]
    memory = CueListSection(list_type=0, cues=cues).encode()
    hot = CueListSection(list_type=1, cues=cues).encode()
    assert struct.unpack_from(">I", memory, 20)[0] == (count - 1) & 0xFFFFFFFF
    assert struct.unpack_from(">I", hot, 20)[0] == 0xFFFFFFFF
