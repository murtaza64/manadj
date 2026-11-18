# Remote mirror prototype (synthetic fixtures)

backend/mirror/plan.py: pure planner. Snapshot (device-sync shape, Track.filename absolute) in,
root-relative keys + sha256 content-addressed upload plan + missing/changed/collision report out.
Desktop paths are stripped from the remote snapshot. Input is never mutated. No network, no DB.

Tested (12 pytest cases): posix and Windows path rewrite, longest root, traversal/outside-root refusal,
missing audio, idempotent re-run, same-key-different-bytes detected, case collisions refused,
duplicate tracks uploaded once.

NOT done / runtime blockers: no uploader or receiving endpoint, no WAN auth (existing device-sync is
LAN pairing only), no real library or size, no storage target chosen (nothing provisioned), no
audio_rev/preview/waveform/stems handling, not wired into the app. Not production-ready.
