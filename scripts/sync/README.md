# Active Sync Scripts

This directory contains actively maintained sync scripts for ongoing data synchronization between manadj and DJ software platforms.

## Engine DJ Scripts

### engine_tracks.py
Bidirectional track synchronization between manadj and Engine DJ.

**Features:**
- Exports new tracks from manadj to Engine DJ
- Imports new tracks from Engine DJ to manadj
- Creates "Needs Analysis" playlist for unanalyzed tracks
- Dry-run mode for preview
- Skip import/export flags for one-way sync

**Usage:**
```bash
python scripts/sync/engine_tracks.py                         # Dry-run (both directions)
python scripts/sync/engine_tracks.py --apply                 # Apply changes
python scripts/sync/engine_tracks.py --apply --skip-import   # Only export to Engine DJ
python scripts/sync/engine_tracks.py --apply --skip-export   # Only import from Engine DJ
```

### engine_keys.py
One-way sync of musical keys from Engine DJ to manadj.

**Features:**
- Syncs analyzed keys from Engine DJ to manadj
- Interactive conflict resolution
- Dry-run mode

**Usage:**
```bash
python scripts/sync/engine_keys.py                # Dry-run
python scripts/sync/engine_keys.py --apply        # Apply changes
```

### engine_tags.py
One-way sync of manadj tags to Engine DJ playlists.

**Features:**
- Creates 3-level playlist hierarchy (Root → Categories → Tags)
- Updates existing playlists or creates new ones
- Fresh mode to recreate all playlists
- Dry-run mode

**Usage:**
```bash
python scripts/sync/engine_tags.py                # Dry-run
python scripts/sync/engine_tags.py --apply        # Apply changes
python scripts/sync/engine_tags.py --apply --fresh # Delete and recreate all
```

### engine_playlists.py
Import Engine DJ playlists into manadj via HTTP API.

**Features:**
- Interactive playlist selection
- Duplicate handling
- Confirmation prompts
- Dry-run mode

**Usage:**
```bash
python scripts/sync/engine_playlists.py           # Interactive mode
```

## Rekordbox Scripts

### rekordbox_tracks.py
Bidirectional track synchronization between manadj and Rekordbox.

**Features:**
- Exports new tracks from manadj to Rekordbox
- Imports new tracks from Rekordbox to manadj
- Dry-run mode
- Skip import/export flags

**Usage:**
```bash
python scripts/sync/rekordbox_tracks.py                # Dry-run
python scripts/sync/rekordbox_tracks.py --apply        # Apply changes
python scripts/sync/rekordbox_tracks.py --apply --skip-import
python scripts/sync/rekordbox_tracks.py --apply --skip-export
```

### rekordbox_export.py
Export manadj tracks to Rekordbox XML for Engine DJ import.

**Features:**
- Finds tracks in manadj but not in Engine DJ
- Exports to Rekordbox XML format
- Can be manually imported into Engine DJ
- Custom playlist naming

**Usage:**
```bash
python scripts/sync/rekordbox_export.py                              # Dry-run
python scripts/sync/rekordbox_export.py --apply                     # Generate XML
python scripts/sync/rekordbox_export.py --apply --output custom.xml
python scripts/sync/rekordbox_export.py --apply --playlist-name "Custom"
```

## Common Options

Most scripts support:
- `--help` - Show help message and available options
- `--apply` - Apply changes (without this, runs in dry-run mode)
- `--engine-db PATH` or `--rekordbox-db PATH` - Custom database paths

## Tips

1. **Always dry-run first:** Run without `--apply` to preview changes
2. **Backup databases:** Before first use, backup your Engine DJ and Rekordbox databases
3. **Close DJ software:** Ensure Engine DJ and Rekordbox are closed before running sync scripts
4. **Check output:** Review the script output for any errors or warnings
