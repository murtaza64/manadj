# Replace Audio flow

Status: needs-triage

## Problem

Replacing a track's audio with a better version (e.g. higher bitrate, mp3 → flac) currently requires deleting the manadj entry and rebuilding playlists/tags/cues by hand. Track identity is effectively file-path-bound.

## Idea

A first-class **Replace Audio** operation: point an existing Track at a new file, keeping its identity (tags, energy, playlist memberships, hot cues) intact.

- Re-run analysis (waveform, beatgrid); decide whether cues carry over (usually yes if it's the same recording).
- Same-path replacement (overwrite in place): external libraries see no identity change; next Export just refreshes analysis data.
- New-path replacement: next Export updates the external row in place if a Link exists (see 01-link-concept.md); otherwise delete + re-add downstream.

## Notes

- Blocked by: 01
- Requires that manadj internals never use path as a foreign key — audit for violations.
