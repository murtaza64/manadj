from backend.models import Tag, TagCategory, TrackTag
from backend.tags.engine_writer import EngineTagWriter
from enginedj.models.playlist import Playlist
from enginedj.models.playlist_entity import PlaylistEntity
from enginedj.models.track import Track as EDJTrack
from tests.test_engine_track_export import InMemoryEngineDB


def test_scoped_tags_match_same_basenames_and_preserve_fallback(db, make_track, tmp_path):
    first = make_track(filename=str(tmp_path / "first" / "same.mp3"))
    second = make_track(filename=str(tmp_path / "second" / "same.mp3"))
    fallback = make_track(filename=str(tmp_path / "elsewhere" / "fallback.mp3"))
    category = TagCategory(name="Genre")
    db.add(category)
    db.flush()
    first_tag = Tag(category_id=category.id, name="First")
    db.add(first_tag)
    db.flush()
    db.add_all([
        TrackTag(track_id=first.id, tag_id=first_tag.id),
        TrackTag(track_id=fallback.id, tag_id=first_tag.id),
    ])
    db.commit()

    database = InMemoryEngineDB(tmp_path / "Engine Library")
    try:
        with database.session_m_write() as session:
            session.add_all([
                EDJTrack(id=1, path="../first/../first/same.mp3"),
                EDJTrack(id=2, path="../second/same.mp3"),
                EDJTrack(id=3, path="../Tracks/fallback.mp3"),
            ])

        def memberships():
            with database.session_m() as session:
                return {
                    playlist.title: {
                        entity.trackId
                        for entity in session.query(PlaylistEntity).filter_by(
                            listId=playlist.id
                        ).all()
                    }
                    for playlist in session.query(Playlist).all()
                    if playlist.title != "manaDJ Tags"
                }

        writer = EngineTagWriter(db, database)
        writer.sync_scoped_tag_assignments([first.id, second.id, fallback.id])
        assert memberships() == {"First": {1, 3}}

        db.query(TrackTag).filter_by(track_id=first.id, tag_id=first_tag.id).delete()
        db.commit()
        writer.sync_scoped_tag_assignments([first.id])
        assert memberships() == {"First": {3}}
    finally:
        database.engine.dispose()
