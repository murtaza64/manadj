# One-Time Import Scripts

This directory contains scripts for initial data migration and one-time imports. These scripts are typically run once during initial setup or when migrating from another system.

## Scripts

### rekordbox_initial.py
Initial import of tracks and MyTags from Rekordbox database to manadj.

**Purpose:**
- First-time setup: Import your existing Rekordbox library into manadj
- One-time operation: After initial import, use sync scripts instead

**Features:**
- Imports tracks from Rekordbox database
- Imports Rekordbox MyTags as manadj tags
- Uses custom RekordboxReader class
- Handles track metadata (title, artist, BPM, key)

**Usage:**
```bash
python scripts/import/rekordbox_initial.py
```

**Notes:**
- This is a one-time operation for initial setup
- For ongoing sync, use `scripts/sync/rekordbox_tracks.py`
- Requires Rekordbox database path configuration

### rekordbox_energy.py
Import energy levels from Rekordbox track colors.

**Purpose:**
- Map Rekordbox track colors to manadj energy levels
- One-time operation to migrate color-based organization

**Features:**
- Color mapping:
  - Yellow → Energy level 1
  - Orange → Energy level 3
  - Red → Energy level 5
- Interactive mode with confirmation
- Dry-run mode

**Usage:**
```bash
python scripts/import/rekordbox_energy.py           # Dry-run
python scripts/import/rekordbox_energy.py --apply   # Apply changes
```

**Notes:**
- Run this after initial track import
- Only affects tracks with specific colors in Rekordbox
- This is a one-time migration script

## Workflow

Typical workflow for new manadj users coming from Rekordbox:

1. **Initial Setup:**
   ```bash
   python scripts/import/rekordbox_initial.py
   ```
   Import your Rekordbox library into manadj

2. **Import Energy Levels:**
   ```bash
   python scripts/import/rekordbox_energy.py --apply
   ```
   Migrate color-coded energy levels

3. **Ongoing Sync:**
   ```bash
   python scripts/sync/rekordbox_tracks.py --apply
   ```
   Use sync scripts for ongoing bidirectional synchronization

## Important Notes

- **One-time use:** These scripts are designed for initial setup, not ongoing sync
- **Backup first:** Always backup your manadj database before running import scripts
- **Check conflicts:** Review output for any conflicts or errors
- **Order matters:** Run rekordbox_initial.py before rekordbox_energy.py
- **Switch to sync:** After initial import, use scripts in `scripts/sync/` for ongoing updates
