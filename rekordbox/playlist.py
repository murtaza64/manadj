"""Rekordbox playlist management utilities."""

from pyrekordbox.db6 import Rekordbox6Database
from pyrekordbox.db6.tables import DjmdPlaylist, DjmdSongPlaylist, DjmdContent


def find_playlist_by_name_and_parent(
    rb_db: Rekordbox6Database,
    name: str,
    parent_id: str
) -> DjmdPlaylist | None:
    """
    Find an existing Rekordbox playlist by name and parent.

    Args:
        rb_db: Rekordbox6Database instance
        name: Playlist name
        parent_id: Parent playlist ID (empty string for root)

    Returns:
        DjmdPlaylist object if found, None otherwise
    """
    playlists = list(rb_db.get_playlist())
    for playlist in playlists:
        if playlist.Name == name and (playlist.ParentID or "") == parent_id:
            return playlist
    return None


def update_playlist_tracks(
    rb_db: Rekordbox6Database,
    playlist: DjmdPlaylist,
    rb_tracks: list[DjmdContent]
) -> int:
    """
    Update tracks in an existing playlist.
    Clears old DjmdSongPlaylist records and creates new ones.

    Args:
        rb_db: Rekordbox6Database instance
        playlist: Playlist to update
        rb_tracks: List of Rekordbox DjmdContent objects to add

    Returns:
        Number of tracks added
    """
    # Delete all existing DjmdSongPlaylist records for this playlist
    existing_entries = rb_db.query(DjmdSongPlaylist).filter(
        DjmdSongPlaylist.PlaylistID == playlist.ID
    ).all()
    for entry in existing_entries:
        rb_db.session.delete(entry)

    # Create new DjmdSongPlaylist records with sequential TrackNo
    for i, track in enumerate(rb_tracks, start=1):
        song_playlist = DjmdSongPlaylist(
            ID=rb_db.generate_unused_id(),
            PlaylistID=playlist.ID,
            ContentID=track.ID,
            TrackNo=i,
            rb_local_usn=0,  # Will be updated by commit(autoinc=True)
            rb_local_deleted=0,
            rb_local_synced=0,
            Seq=0
        )
        rb_db.session.add(song_playlist)

    # Update playlist Seq (modification counter)
    playlist.Seq = (playlist.Seq or 0) + 1

    return len(rb_tracks)


def create_or_update_playlist(
    rb_db: Rekordbox6Database,
    name: str,
    parent_id: str,
    rb_tracks: list[DjmdContent]
) -> tuple[DjmdPlaylist, bool]:
    """
    Create new playlist or update existing one.

    Args:
        rb_db: Rekordbox6Database instance
        name: Playlist name
        parent_id: Parent playlist ID (empty string for root)
        rb_tracks: Tracks to add

    Returns:
        Tuple of (DjmdPlaylist object, was_created: bool)
    """
    # Find existing playlist
    existing = find_playlist_by_name_and_parent(rb_db, name, parent_id)

    if existing:
        # Update existing playlist
        update_playlist_tracks(rb_db, existing, rb_tracks)
        return existing, False
    else:
        # Create new playlist using high-level API
        # This handles all the complex fields automatically
        playlist = rb_db.create_playlist(name=name)

        # Set ParentID if not root
        if parent_id:
            playlist.ParentID = parent_id

        # Add tracks
        for track in rb_tracks:
            rb_db.add_to_playlist(playlist, track)

        return playlist, True
