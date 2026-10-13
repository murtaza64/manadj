#!/usr/bin/env -S uv run --script
"""Publish only the APK, usage page and build manifest to the existing review root."""
import hashlib
import json
import shutil
from pathlib import Path

source = Path(__file__).resolve().parent
destination = source.parents[1] / ".lane-tmp/public-review"
if not destination.is_dir():
    raise RuntimeError("Expected the existing restricted review directory")
apk = source / "app/build/outputs/apk/debug/app-debug.apk"
with apk.open("rb") as artifact:
    digest = hashlib.file_digest(artifact, "sha256").hexdigest()
shutil.copy2(apk, destination / "manadj-iteration3.apk")
shutil.copy2(source / "review.html", destination / "review.html")
(destination / "build.json").write_text(json.dumps({"version": "0.0.0-iteration3", "apk": "manadj-iteration3.apk", "sha256": digest}, indent=2) + "\n")
print(digest)
