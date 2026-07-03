# Import operation for Engine-only tracks

Status: needs-triage

## Problem

Tracks present only in Engine DJ (not on disk, not in Rekordbox) have no import path — the view shows "engine-only tracks have no import operation yet". Import needs more than a DB row: the audio file must be located/copied into the tracks directory.

## Notes

- Related: scripts/sync/engine_keys.py & engine_bpm.py import fields, not presence.
- File handling makes this bigger than the Rekordbox equivalent.
