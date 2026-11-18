# Remote mirror prototype (synthetic fixtures)

backend/mirror/plan.py: pure planner. Snapshot (device-sync shape, Track.filename absolute) in,
root-relative keys + sha256 content-addressed upload plan + missing/changed/collision report out.
Desktop paths are stripped from the remote snapshot. Input is never mutated. No network, no DB.

Tested (16 pytest cases): posix and Windows path rewrite, longest root, traversal/outside-root refusal,
missing audio, idempotent re-run, same-key-different-bytes detected, case-variant keys refused (casefolded, fail closed, identical or different bytes; first spelling keeps the key, the rest are reported as collisions),
duplicate tracks uploaded once.

NOT done / runtime blockers: no uploader or receiving endpoint, no WAN auth (existing device-sync is
LAN pairing only), no real library or size, no storage target chosen (nothing provisioned), no
audio_rev/preview/waveform/stems handling, not wired into the app. Not production-ready.


Key semantics: remote keys are root-relative with the desktop's original case, but uniqueness is checked casefolded so a case-insensitive remote cannot merge or overwrite two files. This reports a collision; it does not rename. Choosing a canonical form (rename vs. refuse) is left open.
