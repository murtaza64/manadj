# Replace generic "sync" naming in code with specific terms

Status: needs-triage

## Problem

Per CONTEXT.md, "Sync" is a broad colloquial/UI umbrella (Export, External Import, Disk Import, Acquisition). Code that uses generic "sync" naming (`backend/*/sync_manager.py`, `sync_common/`, `sync_tracks` endpoints, `SyncView`, top-level `sync/`) obscures which specific operation is meant.

## Idea

Going forward, name modules/functions/endpoints by the specific operation (export, external-import, disk-import, acquisition). Opportunistically rename existing modules; the UI tab may keep the broad "Sync" label.

## Notes

- Top-level `sync/` is legacy per ADR-0001 and may just be deleted instead of renamed.
