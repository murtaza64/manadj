"""Rekordbox playlist reader."""

from pathlib import Path

from pyrekordbox.db6 import Rekordbox6Database
from pyrekordbox.db6.tables import DjmdPlaylist, DjmdSongPlaylist, DjmdContent
from backend.playlists.models import PlaylistInfo, TrackReference


class RekordboxPlaylistReader:
    """Read-only Rekordbox playlist queries.

    Handles hierarchical playlist structure using ParentID chains.
    """

    def __init__(self, rb_db: Rekordbox6Database):
        """Initialize with Rekordbox database connection.

        Args:
            rb_db: Rekordbox6Database instance
        """
        self.db = rb_db
        self.session = rb_db.session

    def get_all_playlists(self) -> list[PlaylistInfo]:
        """Load all playlists from Rekordbox with hierarchy flattened.

        Traverses ParentID chain to build hierarchical names in
        "Parent > Child" format for manadj compatibility.

        Returns:
            List of PlaylistInfo objects with flattened names
        """
        # Query all playlists
        playlists = self.session.query(DjmdPlaylist).all()

        result = []
        for playlist in playlists:
            # Skip system playlists or folders (attribute field might indicate this)
            if not playlist.Name:
                continue

            # Get flattened hierarchy name
            name = self.flatten_hierarchy_name(playlist.ID)

            # Get tracks
            tracks = self.get_playlist_tracks(playlist.ID)

            # Parse hierarchy parts from name
            hierarchy_parts = name.split(' > ') if ' > ' in name else [name]

            result.append(PlaylistInfo(
                name=name,
                tracks=tracks,
                source='rekordbox',
                source_id=playlist.ID,
                hierarchy_parts=hierarchy_parts if len(hierarchy_parts) > 1 else None,
                last_modified=None,  # DateCreated available if needed
                color=None  # Rekordbox playlists don't have colors in same way as manadj
            ))

        return result

    def get_playlist_tracks(self, playlist_id: str) -> list[TrackReference]:
        """Get ordered tracks for a playlist.

        Queries DjmdSongPlaylist and orders by TrackNo field.

        Args:
            playlist_id: Rekordbox playlist ID (string)

        Returns:
            List of TrackReference objects ordered by TrackNo
        """
        # Query playlist tracks
        song_playlists = (
            self.session.query(DjmdSongPlaylist)
            .filter_by(PlaylistID=playlist_id)
            .order_by(DjmdSongPlaylist.TrackNo)
            .all()
        )

        result = []
        for sp in song_playlists:
            # Get track content
            content = self.session.query(DjmdContent).filter_by(ID=sp.ContentID).first()
            if content and content.FolderPath:
                result.append(TrackReference(
                    path=content.FolderPath,
                    filename=Path(content.FolderPath).name,
                    title=content.Title,
                    artist=None,  # Artist is a relationship, would need join
                    track_id=sp.ContentID
                ))

        return result

    def flatten_hierarchy_name(self, playlist_id: str) -> str:
        """Build flattened name by traversing ParentID chain.

        Traverses from playlist up to root, building "Parent > Child" name.

        Args:
            playlist_id: Rekordbox playlist ID (string)

        Returns:
            Flattened name like "Parent > Child > Playlist"
        """
        # Build parent chain
        parts = []
        current_id = playlist_id
        visited = set()

        while current_id and current_id not in visited:
            visited.add(current_id)
            playlist = self.session.query(DjmdPlaylist).filter_by(ID=current_id).first()

            if not playlist:
                break

            # Add this playlist's name to the front
            if playlist.Name:
                parts.insert(0, playlist.Name)

            # Move to parent
            if playlist.ParentID and playlist.ParentID != '0':
                current_id = playlist.ParentID
            else:
                break  # Reached root

        return ' > '.join(parts) if parts else 'Unknown'
