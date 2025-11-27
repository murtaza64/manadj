"""Engine DJ playlist reader."""

from pathlib import Path

from enginedj.connection import EngineDJDatabase
from enginedj.models.playlist import Playlist
from enginedj.models.playlist_entity import PlaylistEntity
from enginedj.models.track import Track
from backend.playlists.models import PlaylistInfo, TrackReference


class EnginePlaylistReader:
    """Read-only Engine DJ playlist queries.

    Handles hierarchical playlist structure and linked-list track ordering.
    """

    def __init__(self, engine_db: EngineDJDatabase):
        """Initialize with Engine DJ database connection.

        Args:
            engine_db: EngineDJDatabase instance
        """
        self.db = engine_db

    def get_all_playlists(self) -> list[PlaylistInfo]:
        """Load all playlists from Engine DJ with hierarchy flattened.

        Filters out root folders, system playlists, and non-persisted playlists.
        Flattens hierarchy into "Parent > Child" format for manadj compatibility.

        Returns:
            List of PlaylistInfo objects with flattened names
        """
        with self.db.session_m() as session:
            # Query all playlists
            playlists = session.query(Playlist).all()

            result = []
            for playlist in playlists:
                # Skip system playlists or empty names
                if not playlist.title or playlist.title.startswith('_'):
                    continue

                # Skip non-persisted (invisible) playlists
                if not playlist.isPersisted:
                    continue

                # Get flattened hierarchy name
                name = self.flatten_hierarchy_name(playlist.id)

                # Filter out playlists under "manadj Tags" hierarchy
                if name.startswith('manadj Tags'):
                    continue

                # Get tracks
                tracks = self.get_playlist_tracks(playlist.id)

                # Parse hierarchy parts from name
                hierarchy_parts = name.split(' > ') if ' > ' in name else [name]

                result.append(PlaylistInfo(
                    name=name,
                    tracks=tracks,
                    source='engine',
                    source_id=playlist.id,
                    hierarchy_parts=hierarchy_parts if len(hierarchy_parts) > 1 else None,
                    last_modified=None,  # Engine DJ uses Unix timestamps, convert if needed
                    color=None  # Engine DJ playlists don't have colors
                ))

            return result

    def get_playlist_tracks(self, playlist_id: int) -> list[TrackReference]:
        """Get ordered tracks for a playlist.

        Traverses the PlaylistEntity linked list (nextEntityId) to maintain
        correct track ordering.

        Args:
            playlist_id: Engine DJ playlist ID

        Returns:
            List of TrackReference objects in playlist order
        """
        with self.db.session_m() as session:
            # Get all playlist entities for this playlist
            entities = (
                session.query(PlaylistEntity)
                .filter_by(listId=playlist_id)
                .all()
            )

            if not entities:
                return []

            # Build linked list traversal map
            entity_by_id = {e.id: e for e in entities}
            entity_by_next = {e.nextEntityId: e for e in entities if e.nextEntityId}

            # Find first entity (one with no predecessor)
            first_entity = None
            for entity in entities:
                if entity.id not in entity_by_next:
                    first_entity = entity
                    break

            if not first_entity:
                # Fallback: just use entities as-is if linked list is broken
                first_entity = entities[0]

            # Traverse linked list
            ordered_entities = []
            current = first_entity
            visited = set()
            while current and current.id not in visited:
                visited.add(current.id)
                ordered_entities.append(current)

                # Find next entity
                if current.nextEntityId and current.nextEntityId in entity_by_id:
                    current = entity_by_id[current.nextEntityId]
                else:
                    break

            # Convert to TrackReference objects
            result = []
            for entity in ordered_entities:
                track = session.query(Track).filter_by(id=entity.trackId).first()
                if track and track.path:
                    result.append(TrackReference(
                        path=track.path,
                        filename=Path(track.filename or track.path).name,
                        title=track.title,
                        artist=track.artist,
                        track_id=entity.trackId
                    ))

            return result

    def flatten_hierarchy_name(self, playlist_id: int) -> str:
        """Build flattened name by traversing parent chain.

        Reuses existing get_playlist_hierarchy_name() from connection module.

        Args:
            playlist_id: Engine DJ playlist ID

        Returns:
            Flattened name like "Parent > Child > Playlist"
        """
        return self.db.get_playlist_hierarchy_name(playlist_id)
