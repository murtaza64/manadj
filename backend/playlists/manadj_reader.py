"""manadj playlist reader."""

from sqlalchemy.orm import Session
from pathlib import Path

from backend.models import Playlist, PlaylistTrack, Track
from .models import PlaylistInfo, TrackReference


class ManAdjPlaylistReader:
    """Read-only manadj playlist queries.

    Simplest reader since manadj has flat playlist structure.
    """

    def __init__(self, session: Session):
        """Initialize with manadj database session.

        Args:
            session: SQLAlchemy session for manadj database
        """
        self.session = session

    def get_all_playlists(self) -> list[PlaylistInfo]:
        """Load all playlists from manadj (already flat structure).

        Returns:
            List of PlaylistInfo objects ordered by display_order
        """
        playlists = self.session.query(Playlist).order_by(Playlist.display_order).all()

        result = []
        for playlist in playlists:
            tracks = self.get_playlist_tracks(playlist.id)
            result.append(PlaylistInfo(
                name=playlist.name,
                tracks=tracks,
                source='manadj',
                source_id=playlist.id,
                hierarchy_parts=None,  # manadj is flat
                last_modified=playlist.updated_at,
                color=playlist.color
            ))

        return result

    def get_playlist_tracks(self, playlist_id: int) -> list[TrackReference]:
        """Get ordered tracks for a playlist.

        Args:
            playlist_id: manadj playlist ID

        Returns:
            List of TrackReference objects ordered by position
        """
        playlist_tracks = (
            self.session.query(PlaylistTrack)
            .filter_by(playlist_id=playlist_id)
            .order_by(PlaylistTrack.position)
            .all()
        )

        result = []
        for pt in playlist_tracks:
            track = self.session.query(Track).filter_by(id=pt.track_id).first()
            if track:
                result.append(TrackReference(
                    path=track.filename,  # Already absolute path
                    filename=Path(track.filename).name,
                    title=track.title,
                    artist=track.artist,
                    track_id=pt.track_id
                ))

        return result
