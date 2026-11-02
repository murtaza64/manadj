"""Engine track identity: resolve stored paths against their own library root.

Lexical only: no existence checks, symlink resolution or media access. Matching
policy (exact path then last basename, case/Unicode rules) stays in TrackIndex.
"""
import ntpath
import os
import posixpath


def absolute_track_path(stored: str | None, library_root: str | os.PathLike) -> str | None:
    if not stored:
        return None
    root = os.fspath(library_root)
    drive, tail = ntpath.splitdrive(stored)
    if drive:
        # A drive-relative path depends on another drive's working directory;
        # there is no configured-root identity for it. Never guess that CWD.
        return ntpath.normpath(stored) if tail.startswith(('\\', '/')) else None
    if ntpath.splitdrive(root)[0]:
        return ntpath.normpath(ntpath.join(root, stored))
    return posixpath.normpath(posixpath.join(os.path.abspath(root), stored.replace('\\', '/')))
