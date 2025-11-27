# Scripts Directory

This directory contains all sync and import scripts for the manadj project.

## Directory Structure

```
scripts/
├── sync/           # Active bidirectional sync scripts
├── import/         # One-time import/migration scripts
└── legacy/         # Deprecated scripts (not recommended for use)
```

## Organization

### scripts/sync/
Active, maintained sync scripts for ongoing data synchronization:
- **engine_tracks.py** - Bidirectional track sync with Engine DJ
- **engine_keys.py** - Sync keys from Engine DJ to manadj
- **engine_tags.py** - Sync manadj tags to Engine DJ playlists
- **engine_playlists.py** - Import Engine DJ playlists to manadj
- **rekordbox_tracks.py** - Bidirectional track sync with Rekordbox
- **rekordbox_export.py** - Export tracks to Rekordbox XML

### scripts/import/
One-time import scripts for initial data migration:
- **rekordbox_initial.py** - Initial import from Rekordbox database
- **rekordbox_energy.py** - Import energy levels from Rekordbox track colors

### scripts/legacy/
Deprecated scripts retained for reference:
- **sync_rekordbox_mytags.py** - Old Rekordbox MyTags sync (use engine_tags.py instead)

## Migration Notes

Scripts have been reorganized from their original flat structure. Deprecation stubs at the old locations redirect to the new locations for backward compatibility.

**Old locations (deprecated):**
- `scripts/sync_tracks_engine.py` → `scripts/sync/engine_tracks.py`
- `scripts/sync_keys_from_engine.py` → `scripts/sync/engine_keys.py`
- `scripts/sync_tags_to_engine.py` → `scripts/sync/engine_tags.py`
- `scripts/import_playlists_from_engine.py` → `scripts/sync/engine_playlists.py`
- `scripts/sync_tracks_rekordbox.py` → `scripts/sync/rekordbox_tracks.py`
- `scripts/export_to_rekordbox_xml.py` → `scripts/sync/rekordbox_export.py`
- `scripts/import_from_rekordbox.py` → `scripts/import/rekordbox_initial.py`
- `scripts/import_energy_from_rekordbox_color.py` → `scripts/import/rekordbox_energy.py`
- `scripts/sync_rekordbox_mytags.py` → `scripts/legacy/sync_rekordbox_mytags.py`

## Usage

All scripts support `--help` to see available options:

```bash
python scripts/sync/engine_tracks.py --help
```

Most sync scripts support dry-run mode:

```bash
python scripts/sync/engine_tracks.py           # Dry-run (preview changes)
python scripts/sync/engine_tracks.py --apply   # Apply changes
```
