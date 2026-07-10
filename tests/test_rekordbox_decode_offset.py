"""Container classification + decode-frame offsets (rekordbox-perf-export/02).

Fabricated headers per class; the classifier was additionally validated
against the full real library vs an eyed3/mutagen ground truth (237/237
mp3s, 575/575 m4as) and the spike's known-answer transcode set.
"""

import pytest

from rekordbox.decode_offset import (
    ContainerClass,
    classify,
    export_offset_ms,
    manadj_seconds_to_rb_ms,
    rb_ms_to_manadj_seconds,
)


def mp3_frame_header() -> bytes:
    # MPEG1 Layer III, 320kbps, 44.1kHz, stereo -> side info 32 bytes
    return bytes([0xFF, 0xFB, 0xE0, 0x44])


def xing_block(marker: bytes = b"Info", encoder: bytes = b"Lavc61.19") -> bytes:
    flags = (1).to_bytes(4, "big")  # frames field only
    return marker + flags + (100).to_bytes(4, "big") + encoder


def id3v2(size: int) -> bytes:
    synchsafe = bytes(
        [(size >> 21) & 0x7F, (size >> 14) & 0x7F, (size >> 7) & 0x7F, size & 0x7F]
    )
    return b"ID3\x04\x00\x00" + synchsafe + b"\x00" * size


def write_mp3(tmp_path, name: str, *, id3_size=0, xing: bytes | None) -> str:
    body = mp3_frame_header() + b"\x00" * 32  # header + side info
    if xing is not None:
        body += xing
    body += b"\x00" * 512
    p = tmp_path / name
    p.write_bytes((id3v2(id3_size) if id3_size else b"") + body)
    return str(p)


def test_mp3_no_xing(tmp_path):
    p = write_mp3(tmp_path, "a.mp3", xing=None)
    assert classify(p) is ContainerClass.MP3_NO_XING
    assert export_offset_ms(p) == -2


def test_mp3_xing_without_lame(tmp_path):
    p = write_mp3(tmp_path, "b.mp3", xing=xing_block(b"Info", b"Lavc61.19"))
    assert classify(p) is ContainerClass.MP3_XING_ONLY
    assert export_offset_ms(p) == 23


def test_mp3_lame(tmp_path):
    p = write_mp3(tmp_path, "d.mp3", xing=xing_block(b"Xing", b"LAME3.100"))
    assert classify(p) is ContainerClass.MP3_LAME
    assert export_offset_ms(p) == 49


def test_mp3_huge_id3_tag_is_skipped(tmp_path):
    """Cover-art ID3 tags run to hundreds of KB; the sniffer must seek
    past them (real-library regression: 42 misclassifications)."""
    p = write_mp3(
        tmp_path, "art.mp3", id3_size=400_000, xing=xing_block(b"Xing", b"LAME3.100")
    )
    assert classify(p) is ContainerClass.MP3_LAME


def test_mp3_false_sync_inside_id3_ignored(tmp_path):
    """0xFFEx bytes inside tag data must not be taken for a frame."""
    tag = id3v2(64)
    tag = tag[:20] + b"\xff\xe4garbage" + tag[28:]  # fake sync mid-tag
    body = mp3_frame_header() + b"\x00" * 32 + xing_block(b"Xing", b"LAME3.100")
    p = tmp_path / "trap.mp3"
    p.write_bytes(tag + body)
    assert classify(p) is ContainerClass.MP3_LAME


def test_m4a_with_and_without_smpb(tmp_path):
    plain = tmp_path / "plain.m4a"
    plain.write_bytes(b"\x00\x00\x00\x20ftypM4A " + b"\x00" * 4096)
    smpb = tmp_path / "smpb.m4a"
    smpb.write_bytes(b"\x00\x00\x00\x20ftypM4A " + b"\x00" * 128 + b"iTunSMPB" + b"\x00" * 128)
    assert classify(plain) is ContainerClass.M4A_PLAIN
    assert export_offset_ms(plain) == 23
    assert classify(smpb) is ContainerClass.M4A_SMPB
    assert export_offset_ms(smpb) == 48


def test_lossless_and_unknown_are_zero(tmp_path):
    p = tmp_path / "x.flac"
    p.write_bytes(b"fLaC" + b"\x00" * 64)
    assert classify(p) is ContainerClass.LOSSLESS
    assert export_offset_ms(p) == 0
    assert classify(tmp_path / "missing.mp3") is ContainerClass.LOSSLESS


def test_frame_conversions_round_trip(tmp_path):
    p = write_mp3(tmp_path, "d.mp3", xing=xing_block(b"Xing", b"LAME3.100"))  # +49
    assert manadj_seconds_to_rb_ms(30.0, p) == 30049
    assert rb_ms_to_manadj_seconds(30049, p) == pytest.approx(30.0)
