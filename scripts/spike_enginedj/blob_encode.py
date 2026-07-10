"""Spike-grade Engine perf-blob encoders + corpus round-trip harness.

Engine write-path spike (library-sync-button/08). Full-fidelity parse/
encode pairs for beatData, quickCues, trackData (qCompress-framed) and
loops (raw). Fidelity contract: encode(parse(payload)) == payload for
every blob in a library, byte-exact on the UNCOMPRESSED payload (the
zlib stream may differ from Qt's; Engine only needs a valid stream).

The beatgrid marker's unknown u32 is preserved verbatim (values in the
wild: 0,1,7-12,24576, occasional garbage -> treated as opaque; write 0
for freshly authored grids).

Round-trip over an enginestate.py dump:
    uv run scripts/spike_enginedj/blob_encode.py --corpus /tmp/dump.json
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
import zlib


# --- qCompress framing ---

def q_compress(raw: bytes) -> bytes:
    return struct.pack(">I", len(raw)) + zlib.compress(raw)


# --- beatData ---

def parse_beat_data_full(raw: bytes) -> dict:
    off = 0
    sr, length = struct.unpack_from(">dd", raw, off); off += 16
    is_set = raw[off]; off += 1
    grids = []
    for _ in range(2):
        (n,) = struct.unpack_from(">q", raw, off); off += 8
        markers = []
        for _ in range(n):
            so, bi, btn, unk = struct.unpack_from("<dqII", raw, off); off += 24
            markers.append(
                {"sample_offset": so, "beat_index": bi,
                 "beats_to_next": btn, "unknown": unk}
            )
        grids.append(markers)
    tail = raw[off:]  # schema 3.x extension: flag byte + 8 bytes, opaque
    if len(tail) != 9:
        raise ValueError(f"beatData unexpected tail length: {len(tail)}")
    return {"sample_rate": sr, "length": length, "is_set": is_set,
            "default_grid": grids[0], "adjusted_grid": grids[1],
            "tail": tail.hex()}


def encode_beat_data_full(d: dict) -> bytes:
    out = struct.pack(">dd", d["sample_rate"], d["length"])
    out += bytes([d["is_set"]])
    for grid in (d["default_grid"], d["adjusted_grid"]):
        out += struct.pack(">q", len(grid))
        for m in grid:
            out += struct.pack(
                "<dqII", m["sample_offset"], m["beat_index"],
                m["beats_to_next"], m["unknown"],
            )
    out += bytes.fromhex(d["tail"])
    return out

FRESH_BEAT_TAIL = "00" + "00" * 8  # for authoring grids from scratch


# --- quickCues ---

def parse_quick_cues_full(raw: bytes) -> dict:
    off = 0
    (n,) = struct.unpack_from(">q", raw, off); off += 8
    slots = []
    for _ in range(n):
        label_len = raw[off]; off += 1
        label = raw[off:off + label_len].decode("utf-8"); off += label_len
        (pos,) = struct.unpack_from(">d", raw, off); off += 8
        argb = raw[off:off + 4]; off += 4
        slots.append({"label": label, "position": pos, "argb": argb.hex()})
    main_cue, = struct.unpack_from(">d", raw, off); off += 8
    overridden = raw[off]; off += 1
    default_cue, = struct.unpack_from(">d", raw, off); off += 8
    if off != len(raw):
        raise ValueError(f"quickCues trailing bytes: {len(raw) - off}")
    return {"slots": slots, "main_cue": main_cue,
            "overridden": overridden, "default_cue": default_cue}


def encode_quick_cues_full(d: dict) -> bytes:
    out = struct.pack(">q", len(d["slots"]))
    for s in d["slots"]:
        label = s["label"].encode("utf-8")
        out += bytes([len(label)]) + label
        out += struct.pack(">d", s["position"])
        out += bytes.fromhex(s["argb"])
    out += struct.pack(">d", d["main_cue"])
    out += bytes([d["overridden"]])
    out += struct.pack(">d", d["default_cue"])
    return out


# --- trackData ---

def parse_track_data(raw: bytes) -> dict:
    if len(raw) not in (44, 68):  # 68 = newer analyzer, 3 extra f64s
        raise ValueError(f"trackData length {len(raw)} not in (44, 68)")
    sr, = struct.unpack_from(">d", raw, 0)
    length, = struct.unpack_from(">Q", raw, 8)
    key, = struct.unpack_from(">I", raw, 16)
    n = (len(raw) - 20) // 8
    loudness = list(struct.unpack_from(f">{n}d", raw, 20))
    return {"sample_rate": sr, "length_samples": length, "key": key,
            "loudness": loudness}


def encode_track_data(d: dict) -> bytes:
    return (
        struct.pack(">d", d["sample_rate"])
        + struct.pack(">Q", d["length_samples"])
        + struct.pack(">I", d["key"])
        + struct.pack(f">{len(d['loudness'])}d", *d["loudness"])
    )


# --- loops (raw, little-endian, NOT compressed) ---

def parse_loops(raw: bytes) -> dict:
    off = 0
    n, = struct.unpack_from("<q", raw, off); off += 8
    loops = []
    for _ in range(n):
        label_len = raw[off]; off += 1
        label = raw[off:off + label_len].decode("utf-8"); off += label_len
        start, end = struct.unpack_from("<dd", raw, off); off += 16
        start_set, end_set = raw[off], raw[off + 1]; off += 2
        argb = raw[off:off + 4]; off += 4
        loops.append({"label": label, "start": start, "end": end,
                      "start_set": start_set, "end_set": end_set,
                      "argb": argb.hex()})
    if off != len(raw):
        raise ValueError(f"loops trailing bytes: {len(raw) - off}")
    return {"loops": loops}


def encode_loops(d: dict) -> bytes:
    out = struct.pack("<q", len(d["loops"]))
    for l in d["loops"]:
        label = l["label"].encode("utf-8")
        out += bytes([len(label)]) + label
        out += struct.pack("<dd", l["start"], l["end"])
        out += bytes([l["start_set"], l["end_set"]])
        out += bytes.fromhex(l["argb"])
    return out


PAIRS = {
    "beatData": (parse_beat_data_full, encode_beat_data_full, True),
    "quickCues": (parse_quick_cues_full, encode_quick_cues_full, True),
    "trackData": (parse_track_data, encode_track_data, True),
    "loops": (parse_loops, encode_loops, False),
}


def corpus_roundtrip(dump_path: str) -> None:
    d = json.load(open(dump_path))
    counts: dict[str, list[int]] = {k: [0, 0, 0] for k in PAIRS}  # ok, fail, skip
    failures: list[str] = []
    for t in d["tracks"]:
        pd = t.get("performance_data") or {}
        for name, (parse, encode, compressed) in PAIRS.items():
            rep = pd.get(name) or {}
            hexstr = rep.get("uncompressed_hex") if compressed else rep.get("hex")
            if not rep.get("present") or not hexstr:
                counts[name][2] += 1
                continue
            payload = bytes.fromhex(hexstr)
            try:
                if encode(parse(payload)) == payload:
                    counts[name][0] += 1
                else:
                    counts[name][1] += 1
                    failures.append(f"{name} track={t['id']} {t.get('title')!r}: MISMATCH")
            except Exception as e:
                counts[name][1] += 1
                failures.append(f"{name} track={t['id']} {t.get('title')!r}: {e!r}")
    for name, (ok, fail, skip) in counts.items():
        print(f"{name:12s} ok={ok:5d} fail={fail:3d} skip={skip:4d}")
    for f in failures[:20]:
        print(" ", f)
    if failures:
        sys.exit(1)
    print("corpus round-trip: all byte-exact")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", required=True)
    args = ap.parse_args()
    corpus_roundtrip(args.corpus)
