"""Remote mirror prototype (synthetic fixtures only).

Pure functions: no network, no desktop DB access. Given a device-sync style
snapshot (Track.filename is an absolute path on the desktop), plan how a
remote COPY of the library would be built:

- rewrite each absolute path to a root-relative, normalized key under the
  remote library root (never an absolute or escaping path),
- build a content-addressed upload plan (sha256 + size) so re-runs are
  idempotent and a changed file at the same key is detected, not skipped,
- report tracks whose audio is missing or outside every configured root.

The local library is never modified. Nothing here talks to a remote.
"""
from __future__ import annotations

import hashlib
import ntpath
import posixpath
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath, PureWindowsPath


class PathRejected(ValueError):
    pass


def _parts(path: str) -> tuple[str, list[str]]:
    """(anchor-style, parts) for a posix or Windows absolute path."""
    if ntpath.splitdrive(path)[0] or "\\" in path:
        p = PureWindowsPath(path)
        if not p.is_absolute():
            raise PathRejected(f"not absolute: {path!r}")
        drive = p.drive.rstrip(":\\/").lower()
        return "win:" + drive, list(p.parts[1:])
    p = PurePosixPath(path)
    if not p.is_absolute():
        raise PathRejected(f"not absolute: {path!r}")
    return "posix", list(p.parts[1:])


def relative_key(filename: str, roots: list[str]) -> str:
    """Root-relative key for an absolute desktop path, using the longest
    matching configured root. Case-insensitive for Windows drives."""
    anchor, parts = _parts(filename)
    best: tuple[int, list[str]] | None = None
    for root in roots:
        r_anchor, r_parts = _parts(root)
        if r_anchor != anchor:
            continue
        n = len(r_parts)
        cmp = (lambda a, b: a.lower() == b.lower()) if anchor.startswith("win") else (lambda a, b: a == b)
        if len(parts) > n and all(cmp(a, b) for a, b in zip(parts[:n], r_parts)):
            if best is None or n > best[0]:
                best = (n, parts[n:])
    if best is None:
        raise PathRejected(f"outside configured roots: {filename!r}")
    rel = best[1]
    if any(p in ("", ".", "..") for p in rel):
        raise PathRejected(f"unsafe segment in {filename!r}")
    if any("\x00" in p for p in rel):
        raise PathRejected("NUL in path")
    return posixpath.join(*rel)


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while block := f.read(chunk):
            h.update(block)
    return h.hexdigest()


@dataclass
class Plan:
    snapshot: dict
    uploads: list[dict] = field(default_factory=list)   # key, sha256, size, track_ids
    unchanged: list[str] = field(default_factory=list)
    changed: list[str] = field(default_factory=list)    # same key, different content
    missing: list[dict] = field(default_factory=list)   # track_id, reason
    collisions: list[str] = field(default_factory=list)

    @property
    def upload_bytes(self) -> int:
        return sum(u["size"] for u in self.uploads)


def build_plan(snapshot: dict, roots: list[str], remote_index: dict[str, str] | None = None,
               resolve=lambda p: Path(p)) -> Plan:
    """remote_index: key -> sha256 already on the remote (empty on first run).
    resolve maps the desktop path to a readable local Path (tests inject a
    fixture directory; the real caller uses the identity)."""
    remote_index = remote_index or {}
    out = dict(snapshot)
    tracks = []
    plan = Plan(snapshot=out)
    seen: dict[str, tuple[str, str]] = {}  # casefolded key -> (exact key, sha)
    by_key: dict[str, dict] = {}
    for t in snapshot.get("tracks", []):
        t = dict(t)
        fn = t.get("filename")
        try:
            key = relative_key(fn, roots)
        except PathRejected as e:
            plan.missing.append({"track_id": t["id"], "reason": str(e)})
            t["remote_key"] = None
            tracks.append(t)
            continue
        local = resolve(fn)
        # Per-file failures never abort the report: an unreadable, vanished or
        # mid-write file becomes an attention row, not a 500. A file that is
        # not there (or not a regular file) is "missing"; one that is there
        # but cannot be read is "unreadable"; either can strike at the first
        # stat, at the hash, or at the confirming stat.
        def problem(reason: str) -> None:
            plan.missing.append({"track_id": t["id"], "reason": reason})
            t["remote_key"] = None
            tracks.append(t)

        try:
            before = local.stat()
            is_file = local.is_file()
        except FileNotFoundError:
            problem("audio file missing")
            continue
        except OSError as e:
            problem(f"audio file unreadable: {e.strerror or e}")
            continue
        if not is_file:
            problem("audio file missing")
            continue
        try:
            digest = sha256_file(local)
            after = local.stat()
        except FileNotFoundError:
            problem("audio file missing")
            continue
        except OSError as e:
            problem(f"audio file unreadable: {e.strerror or e}")
            continue
        # The digest is only meaningful for the bytes as stat'ed. If the file
        # changed while hashing, the upload entry would pair a stale size with
        # a digest of mixed bytes - report it for a re-run instead.
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            problem("file changed while scanning - re-run the preview")
            continue
        # Remote storage may be case-insensitive (Windows/macOS hosts, some
        # object-store gateways), so keys are compared casefolded. Fail closed:
        # two DIFFERENT spellings of a key collide whether or not the bytes are
        # identical; the first track keeps its key, later ones are reported.
        # The same exact key (several tracks, one file) is still uploaded once.
        lk = key.casefold()
        if lk in seen and (seen[lk][0] != key or seen[lk][1] != digest):
            plan.collisions.append(key)
            plan.missing.append({"track_id": t["id"], "reason": "case-insensitive key collision with " + repr(seen[lk][0])})
            t["remote_key"] = None
            tracks.append(t)
            continue
        seen[lk] = (key, digest)
        t["remote_key"] = key
        t["audio_sha256"] = digest
        t["audio_size"] = after.st_size
        t.pop("filename", None)  # the remote copy never learns desktop paths
        tracks.append(t)
        if key in by_key:
            by_key[key]["track_ids"].append(t["id"])
            continue
        entry = {"key": key, "sha256": digest, "size": t["audio_size"], "track_ids": [t["id"]]}
        by_key[key] = entry
        have = remote_index.get(key)
        if have == digest:
            plan.unchanged.append(key)
        else:
            if have is not None:
                plan.changed.append(key)
            plan.uploads.append(entry)
    out["tracks"] = tracks
    return plan
