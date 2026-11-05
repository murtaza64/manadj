"""SYNTHETIC #419 max-boundary embedded metadata (never publish; no APK). Core canonical() serialization:
json.dumps(sort_keys, compact, ensure_ascii). Body = 32768 x U+0001 (6 escaped bytes per body byte, worst case).
Regenerate: uv run tests/fixtures/android-release-maxbody-v1/generate.py
"""
import hashlib
import json
from pathlib import Path

OUT = Path(__file__).parent


def canonical(v):
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()


body = "\u0001" * 32768
version, source = "0.1.0-rc.8", "1" * 40
notes = hashlib.sha256(body.encode()).hexdigest()
rid = hashlib.sha256(canonical({"schema": 1, "version": version, "source_revision": source, "notes_sha256": notes})).hexdigest()
files = {
    "build-info.json": {"schema": 1, "version": version, "source_revision": source, "notes_sha256": notes, "release_id": rid},
    "release-notes.json": {"schema": 1, "release_id": rid, "body": body},
    "android-build.json": {"format": "manadj_android_build/v1", "release_id": rid, "package": "dev.murt.manadj.excalibur",
                           "version_code": 8, "version_name": version, "source_revision": source, "source_tree_sha256": "2" * 64,
                           "build_batch_id": "33333333-3333-4333-8333-333333333333", "notes_sha256": notes,
                           "min_sdk": 26, "target_sdk": 35, "abis": ["arm64-v8a"]},
}
for name, value in files.items():
    data = canonical(value)
    assert len(data) <= 256 * 1024, (name, len(data))
    (OUT / name).write_bytes(data)
