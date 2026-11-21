"""External drive libraries: detect Rekordbox/Engine USB libraries and pull tracks in.

The pull flow is two-step by design (gh: in-app USB import):

1. ``build_pull_preview`` — read-only. Detects the device library, diffs it
   against the manadj library (Match semantics: full path, then basename,
   backend/sync_common/matching.py) and reports what *would* happen. Nothing
   on the drive or in the database is touched.
2. ``execute_pull`` — runs only after the UI shows that preview and the user
   confirms (the router refuses ``confirm != true``). The diff is recomputed
   at confirm time, copies go to temp files and land atomically, a failed
   commit removes the copied files, and the drive is never written to.

Safety rules for untrusted device data:

- Device-supplied paths are sanitized (no ``..``), resolved, and must stay
  inside the drive root (symlink escapes read as missing files).
- An existing destination file is only reused when its content hash matches
  the source; a different file under the same name (including a different-
  case name on a case-insensitive filesystem) is skipped with an error,
  never overwritten.
- A device track whose only match is the file's basename is treated as
  already owned only when a library file with that basename is
  content-verified against the device file (same size, then byte-identical
  sha256; every library candidate with that basename is tried). Unreadable
  or different content stays "uncertain" and out of the import: distinct
  audio can share a name.

Push (manadj -> drive) is deliberately not here: writing a manufacturer
device library is a separate feature with its own merge semantics and the
export gate (ADR 0043). The Engine writer exists as an experimental CLI
(scripts/engine_usb.py, #268); Rekordbox device writing is rekordbox/device.
"""

from __future__ import annotations

import getpass
import hashlib
import json
import logging
import os
import re
import shutil
import sqlite3
import string
import sys
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from backend.config import get_config
from backend.key import Key
from backend.models import Track
from backend.sync_common.matching import TrackIndex, path_key
from rekordbox.device.pdb_read import PdbTrack, read_pdb

log = logging.getLogger(__name__)

REKORDBOX_PDB = Path("PIONEER") / "rekordbox" / "export.pdb"
REKORDBOX_PDB_EXT = Path("PIONEER") / "rekordbox" / "exportExt.pdb"
ENGINE_DATABASE2 = Path("Engine Library") / "Database2"
ENGINE_MARKER = Path("Engine Library") / ".manadj-device-export"

# Extra scan locations for mounts outside the usual roots (tests, exotic
# setups): os.pathsep-separated absolute paths.
EXTRA_ROOTS_ENV = "MANADJ_MOUNT_ROOTS"


class ExternalDriveError(Exception):
    """A device library was found but could not be read."""


class PlanChangedError(ExternalDriveError):
    """The drive or library changed between the preview and the confirm."""


# --- detection ---------------------------------------------------------------


def mount_roots(
    platform: str | None = None,
    env: Mapping[str, str] | None = None,
) -> list[Path]:
    """Where mounted external volumes may live on this OS.

    macOS: /Volumes/*. Linux: /media/$USER/*, /run/media/$USER/*, /mnt/*.
    Windows: every drive letter that exists (fixed-disk letter scan — the
    same read-only existence check, no WMI). MANADJ_MOUNT_ROOTS adds roots
    on any OS.
    """
    platform = platform if platform is not None else sys.platform
    env = env if env is not None else os.environ
    roots: list[Path] = []
    if platform == "darwin":
        bases = [Path("/Volumes")]
    elif platform == "win32":
        bases = [Path(f"{letter}:/") for letter in string.ascii_uppercase]
    else:
        user = getpass.getuser()
        bases = [Path("/media") / user, Path("/run/media") / user, Path("/mnt")]
    candidates: list[Path] = []
    for base in bases:
        if platform == "win32":
            candidates.append(base)  # letters are roots themselves
        elif base.is_dir():
            try:
                candidates.extend(sorted(p for p in base.iterdir() if p.is_dir()))
            except OSError:
                continue
    extra = env.get(EXTRA_ROOTS_ENV)
    if extra:
        candidates.extend(Path(p) for p in extra.split(os.pathsep) if p)
    for candidate in candidates:
        try:
            if candidate.is_dir():
                roots.append(candidate)
        except OSError:
            continue
    return roots


@dataclass
class DetectedDrive:
    root: str
    kind: str  # "rekordbox" | "engine"
    name: str
    track_count: int | None
    written_by_manadj: bool = False


def _engine_track_count(database2: Path) -> int | None:
    m_db = database2 / "m.db"
    if not m_db.is_file():
        return None
    try:
        conn = sqlite3.connect(f"file:{m_db}?mode=ro", uri=True)
        try:
            row = conn.execute("SELECT COUNT(*) FROM Track").fetchone()
            return int(row[0]) if row else 0
        finally:
            conn.close()
    except sqlite3.Error:
        return None


def detect_drive_at(root: Path) -> DetectedDrive | None:
    """Identify a Rekordbox or Engine library at a mount root (read-only)."""
    if (root / REKORDBOX_PDB).is_file():
        track_count: int | None = None
        try:
            pdb = read_pdb(root / REKORDBOX_PDB)
            table = pdb.tables.get("tracks")
            track_count = len(table.rows) if table else 0
        except Exception:  # noqa: BLE001 — detection must not die on a bad pdb
            track_count = None  # unreadable pdb still reports as a Rekordbox drive
        return DetectedDrive(
            root=str(root), kind="rekordbox", name=root.name, track_count=track_count
        )
    if (root / ENGINE_DATABASE2).is_dir():
        return DetectedDrive(
            root=str(root),
            kind="engine",
            name=root.name,
            track_count=_engine_track_count(root / ENGINE_DATABASE2),
            written_by_manadj=(root / ENGINE_MARKER).is_file(),
        )
    return None


def detect_drives(roots: list[Path] | None = None) -> list[DetectedDrive]:
    """Scan mount roots for device libraries."""
    found: list[DetectedDrive] = []
    for root in roots if roots is not None else mount_roots():
        try:
            drive = detect_drive_at(root)
        except OSError:
            continue
        if drive is not None:
            found.append(drive)
    return found


# --- Rekordbox device read ---------------------------------------------------


@dataclass
class DevicePlaylist:
    id: int
    name: str | None
    parent_id: int
    sort_order: int
    is_folder: bool
    track_ids: list[int] = field(default_factory=list)  # entry_index order


@dataclass
class RekordboxDevice:
    tracks: list[PdbTrack]
    artists: dict[int, str]
    keys: dict[int, str]
    playlists: list[DevicePlaylist] = field(default_factory=list)


def read_rekordbox_device(root: Path) -> RekordboxDevice:
    pdb_path = root / REKORDBOX_PDB
    if not pdb_path.is_file():
        raise ExternalDriveError(f"no Rekordbox export at {pdb_path}")
    try:
        pdb = read_pdb(pdb_path)
    except Exception as exc:
        raise ExternalDriveError(f"could not parse {pdb_path}: {exc}") from exc

    tables = dict(pdb.tables)
    ext_path = root / REKORDBOX_PDB_EXT
    if ext_path.is_file():
        try:
            ext = read_pdb(ext_path)
            for name, table in ext.tables.items():
                tables.setdefault(name, table)
        except Exception:  # a bad exportExt must not kill the pull
            log.warning("could not parse %s", ext_path, exc_info=True)

    track_table = tables.get("tracks")

    def named(table_name: str) -> dict[int, str]:
        table = tables.get(table_name)
        if table is None:
            return {}
        return {row.id: row.name for row in table.rows if row.name}

    playlists: list[DevicePlaylist] = []
    tree_table = tables.get("playlist_tree")
    if tree_table is not None:
        by_playlist: dict[int, list[tuple[int, int]]] = {}
        entry_table = tables.get("playlist_entries")
        if entry_table is not None:
            for entry in entry_table.rows:
                by_playlist.setdefault(entry.playlist_id, []).append(
                    (entry.entry_index, entry.track_id)
                )
        for node in tree_table.rows:
            ordered = by_playlist.get(node.id, [])
            ordered.sort()
            playlists.append(
                DevicePlaylist(
                    id=node.id,
                    name=node.name,
                    parent_id=node.parent_id,
                    sort_order=node.sort_order,
                    is_folder=bool(node.is_folder),
                    track_ids=[track_id for _, track_id in ordered],
                )
            )

    return RekordboxDevice(
        tracks=list(track_table.rows) if track_table else [],
        artists=named("artists"),
        keys=named("keys"),
        playlists=playlists,
    )


# --- preview -----------------------------------------------------------------

# Entry statuses: "new" (importable), "present" (matched by full path, or
# content-verified under a same/renamed file name), "uncertain" (matched
# by file name or artist+title only — never imported automatically),
# "duplicate" (repeated file name on the drive), "missing-file".
STATUS_NEW = "new"
STATUS_PRESENT = "present"
STATUS_UNCERTAIN = "uncertain"
STATUS_DUPLICATE = "duplicate"
STATUS_MISSING = "missing-file"


@dataclass
class PullEntry:
    ordinal: int
    title: str | None
    artist: str | None
    bpm: float | None  # plain BPM, for display
    key: str | None  # musical name, for display
    duration_secs: float | None
    device_path: str
    status: str
    detail: str | None = None
    # Library file that content-verified as the same audio, when one did.
    # Lets the UI show the USB file name next to the library file name
    # instead of silently collapsing a renamed track into "present".
    matched_path: str | None = None


@dataclass
class PlaylistPreview:
    """One device playlist in the pull preview: where it sits in the folder
    tree and how its member tracks classify against the library. Membership
    changes (adds/removes/order) against a local playlist are NOT decided
    here; that diff needs an explicit local counterpart and stays part of
    the confirm flow."""
    id: int
    name: str | None
    folder_path: str  # parent folder chain, "" at root, e.g. "RIG" for RIG/RIG Mix
    sort_order: int
    track_count: int
    new_count: int
    present_count: int
    uncertain_count: int
    other_count: int  # duplicate/missing-file/unresolvable members
    # Member entry ordinals in device order. Lets a client bind its
    # reviewed plan to the exact ordered membership, so a same-count
    # reorder or replacement after review is caught before import.
    track_ordinals: list[int] = field(default_factory=list)
    # Dry-run membership comparison against the SUGGESTED local
    # counterpart (name-only; see PlaylistMembershipDiff). None when the
    # diff could not be computed.
    membership: "PlaylistMembershipDiff | None" = None
    # True when this playlist sits inside a device folder: the local
    # playlist model is flat and CANNOT represent the hierarchy. This is
    # surfaced as an explicit gap for the user/design to resolve; the
    # code must not auto-prefix names or silently drop the folder.
    folder_not_representable: bool = False
    # Typed folder chain (outermost first); folder_path is its "/" display form.
    folder_parts: list[str] = field(default_factory=list)


@dataclass
class PullPreview:
    root: str
    kind: str
    device_track_count: int
    new_count: int
    present_count: int
    uncertain_count: int
    duplicate_count: int
    missing_file_count: int
    default_destination: str | None
    fingerprint: str = ""
    source_fingerprint: str = ""
    entries: list[PullEntry] = field(default_factory=list)
    playlists: list[PlaylistPreview] = field(default_factory=list)


def default_destination() -> str | None:
    """Where pulls land: the configured library directory, if one is set."""
    return get_config().library.tracks_directory


def _manadj_matchers(
    manadj_session: Any,
) -> tuple[TrackIndex[Track], dict[str, list[Track]], dict[tuple[str, str], list[Track]]]:
    """Path/basename index plus basename and tag candidate maps.

    Import-side semantics (rekordbox/sync.py): every Track row counts,
    including Archived — an archived copy is still a copy we hold. The
    basename and tag maps keep ALL candidates per key, so content
    verification is not limited to whichever row the single-value index
    happened to keep.
    """
    rows = manadj_session.query(Track).all()
    index = TrackIndex.build(rows, lambda t: t.filename)
    by_basename: dict[str, list[Track]] = {}
    by_tags: dict[tuple[str, str], list[Track]] = {}
    for track in rows:
        if track.filename:
            by_basename.setdefault(_basename_key(track.filename), []).append(track)
        for tag_key in _tag_keys(track.title, track.artist):
            by_tags.setdefault(tag_key, []).append(track)
    return index, by_basename, by_tags


def _basename_key(path: str) -> str:
    return path_key(path).rsplit("/", 1)[-1]


_TRACKNUM_PREFIX = re.compile(r"^\d{1,3}[\s._\-]+")


def _clean_title(title: str) -> str:
    """Looser title form for candidate GENERATION only.

    Strips a leading playlist-position prefix ("005 Let Me Down" -> "let
    me down", the pattern a friend's playlist export leaves on copied
    files). Version and remix parentheses are kept: "(Aries Remix)" and
    "(Original Mix)" are different audio and must never collapse into
    one candidate. Content verification decides identity either way.
    """
    return _TRACKNUM_PREFIX.sub("", title).strip()


def _tag_keys(title: str | None, artist: str | None) -> list[tuple[str, str]]:
    """Normalized (title, artist) candidate keys, exact and cleaned.

    Whitespace-trimmed and case-folded, the same base normalization the
    field diagnostic used on the real library. Tags only GENERATE
    candidates; identity is always decided by file content, never by
    tag equality.
    """
    raw_title = (title or "").strip()
    norm_artist = (artist or "").strip().casefold()
    keys: list[tuple[str, str]] = []
    norm_title = raw_title.casefold()
    if norm_title or norm_artist:
        keys.append((norm_title, norm_artist))
    cleaned = _clean_title(raw_title).casefold()
    if cleaned and cleaned != norm_title:
        keys.append((cleaned, norm_artist))
    return keys


def _library_track_id(index: TrackIndex[Track], entry: PullEntry) -> int | None:
    """The library Track a content-verified present entry maps to."""
    if entry.status != STATUS_PRESENT:
        return None
    hit = index.by_path.get(path_key(entry.device_path))
    if hit is None and entry.matched_path:
        hit = index.by_path.get(path_key(entry.matched_path))
    return hit.id if hit is not None else None


def _match_status(index: TrackIndex[Track], device_path: str) -> str | None:
    """Full-path matches are certain; a bare file-name match is not."""
    key = path_key(device_path)
    if key in index.by_path:
        return STATUS_PRESENT
    if _basename_key(device_path) in index.by_filename:
        return STATUS_UNCERTAIN
    return None


def _sanitize_rel(device_path: str) -> list[str]:
    """Device-supplied relative path parts, free of . / .. / empties."""
    rel = device_path.replace("\\", "/").lstrip("/")
    return [p for p in rel.split("/") if p not in ("", ".", "..")]


def _device_rel_source(root: Path, device_path: str) -> Path | None:
    """The audio file a device path names, resolved inside the drive root.

    Device databases are untrusted input: normalize separators, drop
    anchors/parent traversal, resolve symlinks, and refuse anything that
    lands outside the drive.
    """
    parts = _sanitize_rel(device_path)
    if not parts:
        return None
    candidate = root.joinpath(*parts)
    try:
        resolved = candidate.resolve()
        root_resolved = root.resolve()
    except OSError:
        return None
    if resolved != root_resolved and root_resolved not in resolved.parents:
        return None
    return candidate


def _device_source(root: Path, kind: str, device_path: str) -> Path | None:
    """The readable audio file for a device path, resolved inside root."""
    if kind == "engine":
        from enginedj.paths import absolute_track_path

        resolved = absolute_track_path(device_path, root)
        source = Path(resolved) if resolved else None
        if source is not None:
            try:
                resolved_source = source.resolve()
                if resolved_source != root and root not in resolved_source.parents:
                    return None
            except OSError:
                return None
        return source
    return _device_rel_source(root, device_path)


def _plan_fingerprint(
    root: Path,
    kind: str,
    entries: list[PullEntry],
    destination: Path | None,
    playlists: list[DevicePlaylist] | None = None,
) -> str:
    """Binds a confirmed pull to exactly what the preview saw.

    Covers the drive root, format, the resolved destination when given,
    every entry's device path, classification and source file
    size/mtime, and the device playlist tree (folder structure plus
    ordered membership), so a changed drive OR a changed library OR a
    swapped destination OR a playlist edit produces a different
    fingerprint.

    Limitation: source identity here is size+mtime, not content. A
    device file replaced with the same size and mtime before the
    confirm is not detected at this layer; the copy re-stats and
    hash-compares what it lands, which covers the copy window only.
    """
    items: list[list[Any]] = []
    for entry in entries:
        sig: list[int] | None = None
        source = _device_source(root, kind, entry.device_path)
        if source is not None:
            try:
                stat = source.stat()
                sig = [stat.st_size, stat.st_mtime_ns]
            except OSError:
                sig = None
        items.append([entry.device_path, entry.status, entry.matched_path, sig])
    blob = json.dumps(
        {
            "root": str(root),
            "kind": kind,
            "destination": str(destination.resolve()) if destination is not None else None,
            "items": items,
            "playlists": [
                [pl.id, pl.name, pl.parent_id, pl.sort_order, pl.is_folder, pl.track_ids]
                for pl in playlists or []
            ],
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _verified_library_track(
    candidates: list[Track], source: Path | None
) -> Track | None:
    """Content-verified identity: byte-identical audio is already held.

    Returns the library track whose live file bytes equal the device
    file's, or None. Sizes must match before hashing (different sizes
    cannot be identical content); only equal-size candidates pay the
    hash. A missing or unreadable library file or device file just fails
    verification, so a failed read never upgrades a match. Hashes are
    computed fresh against the live files on every preview — nothing is
    cached, so a changed file can never match on stale content.
    """
    if source is None:
        return None
    try:
        if not source.is_file():
            return None
        source_size = source.stat().st_size
    except OSError:
        return None
    for track in candidates:
        if not track.filename:
            continue
        library_file = Path(track.filename)
        try:
            if not library_file.is_file() or library_file.stat().st_size != source_size:
                continue
            if _sha256(library_file) == _sha256(source):
                return track
        except OSError:
            continue
    return None


def _classify(
    index: TrackIndex[Track],
    by_basename: dict[str, list[Track]],
    by_tags: dict[tuple[str, str], list[Track]],
    seen: set[str],
    root: Path,
    kind: str,
    device_path: str,
    title: str | None = None,
    artist: str | None = None,
    verify: bool = True,
) -> tuple[str, str | None, str | None]:
    base = _basename_key(device_path)
    if base in seen:
        return STATUS_DUPLICATE, "same file name as another track on this drive", None
    seen.add(base)
    status = _match_status(index, device_path)
    if status == STATUS_PRESENT:
        return status, "already in the manadj library (same path)", None
    if status == STATUS_UNCERTAIN:
        # A device path can never equal a library path (the file lives on
        # the drive), so real duplicates land here. Upgrade to present only
        # on byte-identical content; anything unreadable or different keeps
        # the conservative name-only classification.
        source = _device_source(root, kind, device_path)
        verified = (
            _verified_library_track(by_basename.get(base, []), source)
            if verify
            else None
        )
        if verified is not None:
            return (
                STATUS_PRESENT,
                "already in the manadj library (same audio, content-verified)",
                verified.filename,
            )
        return (
            status,
            "a library track has this file name: verify it is the same audio",
            None,
        )
    source = _device_source(root, kind, device_path)
    if source is None or not source.is_file():
        return STATUS_MISSING, "audio file not found on the drive", None
    # Rename tier: no path or file-name match, but the library may hold
    # the same audio under a different file name. Tag equality generates
    # candidates only; content verification decides.
    tag_candidates: list[Track] = []
    seen_ids: set[int] = set()
    for tag_key in _tag_keys(title, artist):
        for candidate in by_tags.get(tag_key, []):
            if id(candidate) not in seen_ids:
                seen_ids.add(id(candidate))
                tag_candidates.append(candidate)
    if tag_candidates:
        verified = (
            _verified_library_track(tag_candidates, source) if verify else None
        )
        if verified is not None:
            return (
                STATUS_PRESENT,
                "already in the manadj library (same audio under a different "
                "file name, content-verified)",
                verified.filename,
            )
        return (
            STATUS_UNCERTAIN,
            "a library track has the same artist and title: verify it is "
            "the same audio",
            None,
        )
    return STATUS_NEW, None, None


def build_rekordbox_pull_preview(
    manadj_session: Any, root: Path, destination: Path | None = None,
    verify: bool = True,
) -> PullPreview:
    device = read_rekordbox_device(root)
    index, by_basename, by_tags = _manadj_matchers(manadj_session)

    entries: list[PullEntry] = []
    seen: set[str] = set()
    for i, track in enumerate(device.tracks):
        if not track.file_path:
            continue
        artist = device.artists.get(track.artist_id)
        status, detail, matched = _classify(
            index, by_basename, by_tags, seen, root, "rekordbox",
            track.file_path, track.title, artist, verify=verify,
        )
        entries.append(
            PullEntry(
                ordinal=i,
                title=track.title,
                artist=artist,
                bpm=track.tempo_centibpm / 100.0 if track.tempo_centibpm else None,
                key=device.keys.get(track.key_id),
                duration_secs=float(track.duration_secs) if track.duration_secs else None,
                device_path=track.file_path,
                status=status,
                detail=detail,
                matched_path=matched,
            )
        )

    preview = _preview(
        root, "rekordbox", len(device.tracks), entries, destination,
        device_playlists=device.playlists,
    )
    preview.playlists = _playlist_previews(device, entries)
    device_by_id = {pl.id: pl for pl in device.playlists}
    for rollup in preview.playlists:
        node = device_by_id.get(rollup.id)
        if node is None:
            continue
        try:
            rollup.membership = diff_device_playlist(
                manadj_session, device, node, entries,
                foldered=bool(rollup.folder_path),
            )
        except Exception:  # a local-db hiccup must not kill the pull preview
            log.warning("membership diff failed for playlist %s", node.id, exc_info=True)
    return preview


def _playlist_previews(
    device: RekordboxDevice, entries: list[PullEntry]
) -> list[PlaylistPreview]:
    """Per-playlist rollup of the classified pull entries, in tree order."""
    status_by_track_id = {
        device.tracks[e.ordinal].id: e.status
        for e in entries
        if 0 <= e.ordinal < len(device.tracks)
    }
    ordinal_by_track_id = {
        device.tracks[e.ordinal].id: e.ordinal
        for e in entries
        if 0 <= e.ordinal < len(device.tracks)
    }
    folders = {p.id: p for p in device.playlists if p.is_folder}

    def folder_parts(node: DevicePlaylist) -> list[str]:
        parts: list[str] = []
        parent = folders.get(node.parent_id)
        while parent is not None and len(parts) < 20:
            if parent.name:
                parts.append(parent.name)
            parent = folders.get(parent.parent_id)
        return list(reversed(parts))

    def folder_path(node: DevicePlaylist) -> str:
        return "/".join(folder_parts(node))

    out: list[PlaylistPreview] = []
    for node in sorted(device.playlists, key=lambda p: (p.parent_id, p.sort_order, p.id)):
        if node.is_folder:
            continue
        counts = {STATUS_NEW: 0, STATUS_PRESENT: 0, STATUS_UNCERTAIN: 0, "other": 0}
        for track_id in node.track_ids:
            status = status_by_track_id.get(track_id)
            if status in (STATUS_NEW, STATUS_PRESENT, STATUS_UNCERTAIN):
                counts[status] += 1
            else:
                counts["other"] += 1
        out.append(
            PlaylistPreview(
                id=node.id,
                name=node.name,
                folder_path=folder_path(node),
                sort_order=node.sort_order,
                track_count=len(node.track_ids),
                new_count=counts[STATUS_NEW],
                present_count=counts[STATUS_PRESENT],
                uncertain_count=counts[STATUS_UNCERTAIN],
                other_count=counts["other"],
                folder_not_representable=bool(folder_path(node)),
                folder_parts=folder_parts(node),
                track_ordinals=[
                    ordinal_by_track_id[tid]
                    for tid in node.track_ids
                    if tid in ordinal_by_track_id
                ],
            )
        )
    return out


def local_playlist_snapshot_token(
    playlist_id: int, name: str | None, track_ids: list[int]
) -> str:
    """Snapshot of a local playlist's name + ordered membership. The update
    flow binds the confirm to the reviewed target so an edit between review
    and confirm is rejected instead of silently overwritten."""
    ids = ",".join(str(t) for t in track_ids)
    return hashlib.sha256(f"playlist:{playlist_id}:{name}:{ids}".encode()).hexdigest()[:16]


@dataclass
class PlaylistMembershipDiff:
    """Dry-run membership comparison of one device playlist against a
    local counterpart. A name-matched local playlist SUGGESTS the
    counterpart only; it never binds. Uncertain device members are
    excluded from every count and listed separately, because their
    library identity is unverified."""

    device_playlist_id: int
    name: str | None
    counterpart_status: str  # "unique-name-match" | "no-local-playlist" | "ambiguous-name"
    counterpart_id: int | None
    common: int = 0
    adds_in_library: int = 0  # verified library tracks missing from the local playlist
    adds_new: int = 0  # device members with no verified library copy at all
    removes: int = 0  # local members with no verified device counterpart
    # True whenever any device member is unverified: an uncertain device
    # member COULD be one of the "removed" local tracks (identity
    # unproven), so every remove is then provisional, never a confirmed
    # removal. The UI must not show removes as settled while this is set.
    removes_provisional: bool = False
    uncertain_members: int = 0  # unverified device members, excluded everywhere
    order_differs: bool | None = None  # None when no unique counterpart
    # Snapshot of the suggested counterpart at review time; the confirm
    # carries it back and the update refuses a target that changed since.
    target_token: str | None = None
    # A device playlist inside a folder is only a CANDIDATE for a same-name
    # local playlist (the local model is flat, so the folder is not part of
    # the match). The candidate never becomes counterpart_id; pairing needs an
    # explicit user choice that names it, and the token still binds the target.
    candidate_id: int | None = None
    candidate_name: str | None = None


def diff_device_playlist(
    manadj_session: Any,
    device: RekordboxDevice,
    playlist: DevicePlaylist,
    entries: list[PullEntry],
    foldered: bool = False,
) -> PlaylistMembershipDiff:
    from backend.models import Playlist, PlaylistTrack

    index, _, _ = _manadj_matchers(manadj_session)
    entry_by_track_id = {
        device.tracks[e.ordinal].id: e
        for e in entries
        if 0 <= e.ordinal < len(device.tracks)
    }

    def library_track_id(entry: PullEntry) -> int | None:
        return _library_track_id(index, entry)

    device_member_ids: list[int] = []  # occurrence-tagged below
    adds_in_library = 0
    adds_new = 0
    uncertain = 0
    for track_id in playlist.track_ids:
        entry = entry_by_track_id.get(track_id)
        if entry is None:
            uncertain += 1  # pdb row with no classifiable entry
            continue
        if entry.status == STATUS_UNCERTAIN:
            uncertain += 1
            continue
        lib_id = library_track_id(entry)
        if lib_id is not None:
            device_member_ids.append(lib_id)
            continue
        if entry.status == STATUS_NEW:
            adds_new += 1
        else:
            uncertain += 1  # duplicate/missing-file: identity unusable

    counterparts = (
        manadj_session.query(Playlist).filter(Playlist.name == playlist.name).all()
        if playlist.name
        else []
    )
    diff = PlaylistMembershipDiff(
        device_playlist_id=playlist.id,
        name=playlist.name,
        counterpart_status=(
            ("candidate-name-match" if foldered else "unique-name-match")
            if len(counterparts) == 1
            else ("no-local-playlist" if not counterparts else "ambiguous-name")
        ),
        counterpart_id=counterparts[0].id if len(counterparts) == 1 and not foldered else None,
        candidate_id=counterparts[0].id if len(counterparts) == 1 and foldered else None,
        candidate_name=counterparts[0].name if len(counterparts) == 1 and foldered else None,
        adds_in_library=adds_in_library,
        adds_new=adds_new,
        uncertain_members=uncertain,
    )
    if len(counterparts) != 1:
        return diff

    local_rows = (
        manadj_session.query(PlaylistTrack)
        .filter(PlaylistTrack.playlist_id == counterparts[0].id)
        .order_by(PlaylistTrack.position)
        .all()
    )
    local_ids = [row.track_id for row in local_rows]
    diff.target_token = local_playlist_snapshot_token(
        counterparts[0].id, counterparts[0].name, local_ids
    )
    # Occurrence-tagged sets (order-pairing policy: k-th with k-th),
    # same documented heuristic as the smart-diff proposal.
    def occ(seq: list[int]) -> list[tuple[int, int]]:
        seen: dict[int, int] = {}
        out = []
        for x in seq:
            k = seen.get(x, 0)
            seen[x] = k + 1
            out.append((x, k))
        return out

    device_occ = occ(device_member_ids)
    local_occ = occ(local_ids)
    common_occ = set(device_occ) & set(local_occ)
    diff.common = len(common_occ)
    diff.adds_in_library = sum(1 for x in device_occ if x not in local_occ)
    diff.removes = sum(1 for x in local_occ if x not in device_occ)
    diff.removes_provisional = diff.removes > 0 and diff.uncertain_members > 0
    # Order comparison over common members only, each side in its own
    # order. A plain sequence compare: the smart-diff proposal (move and
    # block counts) is still a candidate, not an approved algorithm.
    device_common = [x for x in device_occ if x in common_occ]
    local_common = [x for x in local_occ if x in common_occ]
    diff.order_differs = device_common != local_common
    return diff


def build_engine_pull_preview(
    manadj_session: Any, root: Path, destination: Path | None = None,
    verify: bool = True,
) -> PullPreview:
    from enginedj.connection import EngineDJDatabase
    from enginedj.models.track import Track as EDJTrack

    database2 = root / ENGINE_DATABASE2
    if not database2.is_dir():
        raise ExternalDriveError(f"no Engine database at {database2}")
    try:
        engine_db = EngineDJDatabase(database2)
    except Exception as exc:
        raise ExternalDriveError(f"could not open {database2}: {exc}") from exc

    index, by_basename, by_tags = _manadj_matchers(manadj_session)
    entries: list[PullEntry] = []
    seen: set[str] = set()
    total = 0
    with engine_db.session_m() as edj:
        edj_tracks = edj.query(EDJTrack).all()
        total = len(edj_tracks)
        for i, track in enumerate(edj_tracks):
            if not track.path:
                continue
            stored = track.path
            key_name = None
            if track.key is not None:
                key_obj = Key.from_engine_id(track.key)
                key_name = key_obj.musical if key_obj else None
            bpm = track.bpmAnalyzed or (float(track.bpm) if track.bpm else None)
            status, detail, matched = _classify(
                index, by_basename, by_tags, seen, root, "engine",
                stored, track.title, track.artist, verify=verify,
            )
            entries.append(
                PullEntry(
                    ordinal=i,
                    title=track.title,
                    artist=track.artist,
                    bpm=bpm,
                    key=key_name,
                    duration_secs=float(track.length) if track.length else None,
                    device_path=stored,
                    status=status,
                    detail=detail,
                    matched_path=matched,
                )
            )

    return _preview(root, "engine", total, entries, destination)


def _preview(
    root: Path,
    kind: str,
    device_count: int,
    entries: list[PullEntry],
    destination: Path | None = None,
    device_playlists: list[DevicePlaylist] | None = None,
) -> PullPreview:
    return PullPreview(
        root=str(root),
        kind=kind,
        device_track_count=device_count,
        new_count=sum(1 for e in entries if e.status == STATUS_NEW),
        present_count=sum(1 for e in entries if e.status == STATUS_PRESENT),
        uncertain_count=sum(1 for e in entries if e.status == STATUS_UNCERTAIN),
        duplicate_count=sum(1 for e in entries if e.status == STATUS_DUPLICATE),
        missing_file_count=sum(1 for e in entries if e.status == STATUS_MISSING),
        default_destination=default_destination(),
        fingerprint=_plan_fingerprint(
            root, kind, entries, destination, playlists=device_playlists
        ),
        source_fingerprint=_plan_fingerprint(
            root, kind, entries, None, playlists=device_playlists
        ),
        entries=entries,
    )


def build_pull_preview(
    manadj_session: Any, root: Path, destination: Path | None = None,
    verify: bool = True,
) -> PullPreview:
    """Read-only pull diff. verify=False skips content verification (no
    hashing): matches that need it stay "uncertain", so the UI can render
    every row with its metadata immediately and refine once verification
    completes. Imports must always be bound to a verified preview."""
    drive = detect_drive_at(root)
    if drive is None:
        raise ExternalDriveError(f"no Rekordbox or Engine library found at {root}")
    if drive.kind == "rekordbox":
        return build_rekordbox_pull_preview(manadj_session, root, destination, verify=verify)
    return build_engine_pull_preview(manadj_session, root, destination, verify=verify)


# --- confirmed import --------------------------------------------------------


@dataclass
class PullResult:
    root: str
    kind: str
    destination: str
    imported: int
    skipped_present: int
    skipped_uncertain: int
    skipped_duplicate: int
    skipped_missing_file: int
    # New entries the user left unchecked in a selected pull.
    skipped_unselected: int = 0
    errors: list[str] = field(default_factory=list)
    track_ids: list[int] = field(default_factory=list)
    # Which verified-preview ordinal each imported track came from, so a
    # playlist import can place new tracks in device order.
    imported_by_ordinal: dict[int, int] = field(default_factory=dict)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _copy_destination(destination: Path, device_path: str) -> Path | None:
    """The library path a device file copies to; None if the path escapes."""
    parts = _sanitize_rel(device_path)
    if not parts:
        return None
    return destination.joinpath(*parts)


def _case_collision(dest: Path) -> Path | None:
    """An existing file whose name differs from dest only by case.

    Case-insensitive filesystems (macOS, Windows) would silently overwrite
    it; find it first so the hash check can decide.
    """
    if not dest.parent.is_dir():
        return None
    try:
        for entry in dest.parent.iterdir():
            if entry.name != dest.name and entry.name.casefold() == dest.name.casefold():
                return entry
    except OSError:
        return None
    return None


def _copy_one(source: Path, dest: Path) -> tuple[Path | None, str | None, bool]:
    """Copy source -> dest atomically. Returns (path used, error, created).

    Never overwrites: an existing file (exact or case-variant name) is
    reused only when its content hash matches the source; anything else is
    an error. The copy lands via a temp file in the same directory, so a
    failure never leaves a partial file at the destination. `created` is
    True only when this call wrote the file.
    """
    existing: Path | None = dest if dest.exists() else _case_collision(dest)
    if existing is not None:
        if existing.is_file() and _sha256(existing) == _sha256(source):
            return existing, None, False  # identical content already there: re-run safe
        return (
            None,
            f"{existing}: a different file already exists there; refusing to overwrite",
            False,
        )
    dest.parent.mkdir(parents=True, exist_ok=True)
    temp = dest.with_name(f".{dest.name}.part-{os.getpid()}")
    try:
        before = source.stat()
        shutil.copy2(source, temp)
        after = source.stat()
        if (after.st_size, after.st_mtime_ns) != (before.st_size, before.st_mtime_ns):
            return None, f"{source}: changed while copying; not imported", False
        # Content identity: the bytes that land must be the bytes reviewed.
        if _sha256(temp) != _sha256(source):
            return None, f"{dest}: copy differed from the source; not imported", False
        try:
            # Atomic no-clobber: link fails with FileExistsError when dest
            # appeared after the check above, so a concurrent file is
            # never overwritten. The temp sits in the same directory, so
            # always the same filesystem.
            os.link(temp, dest)
        except FileExistsError:
            if dest.is_file() and _sha256(dest) == _sha256(temp):
                return dest, None, False  # the same content won the race
            return (
                None,
                f"{dest}: a different file appeared during the copy; refusing to overwrite",
                False,
            )
        except OSError as exc:
            # No atomic no-clobber on this filesystem: fail closed rather
            # than fall back to a racy check-then-rename.
            return (
                None,
                (
                    f"{dest}: no atomic no-clobber copy on this filesystem ({exc}); "
                    "refusing to risk an overwrite"
                ),
                False,
            )
    finally:
        temp.unlink(missing_ok=True)
    return dest, None, True


@dataclass
class PlaylistPullResult:
    """Outcome of importing one device playlist: files copied plus a
    local playlist created in device order."""

    playlist_id: int
    name: str
    member_count: int
    imported: int
    already_in_library: int
    skipped_uncertain: int
    skipped_other: int
    pull: PullResult


def execute_playlist_pull(
    manadj_session: Any,
    root: Path,
    destination: Path,
    *,
    device_playlist_id: int,
    expected_fingerprint: str,
    playlist_name: str | None = None,
) -> PlaylistPullResult:
    """Import one device playlist: copy its new tracks (and only those),
    then create a local playlist with every resolvable member in device
    order. Create-only: a local playlist with the final name must not
    exist yet; merging into an existing playlist is a separate,
    confirm-first flow.

    The fingerprint must come from a verified (content-hashed) preview,
    the same binding execute_pull enforces for the file copy. Uncertain
    members are skipped and counted, never silently resolved.
    """
    from backend.models import Playlist, PlaylistTrack

    root = root.resolve()
    preview = build_pull_preview(manadj_session, root, destination)
    if preview.fingerprint != expected_fingerprint:
        raise PlanChangedError(
            "the drive or library changed since the preview; run the preview again before importing"
        )
    device = read_rekordbox_device(root)
    node = next((pl for pl in device.playlists if pl.id == device_playlist_id), None)
    if node is None or node.is_folder:
        raise ExternalDriveError(f"no device playlist with id {device_playlist_id}")

    final_name = playlist_name or node.name
    if not final_name:
        raise ExternalDriveError("device playlist has no name; pass playlist_name")
    if not node.track_ids:
        raise ExternalDriveError(
            f"device playlist {final_name!r} has no tracks; nothing to import"
        )
    if manadj_session.query(Playlist).filter(Playlist.name == final_name).first():
        raise ExternalDriveError(
            f"a local playlist named {final_name!r} already exists; "
            "importing over it is not automatic - pass a different playlist_name"
        )

    # Refuse repeats before any file is copied, the same guards the
    # update path applies: local playlists cannot represent repeated
    # tracks (migration 0011), so importing one would copy files and then
    # fail the playlist creation. Accurate refusal, never silent dedupe.
    if len(node.track_ids) != len(set(node.track_ids)):
        raise ExternalDriveError(
            "this USB playlist repeats tracks; local playlists cannot represent repeated "
            "tracks yet, so no import was made"
        )

    entry_by_track_id = {
        device.tracks[e.ordinal].id: e
        for e in preview.entries
        if 0 <= e.ordinal < len(device.tracks)
    }
    existing_index, _, _ = _manadj_matchers(manadj_session)
    resolved_ids = [
        _library_track_id(existing_index, entry_by_track_id[tid])
        for tid in node.track_ids
        if tid in entry_by_track_id
    ]
    resolved_ids = [tid for tid in resolved_ids if tid is not None]
    if len(resolved_ids) != len(set(resolved_ids)):
        raise ExternalDriveError(
            "multiple USB entries resolve to the same library track; repeated tracks "
            "are not supported locally yet, so no import was made"
        )
    new_ordinals = {
        entry_by_track_id[tid].ordinal
        for tid in node.track_ids
        if tid in entry_by_track_id and entry_by_track_id[tid].status == STATUS_NEW
    }
    pull = execute_pull(
        manadj_session,
        root,
        destination,
        expected_fingerprint=expected_fingerprint,
        ordinals=new_ordinals,
    )

    index, _, _ = _manadj_matchers(manadj_session)
    member_ids: list[int] = []
    already = 0
    skipped_uncertain = 0
    skipped_other = 0
    for tid in node.track_ids:
        entry = entry_by_track_id.get(tid)
        if entry is None:
            skipped_other += 1
            continue
        if entry.ordinal in pull.imported_by_ordinal:
            member_ids.append(pull.imported_by_ordinal[entry.ordinal])
            continue
        lib_id = _library_track_id(index, entry)
        if lib_id is not None:
            member_ids.append(lib_id)
            already += 1
        elif entry.status == STATUS_UNCERTAIN:
            skipped_uncertain += 1
        else:
            skipped_other += 1

    if len(member_ids) != len(set(member_ids)):
        raise ExternalDriveError(
            "multiple USB entries resolve to the same library track; repeated tracks "
            "are not supported locally yet; the imported tracks stay in the library, "
            "but no playlist was created"
        )
    if not member_ids:
        raise ExternalDriveError(
            f"no member of {final_name!r} could be imported or matched "
            f"({skipped_uncertain} unverified, {skipped_other} missing or unreadable); "
            "no playlist was created"
        )
    playlist = Playlist(name=final_name)
    manadj_session.add(playlist)
    manadj_session.flush()
    for position, track_id in enumerate(member_ids):
        manadj_session.add(
            PlaylistTrack(playlist_id=playlist.id, track_id=track_id, position=position)
        )
    try:
        manadj_session.commit()
    except Exception as exc:
        manadj_session.rollback()
        raise ExternalDriveError(
            f"playlist creation failed; the {pull.imported} imported tracks stay in the "
            f"library but no playlist was created: {exc}"
        ) from exc

    return PlaylistPullResult(
        playlist_id=playlist.id,
        name=final_name,
        member_count=len(member_ids),
        imported=pull.imported,
        already_in_library=already,
        skipped_uncertain=skipped_uncertain,
        skipped_other=skipped_other,
        pull=pull,
    )


@dataclass
class PlaylistUpdateResult:
    """Outcome of syncing an existing local playlist from a device
    playlist: missing members imported/added, order matched to the
    device, local-only members kept (never silently removed)."""

    playlist_id: int
    name: str
    member_count: int
    added_imported: int  # newly copied files now on the playlist
    added_from_library: int  # verified library tracks added to the playlist
    kept_local_only: int  # local members absent from the device playlist, kept
    skipped_uncertain: int
    skipped_other: int
    pull: PullResult


def execute_playlist_update(
    manadj_session: Any,
    root: Path,
    destination: Path,
    *,
    device_playlist_id: int,
    local_playlist_id: int,
    expected_fingerprint: str,
    expected_target_token: str,
) -> PlaylistUpdateResult:
    """Sync an existing local playlist from a device playlist (pull side
    only; the drive is never written to).

    The pairing is the caller's reviewed choice: local_playlist_id is
    explicit, never derived from a name match. Missing members are
    imported (adds_new) or attached from the library (adds_in_library);
    the playlist's order is matched to device order; members only in the
    local playlist are KEPT in their prior relative order after the
    device-ordered members, never silently removed. Uncertain and
    missing members are skipped and counted.
    """
    from backend.models import Playlist, PlaylistTrack

    root = root.resolve()
    preview = build_pull_preview(manadj_session, root, destination)
    if preview.fingerprint != expected_fingerprint:
        raise PlanChangedError(
            "the drive or library changed since the preview; run the preview again before importing"
        )
    device = read_rekordbox_device(root)
    node = next((pl for pl in device.playlists if pl.id == device_playlist_id), None)
    if node is None or node.is_folder:
        raise ExternalDriveError(f"no device playlist with id {device_playlist_id}")
    local = manadj_session.get(Playlist, local_playlist_id)
    if local is None:
        raise ExternalDriveError(f"no local playlist with id {local_playlist_id}")

    def current_rows() -> list[Any]:
        return (
            manadj_session.query(PlaylistTrack)
            .filter(PlaylistTrack.playlist_id == local.id)
            .order_by(PlaylistTrack.position)
            .all()
        )

    def current_token(rows: list[Any]) -> str:
        return local_playlist_snapshot_token(
            local.id, local.name, [r.track_id for r in rows]
        )

    # Reject a stale reviewed target before any file is copied.
    manadj_session.refresh(local)
    rows = current_rows()
    if current_token(rows) != expected_target_token:
        raise ExternalDriveError(
            f'local playlist "{local.name}" changed since the review; '
            "run the preview again before updating"
        )

    if len(node.track_ids) != len(set(node.track_ids)):
        raise ExternalDriveError(
            "this USB playlist repeats tracks; local playlists cannot represent repeated "
            "tracks yet, so no update was made"
        )

    entry_by_track_id = {
        device.tracks[e.ordinal].id: e
        for e in preview.entries
        if 0 <= e.ordinal < len(device.tracks)
    }
    existing_index, _, _ = _manadj_matchers(manadj_session)
    resolved_ids = [
        _library_track_id(existing_index, entry_by_track_id[tid])
        for tid in node.track_ids if tid in entry_by_track_id
    ]
    resolved_ids = [tid for tid in resolved_ids if tid is not None]
    if len(resolved_ids) != len(set(resolved_ids)):
        raise ExternalDriveError(
            "multiple USB entries resolve to the same library track; repeated tracks "
            "are not supported locally yet, so no update was made"
        )
    new_ordinals = {
        entry_by_track_id[tid].ordinal
        for tid in node.track_ids
        if tid in entry_by_track_id and entry_by_track_id[tid].status == STATUS_NEW
    }
    pull = execute_pull(
        manadj_session,
        root,
        destination,
        expected_fingerprint=expected_fingerprint,
        ordinals=new_ordinals,
    )

    index, _, _ = _manadj_matchers(manadj_session)
    desired: list[int] = []
    skipped_uncertain = 0
    skipped_other = 0
    for tid in node.track_ids:
        entry = entry_by_track_id.get(tid)
        if entry is None:
            skipped_other += 1
            continue
        if entry.ordinal in pull.imported_by_ordinal:
            desired.append(pull.imported_by_ordinal[entry.ordinal])
            continue
        lib_id = _library_track_id(index, entry)
        if lib_id is not None:
            desired.append(lib_id)
        elif entry.status == STATUS_UNCERTAIN:
            skipped_uncertain += 1
        else:
            skipped_other += 1

    # Release the read transaction after copying, then reserve the SQLite
    # writer before re-reading the target. No other writer can slip an edit
    # between the token check and replacement. Imported tracks already stand.
    manadj_session.rollback()
    if manadj_session.get_bind().dialect.name != "sqlite":
        raise ExternalDriveError("playlist updates currently require SQLite write locking")
    from sqlalchemy import text
    manadj_session.execute(text("BEGIN IMMEDIATE"))
    manadj_session.expire_all()
    local = manadj_session.get(Playlist, local_playlist_id)
    if local is None:
        manadj_session.rollback()
        raise ExternalDriveError("local playlist was removed since the review")
    current = current_rows()
    if current_token(current) != expected_target_token:
        manadj_session.rollback()
        raise ExternalDriveError(
            "local playlist changed since the review; imported tracks stay in the "
            "library, but the playlist was not updated; run the preview again"
        )
    if len(desired) != len(set(desired)):
        manadj_session.rollback()
        raise ExternalDriveError(
            "multiple USB entries resolve to the same library track; repeated tracks "
            "are not supported locally yet, so the playlist was not updated"
        )
    current_ids = [c.track_id for c in current]
    # Occurrence-count subtraction: the device order claims one occurrence
    # of each track; surplus local occurrences stay, in their prior
    # relative order, and local members the drive does not resolve
    # (e.g. missing files) are preserved, never silently dropped.
    desired_counts = Counter(desired)
    kept_local_only = []
    for tid in current_ids:
        if desired_counts.get(tid, 0) > 0:
            desired_counts[tid] -= 1
        else:
            kept_local_only.append(tid)
    final = desired + kept_local_only
    added_from_library = sum(
        1 for tid in desired
        if tid not in pull.imported_by_ordinal.values() and tid not in current_ids
    )

    try:
        for row in current:
            manadj_session.delete(row)
        manadj_session.flush()
        for position, track_id in enumerate(final):
            manadj_session.add(
                PlaylistTrack(playlist_id=local.id, track_id=track_id, position=position)
            )
        manadj_session.commit()
    except Exception as exc:
        manadj_session.rollback()
        raise ExternalDriveError(
            f"playlist update failed; imported tracks stay in the library "
            f"and the local playlist was left unchanged: {exc}"
        ) from exc

    return PlaylistUpdateResult(
        playlist_id=local.id,
        name=local.name,
        member_count=len(final),
        added_imported=pull.imported,
        added_from_library=added_from_library,
        kept_local_only=len(kept_local_only),
        skipped_uncertain=skipped_uncertain,
        skipped_other=skipped_other,
        pull=pull,
    )


def execute_pull(
    manadj_session: Any,
    root: Path,
    destination: Path,
    *,
    expected_fingerprint: str,
    ordinals: set[int] | None = None,
) -> PullResult:
    """Copy new tracks off the drive and add them to the library.

    The preview is recomputed here and must match the fingerprint the
    user confirmed; a mismatch refuses the import, so the confirmed set
    never silently grows or shrinks between preview and click. Only
    STATUS_NEW entries import: name-only matches stay out unless the user
    resolves them. When ordinals is given it is the user's checkbox
    selection from that same reviewed plan; any selected ordinal that is
    not a new entry in the verified plan refuses the whole import rather
    than silently importing a different set. If the database commit
    fails, the files copied in this run are removed again.
    """
    root = root.resolve()
    destination = destination.resolve()
    if destination == root or root in destination.parents:
        raise ExternalDriveError("destination is on the source drive; pulls never write to it")

    preview = build_pull_preview(manadj_session, root, destination)
    if preview.fingerprint != expected_fingerprint:
        raise PlanChangedError(
            "the drive or library changed since the preview; run the preview again before importing"
        )
    result = PullResult(
        root=str(root),
        kind=preview.kind,
        destination=str(destination),
        imported=0,
        skipped_present=preview.present_count,
        skipped_uncertain=preview.uncertain_count,
        skipped_duplicate=preview.duplicate_count,
        skipped_missing_file=preview.missing_file_count,
    )

    device: RekordboxDevice | None = None
    if preview.kind == "rekordbox":
        device = read_rekordbox_device(root)

    new_entries = [e for e in preview.entries if e.status == STATUS_NEW]
    if ordinals is not None:
        new_ordinals = {e.ordinal for e in new_entries}
        unknown = ordinals - new_ordinals
        if unknown:
            raise ExternalDriveError(
                "selection does not match the verified preview: "
                f"ordinals {sorted(unknown)} are not importable new tracks"
            )
        result.skipped_unselected = len(new_entries) - len(ordinals)
        new_entries = [e for e in new_entries if e.ordinal in ordinals]
    imported_tracks: list[tuple[int, Track]] = []
    created_files: list[Path] = []
    dest_names_seen: set[str] = set()
    for entry in new_entries:
        source = _device_source(root, preview.kind, entry.device_path)
        if source is None or not source.is_file():
            result.skipped_missing_file += 1
            continue
        dest = _copy_destination(destination, entry.device_path)
        if dest is None:
            result.errors.append(f"{entry.device_path}: unusable device path")
            continue
        dest_key = str(dest).casefold()
        if dest_key in dest_names_seen:
            result.errors.append(f"{dest}: two drive tracks map to the same file name")
            continue
        dest_names_seen.add(dest_key)
        used_path, error, created = _copy_one(source, dest)
        if error is not None:
            result.errors.append(error)
            continue
        assert used_path is not None
        if created:
            created_files.append(used_path)

        bpm_centi: int | None = None
        key_id: int | None = None
        if preview.kind == "rekordbox":
            assert device is not None
            pdb_track = device.tracks[entry.ordinal]
            bpm_centi = pdb_track.tempo_centibpm or None
            key_name = device.keys.get(pdb_track.key_id)
            key_obj = Key.from_musical(key_name)
            key_id = key_obj.engine_id if key_obj else None
        else:
            bpm_centi = round(entry.bpm * 100) if entry.bpm else None
            # entry.key is the Engine key's musical name from the preview;
            # map it back through the single Key authority.
            if entry.key:
                key_obj = Key.from_musical(entry.key)
                key_id = key_obj.engine_id if key_obj else None

        track = Track(
            filename=str(used_path),
            title=entry.title or used_path.stem,
            artist=entry.artist,
            bpm=bpm_centi,
            key=key_id,
            key_provenance="imported" if key_id is not None else None,
            energy=None,
        )
        manadj_session.add(track)
        imported_tracks.append((entry.ordinal, track))
        result.imported += 1

    if imported_tracks:
        try:
            manadj_session.commit()
        except Exception as exc:
            manadj_session.rollback()
            for created in created_files:
                created.unlink(missing_ok=True)
            raise ExternalDriveError(
                f"import failed before the library commit; copied files were removed: {exc}"
            ) from exc
        # The library commit landed: the copied files now belong to Track
        # rows and are never deleted from here on. A failing post-import
        # step (facts, waveforms, analysis, stems) is recorded and the
        # rest continue; every step can be re-queued from the library.
        from backend.track_metadata.file_facts import refresh_file_facts
        from backend.waveform_tasks import enqueue_missing_waveforms
        from backend.analysis_tasks import enqueue_missing_analysis
        from backend.stems_tasks import enqueue_stem_split

        def _post_step(label: str, fn: Any) -> None:
            try:
                fn()
                manadj_session.commit()
            except Exception as exc:  # noqa: BLE001 — recorded, not fatal
                manadj_session.rollback()
                result.errors.append(
                    f"post-import step {label} failed "
                    f"(the imported tracks are in the library; re-run it there): {exc}"
                )

        _post_step("file facts", lambda: refresh_file_facts(manadj_session))
        _post_step("waveforms", lambda: enqueue_missing_waveforms(manadj_session))
        _post_step("analysis", lambda: enqueue_missing_analysis(manadj_session))
        for _ordinal, track in imported_tracks:
            _post_step(
                "stem split", lambda t=track: enqueue_stem_split(manadj_session, t.id)
            )
        result.track_ids = [t.id for _o, t in imported_tracks]
        result.imported_by_ordinal = {o: t.id for o, t in imported_tracks}

    return result


def check_drive_structure(root: Path) -> dict:
    """Read-only structural readback of a Rekordbox device tree.

    Basis for the USB overview's "structure" line, nothing more: it reuses
    manaDJ's own device reader (rekordbox.device.verify) to confirm the
    database pages, playlist tree and analysis files parse. It does NOT
    prove a Pioneer player will load the drive, and a drive written by
    Rekordbox desktop may report differences simply because the checker
    encodes manaDJ's writer layout. Engine drives are not checked.
    """
    drive = detect_drive_at(root)
    if drive is None:
        raise ExternalDriveError(f"{root} is not a Rekordbox or Engine library")
    if drive.kind != "rekordbox":
        return {"kind": drive.kind, "checked": False, "reason": "Engine drives have no structure check yet"}
    from rekordbox.device.verify import verify_export

    report = verify_export(Path(root))
    return {
        "kind": "rekordbox",
        "checked": True,
        "tracks": report["tracks"],
        "playlists": report["playlists"],
        "analysis_files": report["analysis_files"],
        "errors": list(report["errors"])[:20],
        "error_count": len(report["errors"]),
    }


# --- field comparison (read-only) -----------------------------------------

COMPARED_FIELDS = ("title", "artist", "bpm", "key")
# BPM is shown but never taken from a drive: it follows manaDJ's own analysis.
APPLICABLE_FIELDS = ("title", "artist", "key")


def _norm_text(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def compare_matched_fields(manadj_session: Any, preview: "PullPreview") -> dict:
    """Per-track metadata comparison for tracks already in the library.

    One row per track (never per playlist): the drive's value, the library's
    value, and whether they differ. Only audio-verified matches are compared;
    unverified name matches never are. A field differs only when the drive has
    a value: a blank drive value is nothing to take. Cues and other fields are
    NOT compared; the response says so rather than staying silent.
    Read-only: nothing here writes to the library or the drive.
    """
    from backend.key import Key
    from backend.models import Track

    index, _, _ = _manadj_matchers(manadj_session)
    # Pass 1: gather EVERY drive entry that matches each library track, with
    # all of its drive values, before deciding what differs. A duplicate that
    # equals the library must still conflict with one that differs.
    gathered: dict[int, dict] = {}
    for entry in preview.entries:
        track_id = _library_track_id(index, entry)
        if track_id is None:
            continue
        slot = gathered.setdefault(track_id, {"first": entry, "entries": []})
        slot["entries"].append(entry)
    tracks: list[dict] = []
    for track_id, slot in gathered.items():
        track = manadj_session.get(Track, track_id)
        if track is None:
            continue
        entry = slot["first"]
        lib_key = Key(track.key).musical if track.key is not None else None
        lib_values = {
            "title": _norm_text(track.title),
            "artist": _norm_text(track.artist),
            "bpm": round(track.bpm / 100.0, 2) if track.bpm else None,
            "key": lib_key,
        }

        def drive_value(e: Any, name: str) -> Any:
            if name == "title":
                return _norm_text(e.title)
            if name == "artist":
                return _norm_text(e.artist)
            if name == "bpm":
                return round(e.bpm, 2) if e.bpm else None
            key_obj = Key.from_musical(e.key) if e.key else None
            return key_obj.musical if key_obj else _norm_text(e.key)

        def same(name: str, x: Any, y: Any) -> bool:
            if name in ("title", "artist") and isinstance(x, str) and isinstance(y, str):
                return x.casefold() == y.casefold()
            if name == "bpm" and x is not None and y is not None:
                return abs(x - y) <= 0.01
            return x == y

        fields = []
        for name in COMPARED_FIELDS:
            vals = [v for v in (drive_value(e, name) for e in slot["entries"]) if v is not None]
            if not vals:
                continue  # nothing on the drive to take
            distinct: list[Any] = []
            for v in vals:
                if not any(same(name, v, d) for d in distinct):
                    distinct.append(v)
            lib_value = lib_values[name]
            conflict = len(distinct) > 1
            differing = [v for v in distinct if not same(name, v, lib_value)]
            if not differing:
                continue
            row = {
                "field": name,
                "drive": differing[0],
                "library": lib_value,
                "applicable": name in APPLICABLE_FIELDS and not conflict,
            }
            if conflict:
                row["conflict"] = "The drive holds this track twice with different values."
            fields.append(row)
        if fields:
            tracks.append({
                "ordinal": entry.ordinal,
                "track_id": track_id,
                "label": " - ".join(x for x in (entry.artist, entry.title) if x) or entry.device_path,
                "fields": fields,
            })
    return {
        "fingerprint": preview.fingerprint,
        "tracks": tracks,
        "compared": list(COMPARED_FIELDS),
        "not_compared": {"cues": "Hot cue comparison is not available yet."},
    }


class FieldChangeRefused(ExternalDriveError):
    pass


def apply_field_changes(manadj_session: Any, root: Path, preview_fingerprint: str, changes: list[dict]) -> dict:
    """Take the drive's value for the listed (track_id, field) pairs.

    Bound to the reviewed preview: a changed drive or library refuses the
    whole batch before anything is written. Only audio-verified matches and
    APPLICABLE_FIELDS can be taken. Writes the library only, never the drive.
    """
    from backend.key import Key
    from backend.models import Track

    preview = build_pull_preview(manadj_session, root, None, verify=True)
    if preview.fingerprint != preview_fingerprint:
        raise FieldChangeRefused("The drive or library changed since you reviewed it. Review again.")
    comparison = compare_matched_fields(manadj_session, preview)
    by_track = {t["track_id"]: {f["field"]: f for f in t["fields"]} for t in comparison["tracks"]}
    if not changes:
        raise FieldChangeRefused("No field changes were chosen.")
    # Validate EVERY change before the first write, so a late invalid or stale
    # member refuses the whole batch with nothing written.
    unique: dict[tuple[int, str], dict] = {}
    for change in changes:
        pair = (change.get("track_id"), change.get("field"))
        field_row = by_track.get(pair[0], {}).get(pair[1])
        if field_row is None:
            raise FieldChangeRefused("A chosen change no longer differs. Review again.")
        if not field_row["applicable"]:
            raise FieldChangeRefused(f"{pair[1]} cannot be taken from a drive.")
        # The values the user reviewed must still be the live values.
        for side in ("drive", "library"):
            if side not in change:
                raise FieldChangeRefused("Each change must carry the reviewed drive and library values.")
            if change[side] != field_row[side]:
                raise FieldChangeRefused("A value changed since you reviewed it. Review again.")
        if pair[1] == "key":
            key = Key.from_musical(field_row["drive"])
            if key is None or key.engine_id is None:
                raise FieldChangeRefused(f"Unrecognized key {field_row['drive']!r}.")
        if manadj_session.get(Track, pair[0]) is None:
            raise FieldChangeRefused("A chosen track no longer exists. Review again.")
        unique[pair] = change  # the same pair twice is one write
    applied = []
    try:
        for (track_id, field_name), _ in unique.items():
            track = manadj_session.get(Track, track_id)
            value = by_track[track_id][field_name]["drive"]
            if field_name == "key":
                track.key = Key.from_musical(value).engine_id
                track.key_provenance = "imported"
            else:
                setattr(track, field_name, value)
            applied.append({"track_id": track_id, "field": field_name, "value": value})
        manadj_session.commit()
    except Exception:
        manadj_session.rollback()
        raise
    return {"applied": applied}


def export_impact(manadj_session: Any, root: Path, playlist_ids: list[int]) -> dict:
    """Read-only: what a performance-USB export of these playlists would do to this drive.

    The device exporter is a full rebuild of the drive's index, not a sync. It rewrites
    export.pdb and exportExt.pdb from only the selected playlists, rewrites analysis files
    for the exported tracks and copies audio into Contents/<track id>/. It deletes nothing,
    but playlists and tracks that are on the drive and not selected disappear from the
    index, and their audio files stay behind unreferenced. This function writes nothing.
    Execution is not available: the exporter is hardware-unverified and has no endpoint.
    """
    from backend import models
    from backend.config import get_config

    root = Path(root)
    drive = detect_drive_at(root)
    if drive is None or drive.kind != "rekordbox":
        raise ExternalDriveError("Not a Rekordbox drive")
    selected = []
    for pid in playlist_ids:
        pl = manadj_session.get(models.Playlist, pid)
        if pl is None:
            continue
        rows = manadj_session.query(models.PlaylistTrack).filter(models.PlaylistTrack.playlist_id == pid).all()
        usable = 0
        missing_audio = 0
        for row in rows:
            track = manadj_session.get(models.Track, row.track_id)
            if track is None or track.archived_at is not None:
                continue
            if Path(track.filename).is_file():
                usable += 1
            else:
                missing_audio += 1
        selected.append({"id": pid, "name": pl.name, "tracks": usable, "missing_audio": missing_audio})
    names = {s["name"] for s in selected}
    drive_read: dict
    try:
        device = read_rekordbox_device(root)
        listed = [p for p in device.playlists if not p.is_folder]
        drive_read = {
            "read": True,
            "tracks": len(device.tracks),
            "playlists": len(listed),
            "dropped_playlists": sorted((p.name or "") for p in listed if p.name not in names),
        }
    except Exception as exc:  # noqa: BLE001 - an unreadable drive is a result
        drive_read = {"read": False, "reason": str(exc)}
    return {
        "root": str(root),
        "mode": "rebuild",
        "selected": selected,
        "drive": drive_read,
        "one_library_present": (root / "PIONEER/rekordbox/exportLibrary.db").exists(),
        "is_mount": root.resolve().is_mount(),
        "gate_enabled": bool(get_config().export.enabled),
        "rewrites": ["PIONEER/rekordbox/export.pdb", "PIONEER/rekordbox/exportExt.pdb", "PIONEER/USBANLZ (exported tracks)"],
        "adds": ["Contents/<track id>/ (audio for exported tracks)"],
        "deletes": [],
        "executable": False,
        "blocked_reason": "Not enabled: rebuild is hardware-unverified and not wired to the app.",
    }
