# Sync Scripts Refactoring Plan

## STATUS: ✅ COMPLETE

All 5 phases of the refactoring have been completed successfully. The sync utilities have been reorganized into a clean, modular structure while maintaining 100% backward compatibility.

## Executive Summary

The manadj project had 9 sync-related scripts with logic scattered across `backend/sync.py` (648 lines) mixing Engine DJ and Rekordbox utilities. This refactoring successfully:
1. ✅ Enhanced existing `rekordbox/` module with sync utilities
2. ✅ Reorganized `backend/sync.py` into focused sub-modules
3. ✅ Extracted Engine DJ-specific logic to `enginedj/` module
4. ✅ Updated scripts to use new imports
5. ✅ Maintained full backward compatibility during migration

---

## Current Inventory

### Sync Scripts (9 total)

#### Engine DJ Scripts (4)
1. **sync_tracks_engine.py** - Bidirectional track sync manadj ↔ Engine DJ
2. **sync_keys_from_engine.py** - One-way sync Engine DJ → manadj keys
3. **sync_tags_to_engine.py** - One-way sync manadj tags → Engine DJ playlists
4. **import_playlists_from_engine.py** - Import Engine DJ playlists → manadj

#### Rekordbox Scripts (4)
5. **sync_tracks_rekordbox.py** - Bidirectional track sync manadj ↔ Rekordbox
6. **export_to_rekordbox_xml.py** - Export missing tracks → Rekordbox XML
7. **import_from_rekordbox.py** - Initial import Rekordbox → manadj
8. **import_energy_from_rekordbox_color.py** - Import energy from track colors

#### Cross-Platform Scripts (1)
9. **sync_rekordbox_mytags.py** - Sync Rekordbox MyTags → Engine DJ (deprecated)

### Current Problems

**backend/sync.py (648 lines) - BLOATED**
- Lines 12-58: Engine DJ track indexing/matching
- Lines 61-154: Engine DJ missing track functions
- Lines 156-258: Rekordbox XML creation
- Lines 260-288: Track preview formatting
- Lines 290-474: Engine DJ tag/playlist utilities
- Lines 476-648: Rekordbox track matching utilities

**Issues:**
- Mixes Engine DJ and Rekordbox logic
- No clear API boundaries
- Hard to find specific functionality
- Difficult to maintain and test

---

## Proposed Solution

### New Module Structure

```
manadj/
├── backend/
│   └── sync/                      # NEW: Common sync utilities
│       ├── __init__.py           # Re-exports for compatibility
│       ├── base.py               # Base classes, SyncStats
│       ├── matching.py           # Generic track matching
│       └── formats.py            # Track preview, conversions
│
├── enginedj/
│   ├── connection.py
│   ├── models/
│   ├── sync.py                   # NEW: Engine DJ sync utilities
│   └── playlist.py               # NEW: Playlist management
│
├── rekordbox/                     # ENHANCE existing module
│   ├── __init__.py
│   ├── (existing files...)
│   ├── sync.py                   # NEW: Sync utilities
│   └── xml.py                    # NEW: XML export
│
└── scripts/
    ├── (keep current locations for now)
```

### Code Distribution

#### backend/sync/ (Common Utilities)
- `base.py` - SyncStats dataclass, base classes
- `matching.py` - Generic track indexing/matching
- `formats.py` - format_track_preview(), conversions

#### enginedj/sync.py
Extract from backend/sync.py:
- `index_engine_tracks()`
- `match_track()`
- `find_missing_tracks_in_enginedj()`
- `find_missing_tracks_in_manadj()`

#### enginedj/playlist.py
Extract from backend/sync.py:
- `get_tracks_by_tag()`
- `find_playlist_by_title_and_parent()`
- `update_playlist_tracks()`
- `create_or_update_playlist()`

#### rekordbox/sync.py
Extract from backend/sync.py:
- `index_rekordbox_tracks()`
- `match_track_rekordbox()`
- `find_missing_tracks_in_rekordbox()`
- `find_missing_tracks_in_manadj_from_rekordbox()`
- `manadj_track_to_rekordbox_fields()`

#### rekordbox/xml.py
Extract from backend/sync.py:
- `manadj_track_to_rekordbox_xml_fields()`
- `create_rekordbox_xml_from_tracks()`

---

## Migration Strategy (5 Phases)

### Phase 1: Create New Modules ✅ COMPLETE
1. ✅ Created `backend/sync_common/` package
2. ✅ Created `enginedj/sync.py` and `enginedj/playlist.py`
3. ✅ Enhanced `rekordbox/` with sync.py and xml.py
4. ✅ Extracted and moved code to new locations

### Phase 2: Update backend/sync.py ✅ COMPLETE
✅ Converted to compatibility layer that re-exports everything

### Phase 3: Update Scripts ✅ COMPLETE
✅ Updated 4 scripts to use new module imports:
- sync_tracks_engine.py
- sync_tags_to_engine.py
- sync_tracks_rekordbox.py
- export_to_rekordbox_xml.py

### Phase 4: Testing ✅ COMPLETE
✅ All scripts import successfully
✅ Backward compatibility verified

### Phase 5: Documentation ✅ COMPLETE
✅ Updated refactoring plan

---

## Import Patterns

**Before:**
```python
from backend.sync import find_missing_tracks_in_enginedj
```

**After:**
```python
from enginedj.sync import find_missing_tracks_in_enginedj
from rekordbox.sync import find_missing_tracks_in_rekordbox
from backend.sync.formats import format_track_preview
```

---

## Benefits

- **Clear separation** - Engine DJ vs Rekordbox vs common
- **Better testing** - Smaller, focused modules
- **Extensibility** - Easy to add new sync targets
- **Code reduction** - ~200-300 lines through deduplication
- **Maintainability** - Changes localized to specific modules

---

## Final Module Structure

### backend/sync_common/ (Common utilities)
```
backend/sync_common/
├── __init__.py          # Re-exports SyncStats, format_track_preview
├── base.py              # SyncStats dataclass
├── formats.py           # format_track_preview()
└── matching.py          # Generic track matching with TypeVar
```

### enginedj/ (Engine DJ specific)
```
enginedj/
├── sync.py              # Track indexing, matching, missing track detection
│   ├── index_engine_tracks()
│   ├── match_track()
│   ├── find_missing_tracks_in_enginedj()
│   └── find_missing_tracks_in_manadj()
└── playlist.py          # Playlist management
    ├── get_tracks_by_tag()
    ├── find_playlist_by_title_and_parent()
    ├── update_playlist_tracks()
    └── create_or_update_playlist()
```

### rekordbox/ (Rekordbox specific)
```
rekordbox/
├── sync.py              # Database sync utilities
│   ├── index_rekordbox_tracks()
│   ├── match_track_rekordbox()
│   ├── find_missing_tracks_in_rekordbox()
│   ├── find_missing_tracks_in_manadj_from_rekordbox()
│   └── manadj_track_to_rekordbox_fields()
└── xml.py               # XML export utilities
    ├── manadj_track_to_rekordbox_xml_fields()
    └── create_rekordbox_xml_from_tracks()
```

### backend/sync.py (Backward compatibility layer)
Re-exports all functions from the new modules to maintain backward compatibility with existing code.

---

## Migration Notes

### Scripts Updated
Four scripts were updated to use the new import paths:
1. `scripts/sync_tracks_engine.py` - Now imports from `enginedj.sync` and `backend.sync_common.formats`
2. `scripts/sync_tags_to_engine.py` - Now imports from `enginedj.sync` and `enginedj.playlist`
3. `scripts/sync_tracks_rekordbox.py` - Now imports from `rekordbox.sync` and `backend.sync_common.formats`
4. `scripts/export_to_rekordbox_xml.py` - Now imports from `enginedj.sync`, `rekordbox.xml`, and `backend.sync_common.formats`

### Scripts Unchanged
Five scripts did not require updates (no `backend.sync` imports):
- `scripts/sync_keys_from_engine.py`
- `scripts/import_playlists_from_engine.py`
- `scripts/import_from_rekordbox.py`
- `scripts/import_energy_from_rekordbox_color.py`
- `scripts/sync_rekordbox_mytags.py`

### Backward Compatibility
All existing code that imports from `backend.sync` continues to work without modification. The `backend/sync.py` module now acts as a compatibility layer that re-exports all functions from their new locations.
