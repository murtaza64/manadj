"""Basic usage examples for Engine DJ database access."""

from pathlib import Path
from enginedj import EngineDJDatabase, Track, Playlist

# Initialize database - use local copy in project folder
db_path = Path(__file__).parent.parent / "Engine Library" / "Database2"
db = EngineDJDatabase(db_path)

# Get database info
info = db.get_database_info()
print(f"Database UUID: {info.get('uuid')}")
print(f"Schema Version: {info.get('version')}")
print()

# Query all tracks
print("First 10 tracks:")
with db.session_m() as session:
    tracks = session.query(Track).limit(10).all()
    for track in tracks:
        print(f"{track.artist} - {track.title} ({track.bpm} BPM)")
print()

# Query playlists (root playlists have parentListId = 0 or NULL)
print("Root playlists:")
with db.session_m() as session:
    playlists = session.query(Playlist).filter(
        (Playlist.parentListId == 0) | (Playlist.parentListId == None)
    ).all()
    for playlist in playlists:
        print(f"Playlist: {playlist.title}")
