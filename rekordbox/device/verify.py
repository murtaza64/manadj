"""Read back a manadj device export without consulting the writer.

    uv run -m rekordbox.device.verify /Volumes/STICK

Checks the generated classic library, references, audio sizes, and bounded
analysis tags. This is not certification for a particular player model.
"""

import argparse
import struct
from itertools import pairwise
from pathlib import Path

from pyrekordbox.anlz.tags import TAGS

from rekordbox.device.anlz_read import read_anlz
from rekordbox.device.pdb_read import read_pdb


def verify_export(dest: Path) -> dict:
    dest = Path(dest).resolve()
    errors = []
    report = {"tracks": 0, "playlists": 0, "analysis_files": 0, "errors": errors}
    try:
        for name in ("export.pdb", "exportExt.pdb"):
            path = dest / "PIONEER/rekordbox" / name
            data = path.read_bytes()
            _, size, count = struct.unpack_from("<III", data)
            if not size or len(data) % size:
                raise ValueError(f"{name}: incomplete page")
            for i in range(count):
                kind, _, first, last = struct.unpack_from("<IIII", data, 28 + i * 16)
                own, first_data, magic = struct.unpack_from("<IIQ", data, first * size + 40)
                if own != first or magic != 0x03FFFFFF:
                    errors.append(f"{name}: invalid index body in table {i}")
                if first == last and first_data != 0x03FFFFFF:
                    errors.append(f"{name}: invalid empty-table index in table {i}")
                if (
                    first != last
                    and first_data != struct.unpack_from("<I", data, first * size + 12)[0]
                ):
                    errors.append(f"{name}: invalid first-data pointer in table {i}")
                count_slots, first_empty = struct.unpack_from("<HH", data, first * size + 56)
                if count_slots == 0 and (
                    first_empty != 0x1FFF
                    or data[first * size + 60 : (first + 1) * size - 20]
                    != struct.pack("<I", 0x1FFFFFF8) * ((size - 80) // 4)
                ):
                    errors.append(f"{name}: invalid empty index slots in table {i}")
                current, seen = first, set()
                while True:
                    if current in seen or not 0 < current < len(data) // size:
                        raise ValueError(f"{name}: invalid page chain in table {i}")
                    seen.add(current)
                    index, page_type, next_page = struct.unpack_from(
                        "<III", data, current * size + 4
                    )
                    if index != current or page_type != kind:
                        raise ValueError(f"{name}: wrong page identity in table {i}")
                    if current == last:
                        break
                    current = next_page
            read_pdb(path)
        pdb = read_pdb(dest / "PIONEER/rekordbox/export.pdb")
        tracks = {t.id: t for t in pdb.tables["tracks"].rows}
        playlists = {p.id for p in pdb.tables["playlist_tree"].rows if not p.is_folder}
        report["tracks"] = len(tracks)
        report["playlists"] = len(playlists)
        for entry in pdb.tables["playlist_entries"].rows:
            if entry.track_id not in tracks or entry.playlist_id not in playlists:
                errors.append(f"orphan playlist entry: {entry}")
    except Exception as exc:  # noqa: BLE001 - report parser failures from untrusted device bytes
        errors.append(f"PDB: {exc}")
        return report

    for track in tracks.values():
        try:
            paths = [
                (dest / p.lstrip("/")).resolve() for p in (track.file_path, track.analyze_path)
            ]
            if any(not p.is_relative_to(dest) for p in paths):
                raise ValueError("path escapes destination")
            audio, analysis = paths
            if audio.stat().st_size != track.file_size:
                raise ValueError("audio size does not match PDB")
            for suffix in (".DAT", ".EXT", ".2EX"):
                path = analysis.with_suffix(suffix)
                blob = path.read_bytes()
                magic, header, length = struct.unpack_from(">4sII", blob)
                if magic != b"PMAI" or header < 28 or length != len(blob):
                    raise ValueError(f"{suffix}: invalid file header")
                offset = header
                kinds = []
                cue_types = []
                while offset < length:
                    kind, tag_header, size = struct.unpack_from(">4sII", blob, offset)
                    if not 12 <= tag_header <= size or offset + size > length:
                        raise ValueError(f"{suffix}: invalid tag length at {offset}")
                    tag = blob[offset : offset + size]
                    # Bounded parsing matters: the library parser otherwise lets
                    # PVBR consume the next tag as its missing trailing word.
                    if kind.decode("ascii") in TAGS:
                        TAGS[kind.decode("ascii")](tag)
                    if kind == b"PCOB":
                        list_type, _, count, last = struct.unpack_from(">IHHI", tag, 12)
                        expected = (count - 1) & 0xFFFFFFFF if list_type == 0 else 0xFFFFFFFF
                        if last != expected:
                            raise ValueError(f"{suffix}: invalid cue-list sentinel")
                        cue_types.append(list_type)
                    kinds.append(kind)
                    offset += size
                if suffix != ".2EX" and cue_types != [1, 0]:
                    raise ValueError(f"{suffix}: expected hot then memory cue lists")
                required = (
                    {b"PPTH", b"PWAV", b"PWV2", b"PVBR"}
                    if suffix == ".DAT"
                    else {
                        b"PPTH",
                        b"PWV3",
                        b"PWV4",
                        b"PWV5",
                        b"PCO2",
                    }
                )
                if suffix == ".2EX":
                    required = {b"PPTH", b"PWV6", b"PWV7"}
                if not required <= set(kinds):
                    raise ValueError(f"{suffix}: missing analysis sections")
                parsed = read_anlz(path)
                if parsed.audio_path != track.file_path:
                    raise ValueError(f"{suffix}: audio path mismatch")
                for waveform in parsed.waveforms:
                    expected = {"PWAV": 400, "PWV2": 100, "PWV4": 1200, "PWV6": 1200}.get(
                        waveform.kind
                    )
                    if expected is not None and waveform.len_entries != expected:
                        raise ValueError(f"{suffix}: invalid {waveform.kind} preview size")
                times = [b.time_ms for b in parsed.beats]
                if any(a >= b for a, b in pairwise(times)):
                    raise ValueError(f"{suffix}: non-increasing grid")
                if suffix == ".DAT" and track.tempo_centibpm and not times:
                    raise ValueError("missing beatgrid")
                report["analysis_files"] += 1
        except Exception as exc:  # noqa: BLE001 - keep checking the other tracks
            errors.append(f"track {track.id} ({track.title}): {exc}")
    return report


def main():
    import json

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dest", type=Path)
    report = verify_export(parser.parse_args().dest)
    print(json.dumps(report, indent=2))
    raise SystemExit(1 if report["errors"] else 0)


if __name__ == "__main__":
    main()
