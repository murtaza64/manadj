"""Example of creating a playlist with random tracks."""

from pathlib import Path
import random
import time
from enginedj import EngineDJDatabase
from enginedj.models.track import Track
from enginedj.models.playlist import Playlist
from enginedj.models.playlist_entity import PlaylistEntity

# Initialize database
db_path = Path(__file__).parent.parent / "Engine Library" / "Database2"
db = EngineDJDatabase(db_path)

# Get 5 random tracks
with db.session_m() as session:
    all_tracks = session.query(Track).all()
    random_tracks = random.sample(all_tracks, min(5, len(all_tracks)))

print(f"Creating playlist with {len(random_tracks)} tracks:")
for track in random_tracks:
    print(f"  - {track.artist} - {track.title}")

# Create the playlist with unique title
timestamp = int(time.time())
playlist = db.create_playlist(
    title=f"Random Test Playlist {timestamp}",
    tracks=random_tracks
)

print(f"\nCreated playlist: {playlist.title} (ID: {playlist.id})")

# Verify it was created
with db.session_m() as session:
    created = session.query(Playlist).filter(Playlist.id == playlist.id).first()
    entities = session.query(PlaylistEntity).filter(
        PlaylistEntity.listId == playlist.id
    ).all()
    print(f"Verified: {len(entities)} tracks in playlist")
