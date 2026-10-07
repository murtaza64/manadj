"""Retry filesystem ops that Windows refuses while a file is open (#310).

Windows won't delete or rename a file another handle holds open (e.g. while
the backend streams it); POSIX never raises here, so on macOS/Linux the
first attempt is the only attempt.
"""

from __future__ import annotations

import time
from collections.abc import Callable

ATTEMPTS = 5
DELAY_S = 0.2


def retry_locked[T](fn: Callable[[], T], attempts: int = ATTEMPTS, delay_s: float = DELAY_S) -> T:
    """Call `fn`, retrying PermissionError (Windows sharing violation)."""
    for attempt in range(attempts):
        try:
            return fn()
        except PermissionError:
            if attempt == attempts - 1:
                raise
            time.sleep(delay_s * (attempt + 1))
    raise AssertionError("unreachable")
