"""Engine DJ playlist management utilities."""

from backend.models import Track as ManAdjTrack, TrackTag
from enginedj.models.track import Track as EDJTrack


def get_tracks_by_tag(manadj_session, tag_id: int) -> list[ManAdjTrack]:
    """
    Get all tracks that have a specific tag.

    Args:
        manadj_session: manadj database session
        tag_id: Tag ID to filter by

    Returns:
        List of Track objects with this tag
    """
    # Query tracks via TrackTag junction
    tracks = manadj_session.query(ManAdjTrack).join(
        TrackTag, TrackTag.track_id == ManAdjTrack.id
    ).filter(
        TrackTag.tag_id == tag_id
    ).all()

    return tracks


def find_playlist_by_title_and_parent(
    edj_session,
    title: str,
    parent_id: int
):
    """
    Find an existing Engine DJ playlist by title and parent.

    Args:
        edj_session: Engine DJ session
        title: Playlist title
        parent_id: Parent playlist ID (0 for root)

    Returns:
        Playlist object if found, None otherwise
    """
    from enginedj.models.playlist import Playlist

    playlist = edj_session.query(Playlist).filter(
        Playlist.title == title,
        Playlist.parentListId == parent_id
    ).first()

    return playlist


def update_playlist_tracks(
    edj_session,
    playlist_id: int,
    edj_tracks: list[EDJTrack],
    db_uuid: str
) -> int:
    """
    Update tracks in an existing playlist.
    Clears old PlaylistEntity records and creates new linked list.

    Args:
        edj_session: Engine DJ writable session
        playlist_id: Playlist ID to update
        edj_tracks: List of Engine DJ Track objects to add
        db_uuid: Database UUID for PlaylistEntity records

    Returns:
        Number of tracks added
    """
    from enginedj.models.playlist import Playlist
    from enginedj.models.playlist_entity import PlaylistEntity
    import time

    # Delete all existing PlaylistEntity records for this playlist
    edj_session.query(PlaylistEntity).filter(
        PlaylistEntity.listId == playlist_id
    ).delete()

    # Create new PlaylistEntity records
    entities = []
    for track in edj_tracks:
        entity = PlaylistEntity(
            listId=playlist_id,
            trackId=track.id,
            databaseUuid=db_uuid,
            nextEntityId=0,
            membershipReference=0
        )
        entities.append(entity)
        edj_session.add(entity)

    edj_session.flush()  # Get entity IDs

    # Link entities in order
    for i in range(len(entities) - 1):
        entities[i].nextEntityId = entities[i + 1].id

    # Update playlist lastEditTime
    playlist = edj_session.query(Playlist).filter(
        Playlist.id == playlist_id
    ).first()
    if playlist:
        playlist.lastEditTime = int(time.time())

    return len(entities)


def create_or_update_playlist(
    edj_session,
    title: str,
    parent_id: int,
    edj_tracks: list[EDJTrack],
    db_uuid: str
):
    """
    Create new playlist or update existing one.

    Args:
        edj_session: Engine DJ writable session
        title: Playlist title
        parent_id: Parent playlist ID
        edj_tracks: Tracks to add
        db_uuid: Database UUID

    Returns:
        Tuple of (Playlist object, was_created: bool)
    """
    from enginedj.models.playlist import Playlist
    from enginedj.models.playlist_entity import PlaylistEntity
    import time

    # Find existing playlist
    existing = find_playlist_by_title_and_parent(edj_session, title, parent_id)

    if existing:
        # Update existing playlist
        update_playlist_tracks(edj_session, existing.id, edj_tracks, db_uuid)
        return existing, False
    else:
        # Create new playlist
        current_time = int(time.time())
        playlist = Playlist(
            title=title,
            parentListId=parent_id,
            nextListId=0,
            isPersisted=True,
            isExplicitlyExported=False,
            lastEditTime=current_time
        )
        edj_session.add(playlist)
        edj_session.flush()  # Get the ID

        playlist_id = playlist.id

        # Update previous playlist's nextListId to maintain sibling linked list
        prev_playlist = edj_session.query(Playlist).filter(
            Playlist.parentListId == parent_id,
            Playlist.nextListId == 0,
            Playlist.id != playlist_id
        ).first()

        if prev_playlist:
            prev_playlist.nextListId = playlist_id

        # Create PlaylistEntity records if tracks provided
        if edj_tracks:
            entities = []
            for track in edj_tracks:
                entity = PlaylistEntity(
                    listId=playlist_id,
                    trackId=track.id,
                    databaseUuid=db_uuid,
                    nextEntityId=0,
                    membershipReference=0
                )
                entities.append(entity)
                edj_session.add(entity)

            edj_session.flush()  # Get all entity IDs

            # Link entities in order
            for i in range(len(entities) - 1):
                entities[i].nextEntityId = entities[i + 1].id

        return playlist, True
