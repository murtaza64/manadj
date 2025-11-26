"""Examples of working with playlists and their tracks."""

from pathlib import Path
from enginedj import EngineDJDatabase, Playlist, PlaylistEntity, Track

# Use local copy in project folder
db_path = Path(__file__).parent.parent / "Engine Library" / "Database2"
db = EngineDJDatabase(db_path)


def get_playlist_tracks(playlist_id: int):
    """Get all tracks in a playlist."""
    with db.session_m() as session:
        # Get playlist
        playlist = session.query(Playlist).filter(Playlist.id == playlist_id).first()
        if not playlist:
            return []

        # Get entities - note: linked list via nextEntityId
        # For simplicity, just get all and return
        entities = session.query(PlaylistEntity).filter(
            PlaylistEntity.listId == playlist_id
        ).all()

        # Get tracks
        track_ids = [e.trackId for e in entities if e.trackId]
        tracks = session.query(Track).filter(Track.id.in_(track_ids)).all()

        return tracks


# Example usage
print("Tracks in playlist 22:")
tracks = get_playlist_tracks(22)
for track in tracks:
    print(f"{track.artist} - {track.title}")
