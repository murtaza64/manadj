"""Track matching: the single home of Match (see CONTEXT.md).

Match associates a track with its counterpart in another library by file
path, falling back to filename. Canonical semantics, defined once here:

- two tiers: exact full-path match, then basename match
- case-sensitive
- rows without a path are excluded from the index (and never match)
- duplicate paths: last row wins

Callers provide a single ``path_of`` getter; the filename tier is derived
from the path's basename.

Two Match kin also live here, to keep the sync managers from re-deriving them:

- ``match_by_key`` generalizes Match off the track-path special case — bucket
  items across sources by any match key (a tag's ``(category, name)``, a
  playlist's name). Consumed by ``tags/comparison`` and ``playlists/matching``.
- ``in_sync`` is the agreement predicate the sync managers used to each define
  (``_check_if_synced``): do all present sources in a bucket hold the same
  value? Consumed by ``TagSyncManager`` and ``PlaylistSyncManager``.

These are pure and track/tag/playlist-agnostic; the field semantics ride in the
caller's ``key_of`` / ``equal`` callables.
"""

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import TypeVar

_K = TypeVar("_K")
_V = TypeVar("_V")


@dataclass(frozen=True)
class TrackIndex[T]:
    """An index of tracks supporting two-tier path matching."""

    by_path: dict[str, T]
    by_filename: dict[str, T]

    @classmethod
    def build(cls, tracks: Iterable[T], path_of: Callable[[T], str | None]) -> "TrackIndex[T]":
        by_path: dict[str, T] = {}
        by_filename: dict[str, T] = {}
        for track in tracks:
            path = path_of(track)
            if not path:
                continue
            by_path[path] = track
            by_filename[Path(path).name] = track
        return cls(by_path=by_path, by_filename=by_filename)

    def match(self, path: str | None) -> T | None:
        """Two-tier match: full path, then basename. None for no match."""
        if not path:
            return None
        hit = self.by_path.get(path)
        if hit is not None:
            return hit
        return self.by_filename.get(Path(path).name)


def find_unmatched[T, U](
    tracks: Iterable[T],
    path_of: Callable[[T], str | None],
    target: "TrackIndex[U]",
) -> list[T]:
    """Tracks with no counterpart in the target index (pathless rows included)."""
    return [t for t in tracks if target.match(path_of(t)) is None]


def match_by_key(
    sources: Mapping[str, Iterable[_V]],
    key_of: Callable[[_V], _K | None],
) -> dict[_K, dict[str, _V]]:
    """Group items across sources into one bucket per match key.

    Generalizes Match off the track-path special case: a tag matched by
    ``(category, name)`` and a playlist matched by ``name`` both reduce to
    "bucket items whose ``key_of`` agrees". Items whose key is None are dropped
    (they can never match — mirrors ``TrackIndex``); within one source the last
    item for a key wins (mirrors ``TrackIndex.build``).

    Returns ``{key: {source_id: item}}`` — a bucket carries only the sources
    that actually hold that key.
    """
    buckets: dict[_K, dict[str, _V]] = {}
    for source_id, items in sources.items():
        for item in items:
            key = key_of(item)
            if key is None:
                continue
            buckets.setdefault(key, {})[source_id] = item
    return buckets


def in_sync(
    bucket: Mapping[str, _V],
    equal: Callable[[_V, _V], bool],
) -> bool:
    """True when every present source in a bucket agrees.

    The single home of the sync-manager "in sync" predicate: 0 or 1 present
    sources are trivially in sync; otherwise every source must equal the first.
    ``equal`` carries the field's comparison semantics (track counts, ordered
    track lists), so this predicate never learns a source's shape.
    """
    present = list(bucket.values())
    if len(present) <= 1:
        return True
    first = present[0]
    return all(equal(first, other) for other in present[1:])
