"""Track search matches filename, title, and artist (module interface)."""

from collections.abc import Callable

from sqlalchemy.orm import Session

from backend import crud
from backend.models import Track


def test_search_matches_title_and_artist_not_just_filename(
    db_session: Session, make_track: Callable[..., Track]
) -> None:
    make_track(filename="/tracks/ambiguous_rip_004.mp3", title="Wake Up", artist="Hoax")
    make_track(filename="/tracks/other.mp3", title="Watercolour", artist="Pendulum")

    def titles(search: str) -> list[str]:
        items, total, _ = crud.get_tracks(db_session, search=search)
        return [t.title for t in items]

    assert titles("wake up") == ["Wake Up"]
    assert titles("pendulum") == ["Watercolour"]
    assert titles("ambiguous_rip") == ["Wake Up"]
    assert titles("nonexistent") == []


def test_list_response_carries_file_facts_and_provenance(
    db_session: Session, make_track: Callable[..., Track]
) -> None:
    from backend.acquisition.models import AudioProvenance

    track = make_track(
        title="Wake Up", artist="Hoax", codec="aac", bitrate_kbps=128, filesize_bytes=4_400_000
    )
    db_session.add(
        AudioProvenance(
            track_id=int(track.id), source="youtube",
            url="https://youtu.be/x", asserted=True,
        )
    )
    db_session.commit()

    items, _, _ = crud.get_tracks(db_session, sort_column="bitrate_kbps", sort_direction="asc")
    assert items[0].codec == "aac" and items[0].bitrate_kbps == 128

    prov = crud.get_provenance_map(db_session, [int(track.id)])
    assert prov[int(track.id)]["label"] == "youtube"


def test_sort_by_provenance_label(
    db_session: Session, make_track: Callable[..., Track]
) -> None:
    from backend.acquisition.models import AudioProvenance

    a = make_track(title="A")
    b = make_track(title="B")
    db_session.add_all([
        AudioProvenance(track_id=int(a.id), source="youtube", asserted=True),
        AudioProvenance(track_id=int(b.id), source="beatport", asserted=True),
    ])
    db_session.commit()

    items, _, _ = crud.get_tracks(db_session, sort_column="provenance", sort_direction="asc")
    assert [t.title for t in items] == ["B", "A"]
