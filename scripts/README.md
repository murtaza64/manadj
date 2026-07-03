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
External Import scripts (track sync flows live in the API/SyncView):
- **engine_keys.py** - Sync keys from Engine DJ to manadj
- **engine_bpm.py** - Sync BPM from Engine DJ to manadj

### scripts/import/
One-time import scripts for initial data migration:
- **rekordbox_initial.py** - Initial import from Rekordbox database
- **rekordbox_energy.py** - Import energy levels from Rekordbox track colors

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
