# manadj

Engine DJ database access library for Python.

## Overview

**manadj** provides read-only access to Engine DJ databases using SQLAlchemy 2.0+ ORM with modern type-safe patterns. This library allows you to query tracks, playlists, performance data, and DJ history from Engine DJ's SQLite databases.

## Features

- Read-only access to Engine DJ databases (m.db and hm.db)
- Modern SQLAlchemy 2.0+ patterns with full type hints
- Support for all core tables: Track, Playlist, AlbumArt, PerformanceData, History, and more
- Type-safe queries with mypy support
- Context manager-based session handling

## Requirements

- Python 3.11+
- SQLAlchemy 2.0+

## Installation

```bash
pip install -e .
```

## Quick Start

```python
from pathlib import Path
from enginedj import EngineDJDatabase, Track, Playlist

# Initialize database connection
db_path = Path.home() / "Music" / "Engine Library" / "Database2"
db = EngineDJDatabase(db_path)

# Get database info
info = db.get_database_info()
print(f"Database UUID: {info['uuid']}")
print(f"Schema Version: {info['version']}")

# Query tracks
with db.session_m() as session:
    tracks = session.query(Track).limit(10).all()
    for track in tracks:
        print(f"{track.artist} - {track.title} ({track.bpm} BPM)")

# Query playlists
with db.session_m() as session:
    playlists = session.query(Playlist).filter(
        Playlist.parentListId == None
    ).all()
    for playlist in playlists:
        print(f"Playlist: {playlist.title}")
```

## Database Structure

Engine DJ uses multiple SQLite databases:

- **m.db** - Main database containing tracks, playlists, performance data, and album art
- **hm.db** - History database with DJ session history
- **itm.db, rbm.db, sm.db, stm.db, trm.db** - Source-specific databases (iTunes, Rekordbox, Serato, TIDAL)

## Available Models

### Core Models
- `Information` - Database metadata and schema version
- `AlbumArt` - Album artwork with hash-based deduplication
- `Track` - Track metadata (42 columns including title, artist, BPM, key, etc.)
- `PerformanceData` - Analysis data (waveforms, beat grids, cues, loops as BLOBs)

### Playlist Models
- `Playlist` - Playlists with hierarchical structure
- `PlaylistEntity` - Links between playlists and tracks
- `Smartlist` - Dynamic playlists with rules

### Supporting Models
- `PreparelistEntity` - Track preparation queue
- `Pack` - Sync metadata
- `Historylist` - DJ session metadata (hm.db)
- `HistorylistEntity` - Tracks played in sessions (hm.db)

## Examples

See the `examples/` directory for more usage examples:

- `basic_query.py` - Basic database queries
- `playlist_operations.py` - Working with playlists and tracks

## Limitations

Current version is read-only with the following limitations:

1. **Read-only access** - No write support (enforced via PRAGMA query_only)
2. **Opaque BLOBs** - Performance data BLOBs are not decompressed
3. **Linked lists** - nextListId and nextEntityId require manual traversal
4. **Single database** - Cross-database track references not yet supported
5. **No trigger emulation** - Database triggers not enforced by SQLAlchemy

## Future Enhancements

- Write support with trigger emulation
- BLOB decompression and parsing (waveforms, beat grids, cues)
- Linked list navigation helpers
- Musical key enum/utilities (Camelot wheel)
- Cross-database track resolution
- Testing suite

## Development

Install development dependencies:

```bash
pip install -e ".[dev]"
```

Run type checking:

```bash
mypy enginedj
```

## License

TBD

## Contributing

Contributions welcome! Please ensure code passes type checking and follows the existing patterns.
