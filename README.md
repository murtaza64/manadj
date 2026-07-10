# manadj

A comprehensive music library management application for DJs with advanced harmonic mixing features, tag-based organization, and integration with professional DJ software.

> **Status:** Pre-alpha in active development. This project has no users other than the developer. Backward compatibility is not a concern.

## Overview

**manadj** is a web-based music library manager designed specifically for DJs. It provides intelligent track organization, harmonic mixing support, energy tracking, and seamless integration with Rekordbox and Engine DJ databases. The application features a modern React frontend with real-time waveform visualization and a FastAPI backend with comprehensive REST APIs.

## Features

### Core Features
- **Music Library Management** - Organize and manage your track collection with comprehensive metadata
- **Web-Based Player** - Full-featured audio player with seek controls and CUE functionality
- **Waveform Visualization** - 3-band frequency display (Low/Mid/High) with multiple rendering modes
- **Tag System** - Flexible tagging with categories, colors, and custom organization
- **Playlist Management** - Create and manage playlists with drag-and-drop track ordering
- **Advanced Filtering** - Multi-criteria filtering by tags (ANY/ALL), BPM range, key, and energy level

### DJ-Focused Features
- **Harmonic Mixing** - Circle of Fifths interface for finding compatible keys
- **Key Compatibility** - Automatic detection of harmonically compatible tracks (same key, ±1 semitone, relative major/minor)
- **Multi-Format Key Support** - Support for 6 key notation formats (Engine DJ, Musical, OpenKey, Camelot, Mixxx, Rekordbox)
- **BPM Matching** - Find tracks within configurable BPM threshold (±0-15%)
- **Energy Levels** - 5-point energy scale for building progressive DJ sets
- **Hot Cues** - 8 hot cue slots per track for quick reference points
- **CUE Point Preview** - Preview from CUE point with return-to-cue functionality
- **Find Related Tracks** - Discover mixable tracks based on key, BPM, tags, and energy

### Integration Features
- **Rekordbox Import** - Import tracks, MyTags, and playlists from Rekordbox database
- **Energy from Colors** - Map Rekordbox track colors to energy levels
- **Engine DJ Sync** - Sync key data from Engine DJ database with conflict resolution
- **Multiple Audio Formats** - Support for MP3, FLAC, M4A, WAV, and more

### Technical Features
- **REST API** - Comprehensive FastAPI backend with endpoints for tracks, tags, playlists, and waveforms
- **Real-Time Audio Analysis** - Automatic waveform generation with librosa
- **SQLite Database** - Fast, local database with SQLAlchemy ORM
- **React + TypeScript** - Modern frontend with type safety
- **Audio Streaming** - Efficient streaming of audio files to web player

## Architecture

```
manadj/
├── backend/              # FastAPI server
│   ├── main.py          # API server entry point
│   ├── models.py        # SQLAlchemy database models
│   ├── schemas.py       # Pydantic request/response schemas
│   ├── crud.py          # Database operations
│   ├── routers/         # API route handlers
│   │   ├── tracks.py
│   │   ├── tags.py
│   │   ├── playlists.py
│   │   └── waveforms.py
│   ├── waveform_utils.py # Waveform generation
│   ├── id3_utils.py     # Metadata extraction
│   └── key_utils.py     # Key format conversion
├── frontend/            # React application
│   └── src/
│       ├── components/  # React components
│       ├── api/         # API client
│       ├── contexts/    # React contexts
│       └── utils/       # Utility functions
├── scripts/             # Import and sync utilities
│   ├── import_from_rekordbox.py
│   ├── sync_keys_from_engine.py
│   └── import_energy_from_rekordbox_color.py
├── rekordbox/          # Rekordbox database reader
└── enginedj/           # Engine DJ database reader
```

## Requirements

### Backend
- Python 3.13+
- uv (Python package manager)
- Dependencies managed via `pyproject.toml`:
  - FastAPI, uvicorn (web server)
  - SQLAlchemy 2.0+ (ORM)
  - librosa, scipy, soundfile (audio analysis)
  - mutagen (ID3 metadata)
  - numpy, pillow (data processing)
  - pyrekordbox (Rekordbox integration)

### Frontend
- Node.js 18+ and npm
- Dependencies managed via `package.json`:
  - React 19 + TypeScript
  - Vite (build tool)
  - @tanstack/react-query (server state)

## Installation

### Backend Setup

```bash
# Install uv if not already installed
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install backend dependencies
uv sync

# Run database migrations (if needed)
uv run python backend/migrate_add_band_columns.py
```

### Frontend Setup

```bash
cd frontend
npm install
```

## Quick Start

### 1. Start the Backend Server

```bash
# From project root
uv run uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000`

### 2. Start the Frontend Dev Server

```bash
# In a separate terminal
cd frontend
npm run dev
```

The web UI will be available at `http://localhost:5173`

### 3. Import Your Music Library

```bash
# Import from Rekordbox
uv run python scripts/import_from_rekordbox.py

# Sync keys from Engine DJ
uv run python scripts/sync_keys_from_engine.py

# Import energy levels from Rekordbox colors
uv run python scripts/import_energy_from_rekordbox_color.py
```

## API Documentation

### Tracks API (`/api/tracks`)
- `GET /api/tracks/` - List tracks with filtering and pagination
  - Query params: `page`, `per_page`, `search`, `tag_ids`, `tag_match_mode`, `energy_min`, `energy_max`, `bpm_center`, `bpm_threshold_percent`, `key_camelot_ids`
- `GET /api/tracks/{track_id}` - Get single track
- `PATCH /api/tracks/{track_id}` - Update track metadata
- `GET /api/tracks/{track_id}/audio` - Stream audio file
- `POST /api/tracks/refresh-metadata` - Refresh ID3 tags

### Tags API (`/api/tags`)
- `GET /api/tags/categories` - List tag categories
- `GET /api/tags/categories/{category_id}/tags` - Get tags in category
- `POST /api/tags/categories` - Create tag category
- `GET /api/tags/` - List all tags
- `POST /api/tags/` - Create tag
- `PATCH /api/tags/{tag_id}` - Update tag
- `DELETE /api/tags/{tag_id}` - Delete tag
- `POST /api/tags/reorder` - Reorder tags

### Playlists API (`/api/playlists`)
- `GET /api/playlists/` - List playlists
- `GET /api/playlists/{playlist_id}` - Get playlist with tracks
- `POST /api/playlists/` - Create playlist
- `PATCH /api/playlists/{playlist_id}` - Update playlist
- `DELETE /api/playlists/{playlist_id}` - Delete playlist
- `POST /api/playlists/{playlist_id}/tracks` - Add track to playlist
- `DELETE /api/playlists/{playlist_id}/tracks/{playlist_track_id}` - Remove track
- `POST /api/playlists/{playlist_id}/reorder-tracks` - Reorder tracks
- `POST /api/playlists/reorder` - Reorder playlists

### Waveforms API (`/api/waveforms`)
- `GET /api/waveforms/{track_id}` - Get waveform data (generates on-demand)
- `PATCH /api/waveforms/{track_id}/cue-point` - Update CUE point

## Import & Sync Scripts

### Import from Rekordbox
```bash
uv run python scripts/import_from_rekordbox.py
```
Imports tracks and MyTags from your Rekordbox database. Creates tag categories (Genre, Vibe, Role) and associates tags with tracks.

### Sync Keys from Engine DJ
```bash
uv run python scripts/sync_keys_from_engine.py
```
Syncs key data from Engine DJ database. Includes interactive conflict resolution when keys differ.

### Import Energy from Rekordbox Colors
```bash
uv run python scripts/import_energy_from_rekordbox_color.py
```
Maps Rekordbox track colors to energy levels (1-5 scale).

### Other Utilities
- `scripts/fix_duplicate_tags.py` - Remove duplicate tags
- `scripts/invalidate_waveforms.py` - Force waveform regeneration
- `scripts/verify_key_mapping.py` - Verify key format conversions

## Key Format Support

manadj supports 6 different key notation formats used by popular DJ software:

| Format | Example Major | Example Minor | Used By |
|--------|--------------|---------------|---------|
| **Engine DJ** | 0-11 | 12-23 | Engine DJ, Internal |
| **Musical** | C, Db, D, etc. | Am, Bbm, Bm, etc. | Common notation |
| **OpenKey** | 1d-12d | 1m-12m | Mixed In Key |
| **Camelot** | 8B-7B | 8A-7A | Mixed In Key (wheel) |
| **Mixxx** | 1-12 | 13-24 | Mixxx DJ software |
| **Rekordbox** | C, Db, D, etc. | Cm, Dbm, Dm, etc. | Pioneer Rekordbox |

The application handles enharmonic equivalents (F# = Gb, C# = Db, etc.) and converts between all formats automatically.

## Configuration

### Audio Files Location
By default, the application expects audio files to be accessible from the filesystem. Update paths in your database or use absolute paths when importing.

### Database Location
The SQLite database is created as `backend/music.db` by default. You can configure this in `backend/main.py`.

### Rekordbox Database Path
Update the path in import scripts to point to your Rekordbox database:
```python
# Usually located at:
# macOS: ~/Library/Pioneer/rekordbox/master.db
# Windows: %APPDATA%\Pioneer\rekordbox\master.db
```

### Engine DJ Database Path
Update the path in sync scripts to point to your Engine DJ database:
```python
# Usually located at:
# macOS: ~/Music/Engine Library/Database2/m.db
# Windows: C:\Users\{username}\Music\Engine Library\Database2\m.db
```

### Soulseek Supplier (slskd)

The Soulseek Supplier fulfills unfulfilled Source Items from the Soulseek
network. manadj is a thin REST client; the actual Soulseek connection is a
local [slskd](https://github.com/slskd/slskd) daemon. The Supplier is opt-in:
if `slskd_url` / `SLSKD_API_KEY` are unset, it does not appear in the UI.

#### 1. manadj side (config)

`config.toml` (committed) — `[soulseek]` block:
```toml
[soulseek]
slskd_url = "http://localhost:5030"
```

`.env` (gitignored, repo root) — the slskd API key:
```
SLSKD_API_KEY=<same key slskd is started with>
```
Generate a key with `openssl rand -hex 24` (48 hex chars, within slskd's
16–255 range) and use the same value here and in slskd's launchd env below.
No `staging_dir` is configured: manadj reads completed file paths straight
from slskd's transfer API.

#### 2. slskd side (daemon, macOS, launchd-managed)

slskd is a self-contained distribution (binary + `wwwroot/` web UI; not in
Homebrew). Install the latest `osx-arm64` (or `osx-x64`) release under
`~/.local/opt/slskd` and manage it with launchd so it survives reboots
without losing peer-queue positions.

```bash
# Download + install (adjust VERSION / arch as needed)
VERSION=0.25.1
curl -L -o /tmp/slskd.zip \
  "https://github.com/slskd/slskd/releases/download/${VERSION}/slskd-${VERSION}-osx-arm64.zip"
mkdir -p ~/.local/opt/slskd ~/.local/share/slskd/downloads ~/.local/share/slskd/incomplete
unzip -o /tmp/slskd.zip -d ~/.local/opt/slskd
chmod +x ~/.local/opt/slskd/slskd
# macOS Gatekeeper: clear the quarantine flag on the unsigned binary
xattr -dr com.apple.quarantine ~/.local/opt/slskd
```

Minimal slskd config at `~/.local/share/slskd/slskd.yml` (Soulseek credentials
+ download dirs; the API key is passed via launchd env, below). Any unused
Soulseek username auto-registers on first connect. Note: on macOS slskd
defaults its app dir to `~/Library/Application Support/slskd`, so the launchd
plist pins `SLSKD_APP_DIR` to `~/.local/share/slskd` — the config file is only
read from the app dir:
```yaml
soulseek:
  username: <your soulseek username>
  password: <your soulseek password>
  listen_ip_address: 0.0.0.0
  listen_port: 50300
directories:
  downloads: /Users/<you>/.local/share/slskd/downloads
  incomplete: /Users/<you>/.local/share/slskd/incomplete
shares:
  directories: []   # supply-only; we share nothing back
web:
  https:
    disabled: true  # localhost-only; plain HTTP on 5030
```

launchd agent at `~/Library/LaunchAgents/org.slskd.slskd.plist`. The primary
API key is injected via `SLSKD_API_KEY` and must match `.env` above.
`WorkingDirectory` must be the install dir so the web UI (`wwwroot/`)
resolves:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>org.slskd.slskd</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/<you>/.local/opt/slskd/slskd</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/<you>/.local/opt/slskd</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SLSKD_APP_DIR</key><string>/Users/<you>/.local/share/slskd</string>
    <key>SLSKD_API_KEY</key><string><same key as .env></string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/<you>/.local/share/slskd/slskd.log</string>
  <key>StandardErrorPath</key><string>/Users/<you>/.local/share/slskd/slskd.err</string>
</dict>
</plist>
```

To restart after config edits: `launchctl kickstart -k gui/$(id -u)/org.slskd.slskd`.
Web UI at http://localhost:5030 (default login `slskd`/`slskd`).

Load it (survives reboot via `RunAtLoad`):
```bash
launchctl load -w ~/Library/LaunchAgents/org.slskd.slskd.plist
```

#### 3. Verify

REST API answers on localhost with the key, and a manual search returns
results (search endpoints accept any authenticated key):
```bash
# Health / auth: should return 200 and the app version
curl -s -H "X-API-Key: $SLSKD_API_KEY" http://localhost:5030/api/v0/application | head

# Kick off a search
curl -s -X POST http://localhost:5030/api/v0/searches \
  -H "X-API-Key: $SLSKD_API_KEY" -H "Content-Type: application/json" \
  -d '{"searchText": "aphex twin windowlicker"}'
# note the returned "id", then (after a few seconds) fetch responses:
curl -s -H "X-API-Key: $SLSKD_API_KEY" \
  http://localhost:5030/api/v0/searches/<id>/responses | head
```

A non-empty responses array confirms slskd is connected to the Soulseek
network and manadj's `[soulseek]` config points at a live daemon.

## Development

### Backend Development

```bash
# Install dev dependencies
uv sync

# Run type checking
uv run mypy backend/

# Run linting
uv run ruff check backend/
```

### Frontend Development

```bash
cd frontend

# Run dev server with hot reload
npm run dev

# Type check
npm run build

# Lint
npm run lint
```

### Adding Dependencies

```bash
# Backend
uv add package-name

# Frontend
cd frontend && npm install package-name
```

## Features Walkthrough

### Harmonic Mixing Workflow
1. Select a track in your library
2. Click the key filter button to open Circle of Fifths
3. Click on compatible keys (highlighted automatically)
4. View all harmonically compatible tracks
5. Sort by BPM or energy to find your next track

### Building Energy Progression
1. Filter tracks by starting energy level (e.g., energy 2)
2. Use "Find Related Tracks" modal
3. Set energy preset to "Up" for building energy
4. Set BPM threshold to ±6% for tempo matching
5. Enable harmonic key matching
6. View suggested tracks that match all criteria

### Tag-Based Organization
1. Open Tag Management modal
2. Create categories (Genre, Mood, Decade, etc.)
3. Add tags with custom colors
4. Assign tags to tracks in the editor panel
5. Filter tracks using tag combinations (ANY or ALL mode)

### Playlist Curation
1. Create a new playlist from the sidebar
2. Filter tracks using any combination of criteria
3. Drag and drop tracks into your playlist
4. Reorder tracks within the playlist
5. Export or sync to DJ software

## Troubleshooting

### Waveforms Not Displaying
Run the waveform invalidation script to regenerate:
```bash
uv run python scripts/invalidate_waveforms.py
```

### Audio Files Not Playing
Ensure audio file paths in the database are correct and accessible. Check file permissions.

### Import Scripts Failing
Verify database paths are correct for Rekordbox/Engine DJ. Check that databases are not locked by other applications.

### Key Conflicts During Sync
Use the interactive conflict resolution in `sync_keys_from_engine.py` to choose between local and Engine DJ keys.

## Limitations

- Currently single-user application (no authentication)
- No write support back to Rekordbox/Engine DJ databases
- Waveform generation can be slow for large libraries (cached after first generation)
- Limited to local file access (no cloud storage support)

## Future Enhancements

- Multi-user support with authentication
- Cloud storage integration
- Mobile-responsive UI
- Advanced waveform zoom and beat grid alignment
- Automatic BPM detection for tracks without tags
- Machine learning-based track similarity
- Export playlists to M3U/PLS formats
- Streaming integration (Beatport, SoundCloud)

## License

TBD

## Contributing

Contributions welcome! This is an active development project. Please ensure:
- Code passes type checking (`mypy` for Python, `tsc` for TypeScript)
- Follows existing code patterns
- Includes descriptive commit messages

Since this is pre-alpha with no users, breaking changes are acceptable.
