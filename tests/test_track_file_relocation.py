from pathlib import Path

from backend import models, schemas
from backend.routers.tracks import relocate_track_files


def test_relocate_shared_unicode_file_to_unique_ascii_paths(db_session, tmp_path: Path):
    source = tmp_path / "Anaïs - Empire.m4a"
    source.write_bytes(b"audio")
    tracks = [
        models.Track(filename=str(source), title="One"),
        models.Track(filename=str(source).replace("ï", "ï"), title="Two"),
    ]
    db_session.add_all(tracks)
    db_session.commit()

    result = relocate_track_files(
        schemas.TrackFileRelocationRequest(
            relocations=[
                schemas.TrackFileRelocation(
                    track_id=tracks[0].id, destination=str(tmp_path / "Anais - Empire 1.m4a")
                ),
                schemas.TrackFileRelocation(
                    track_id=tracks[1].id, destination=str(tmp_path / "Anais - Empire 2.m4a")
                ),
            ]
        ),
        db_session,
    )

    assert len(result["relocations"]) == 2
    assert not source.exists()
    for track in tracks:
        db_session.refresh(track)
        assert Path(track.filename).is_file()
        assert Path(track.filename).name.isascii()
        assert Path(track.filename).read_bytes() == b"audio"
