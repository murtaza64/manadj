# Download one Source Item end-to-end

Status: ready-for-agent

## Parent

`.scratch/soundcloud-acquisition/PRD.md`

## What to build

Queueing a Source Item downloads it and lands it in the library. Two pieces:

**Task system (ADR-0003)**: generic task rows in the app DB (type, payload, state pending/running/done/failed, error, timestamps), in-process worker in the FastAPI app, startup recovery of interrupted `running` tasks. Built generic; the download task is its first consumer.

**Download chain**: the Source interface's download operation (yt-dlp as a library, OAuth from config) fetches audio to the tracks directory, named `Artist - Title.ext` from rule-based Cleanup (junk-token stripping per config patterns, `Artist - Title` splitting, uploader-as-artist fallback). Filename collision fails the task for manual resolution. The file then flows through the normal Disk Import path; the resulting Track records the Source Correspondence and Audio Provenance (source, SoundCloud ID, timestamp), the Source Item becomes `fulfilled`, and the Track starts as an Unprocessed track.

UI: queue action per Source Item; per-item status on the row (queued/running/done/failed with error); the new Track appears in the Library view.

## Acceptance criteria

- [x] Queueing a Source Item from the UI produces a persisted task; the worker downloads and completes the chain
- [x] New Track has Cleanup-applied title/artist, duration, Correspondence, Provenance; Source Item is `fulfilled`
- [x] Track creation goes through the normal Disk Import path (no parallel code path)
- [x] Filename collision fails the task with a visible error
- [x] Tasks survive restart; interrupted `running` tasks recovered on startup
- [x] Task system tested via its module interface with a synchronous run-pending entry point; download chain tested with the fake source copying audio fixtures; Cleanup rules unit-tested; heavy-dep guard stays green

## Blocked by

- 04-source-correspondence.md
