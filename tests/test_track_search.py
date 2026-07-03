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
