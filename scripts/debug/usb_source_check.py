"""Compare a device export against the lane's source DB and staged analysis.

uv run -m scripts.debug.usb_source_check --dest /Volumes/STICK \
    --staged data/staged-export --playlist "My Set" [--out report.json]
"""

import argparse
import hashlib
import json
from pathlib import Path

from backend.database import SessionLocal
from backend.models import Playlist, PlaylistTrack, Track
from rekordbox.decode_offset import export_offset_ms
from rekordbox.device.anlz_read import read_anlz
from rekordbox.device.pdb_read import read_pdb
from rekordbox.device.verify import verify_export


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest", type=Path, required=True)
    parser.add_argument("--staged", type=Path, required=True)
    parser.add_argument("--playlist", required=True)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    dest, stage = args.dest, args.staged
    result = verify_export(dest)
    assert not result["errors"], result
    pdb = read_pdb(dest / "PIONEER/rekordbox/export.pdb")
    artists = {a.id: a.name for a in pdb.tables["artists"].rows}
    audio_verified = 0
    analysis_unchanged = 0
    hotcue_count = 0
    with SessionLocal() as db:
        playlist = db.query(Playlist).filter_by(name=args.playlist).one()
        expected = [
            e.track_id
            for e in db.query(PlaylistTrack)
            .filter_by(playlist_id=playlist.id)
            .order_by(PlaylistTrack.position)
        ]
        actual = [
            e.track_id
            for e in sorted(pdb.tables["playlist_entries"].rows, key=lambda e: e.entry_index)
        ]
        assert actual == expected, "playlist order differs"
        for row in pdb.tables["tracks"].rows:
            track = db.get(Track, row.id)
            assert row.title == (track.title or Path(track.filename).stem)
            assert artists.get(row.artist_id, "") == (track.artist or "").strip()
            assert row.tempo_centibpm == round((track.bpm_projected or 0) * 100)
            assert sha(Path(track.filename)) == sha(dest / row.file_path.lstrip("/"))
            audio_verified += 1
            offset = export_offset_ms(track.filename)
            path = dest / row.analyze_path.lstrip("/")
            ext = read_anlz(path.with_suffix(".EXT"))
            actual_hot = {
                c.hot_cue: (c.time_ms, c.comment.rstrip("\x00"))
                for c in ext.cues_extended
                if c.hot_cue
            }
            expected_hot = {
                c.slot_number: (max(0, round(c.time_seconds * 1000 + offset)), c.label or "")
                for c in track.hotcues
            }
            assert actual_hot == expected_hot, (row.id, actual_hot, expected_hot)
            hotcue_count += len(actual_hot)
            if track.cue_point_time is not None:
                main = max(0, round(track.cue_point_time * 1000 + offset))
                assert any(c.hot_cue == 0 and c.time_ms == main for c in ext.cues_extended)
            for suffix in (".DAT", ".EXT", ".2EX"):
                staged = (stage / row.analyze_path.lstrip("/")).with_suffix(suffix)
                assert sha(path.with_suffix(suffix)) == sha(staged), (row.id, suffix)
                analysis_unchanged += 1
    result.update(
        audio_sha256_matches=audio_verified,
        analysis_unchanged=analysis_unchanged,
        hot_cues_match_source=hotcue_count,
        playlist_order_matches=True,
    )
    if args.out:
        args.out.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
