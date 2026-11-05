"""Frozen loaded-release metadata and durable acknowledgements; no DB/bootstrap."""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path

MAX_BODY_BYTES = 32768


def identity(version: str, source_revision: str, body: str) -> dict:
    fields = {
        "schema": 1, "version": version, "source_revision": source_revision,
        "notes_sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
    }
    release_id = hashlib.sha256(
        json.dumps(fields, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return {**fields, "release_id": release_id}


@dataclass(frozen=True)
class LoadedRelease:
    version: str
    source_revision: str
    release_id: str
    notes_sha256: str
    body: str

    def wire(self) -> dict:
        return {**identity(self.version, self.source_revision, self.body), "body": self.body}


def _read_json(path: Path, limit: int) -> dict:
    with path.open("rb") as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("release file too large")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise TypeError("expected object")
    return value


def load_release(directory: Path) -> LoadedRelease | None:
    """Snapshot only a complete, bounded, internally consistent cut-time pair."""
    try:
        build = _read_json(directory / "build-info.json", 4096)
        notes = _read_json(directory / "release-notes.json", MAX_BODY_BYTES * 6 + 4096)
        if type(build.get("schema")) is not int or type(notes.get("schema")) is not int:
            return None
        version, source, body = build["version"], build["source_revision"], notes["body"]
        if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?", version):
            return None
        if not isinstance(source, str) or not re.fullmatch(r"[0-9a-f]{40}", source):
            return None
        if not isinstance(body, str) or not body.strip() or len(body.encode("utf-8")) > MAX_BODY_BYTES:
            return None
        expected = identity(version, source, body)
        if build != expected or notes != {"schema": 1, "release_id": expected["release_id"], "body": body}:
            return None
        return LoadedRelease(version, source, expected["release_id"], expected["notes_sha256"], body)
    except (OSError, ValueError, KeyError, TypeError, UnicodeError):
        return None


class ReleaseNotes:
    def __init__(self, release: LoadedRelease | None, data_root: Path):
        self.release = release
        self.seen_dir = data_root / "data" / "release-seen"

    def current(self, expected_id: str) -> dict | None:
        release = self.release
        if release is None or release.release_id != expected_id:
            return None
        try:
            seen = _read_json(self.seen_dir / f"{release.release_id}.json", 1024) == {
                "schema": 1, "release_id": release.release_id,
            }
        except (OSError, ValueError, TypeError, UnicodeError):
            seen = False
        return {**release.wire(), "seen": seen}

    def acknowledge(self, release_id: str) -> None:
        if self.release is None or release_id != self.release.release_id:
            raise ValueError("release is not loaded")
        self.seen_dir.mkdir(parents=True, exist_ok=True)
        destination = self.seen_dir / f"{release_id}.json"
        fd, name = tempfile.mkstemp(prefix=".seen-", dir=self.seen_dir)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump({"schema": 1, "release_id": release_id}, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, destination)
            if os.name != "nt":
                directory_fd = os.open(self.seen_dir, os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
        finally:
            Path(name).unlink(missing_ok=True)
