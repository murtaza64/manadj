# Retire the file-wins refresh-metadata operation

Status: needs-triage

## Problem

POST /api/tracks/refresh-metadata (track_metadata.refresh_from_files) overwrites Library title/artist/key/bpm from file tags — file wins, including overwriting with None. This contradicts the source-of-truth model (ADR-0001) and the curate-then-export workflow: manadj wins; Disk receives Exports; per-field Import covers exceptions (grill decision 2026-07-02).

## Idea

Remove the endpoint + refresh_from_files, or demote to an explicit maintenance CLI. Check for remaining frontend callers first.
