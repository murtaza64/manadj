"""Shared skip markers for capabilities that are deliberately unavailable on Windows."""
import os

import pytest

# group_replay.read_selected opens a selected pathname with O_NONBLOCK so a swapped-in
# FIFO/device cannot hang the open. Windows has no O_NONBLOCK and no equivalent safe
# regular-file open is implemented (named pipes, device namespaces, reparse points),
# so exact-byte replay identity fails closed with "unsupported-identity" there.
posix_file_identity = pytest.mark.skipif(
    os.name != "posix", reason="exact-byte file identity fails closed on Windows (no safe non-blocking regular-file open)")
