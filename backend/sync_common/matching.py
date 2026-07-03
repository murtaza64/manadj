"""Track matching: the single home of Match (see CONTEXT.md).

Match associates a track with its counterpart in another library by file
path, falling back to filename. Canonical semantics, defined once here:

- two tiers: exact full-path match, then basename match
- case-sensitive
- rows without a path are excluded from the index (and never match)
- duplicate paths: last row wins

Callers provide a single ``path_of`` getter; the filename tier is derived
from the path's basename.
"""

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path


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
