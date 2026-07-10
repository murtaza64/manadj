"""The Supplier seam: where audio is obtained (as opposed to discovered).

A Source is demand (what tracks are wanted); a **Supplier** is supply (where
their bytes come from). SoundCloud is both a Source and a Supplier; Soulseek
will be a Supplier only. See CONTEXT.md (Source vs Supplier).

The protocol is split to mirror the glossary's Direct/Search Supplier
distinction, so a Supplier that cannot search carries no lying no-op methods:

- `Supplier` (base) is download-only. A Direct Supplier's Source Item itself
  addresses the audio, so fulfillment is a plain download.
- `SearchSupplier` extends it with search + transfer-state polling. A Search
  Supplier has no per-item address: candidates are found by searching, one is
  picked, and its transfer is polled to completion. Only Search Suppliers
  involve a picker.

`SoundCloudSupplier` is the sole adapter for now — a Direct Supplier wrapping
today's `DownloadableSource.download` unchanged. The Soulseek adapter (a
`SearchSupplier` over slskd's REST API) arrives in a later slice.
"""

from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Protocol, runtime_checkable


@runtime_checkable
class Supplier(Protocol):
    """A place manadj can obtain audio from.

    The base protocol is download-only: given the address the Source Item
    already carries, fetch the audio to `dest_dir` as `basename.<ext>` and
    return the resulting path. This is exactly the download-only seam the
    task chain has always consumed; a Direct Supplier needs nothing more.
    """

    def download(self, permalink_url: str, dest_dir: Path, basename: str) -> Path:
        """Download the audio to dest_dir as `basename.<ext>`; return the path."""
        ...


@dataclass(frozen=True)
class SupplierSearchResult:
    """One candidate file a Search Supplier offers for a query.

    Enough for the picker (PRD story 4): filename, format/bitrate/size, the
    candidate's own duration (for the delta against the item), and peer queue
    state. `download_token` is the opaque address the Supplier needs back to
    fetch this exact candidate — a Search Supplier's Source Item has no
    address of its own, so the pick carries one.
    """

    download_token: str
    filename: str
    format: str
    bitrate_kbps: int | None
    size_bytes: int | None
    duration_ms: int | None
    queue_length: int | None


class TransferState(Enum):
    """Where a Search Supplier's picked transfer stands, polled per tick.

    The download task advances through these without blocking waits: a pick
    starts QUEUED, becomes IN_PROGRESS once a peer slot frees, then COMPLETED
    (the file is on disk) or FAILED (the peer/transfer gave up). TTL expiry is
    the task's concern, not the Supplier's.
    """

    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass(frozen=True)
class TransferStatus:
    """A poll of a picked transfer: its state and (once done) the file path."""

    state: TransferState
    local_path: Path | None = None


@runtime_checkable
class SearchSupplier(Supplier, Protocol):
    """A Supplier that finds candidates by search and polls their transfers.

    Extends the base with the two things a Direct Supplier lacks: searching
    for candidates, and asking a peer for a picked candidate then polling the
    resulting transfer to completion. Only Search Suppliers reach the picker.
    """

    def search(self, query: str) -> list[SupplierSearchResult]:
        """Return candidate files matching the query."""
        ...

    def request(self, result: SupplierSearchResult, dest_dir: Path, basename: str) -> str:
        """Ask a peer for a picked candidate; return a transfer id to poll."""
        ...

    def transfer_status(self, transfer_id: str) -> TransferStatus:
        """Poll a requested transfer's current state (no blocking wait)."""
        ...


class SoundCloudSupplier:
    """Direct Supplier adapter: wraps a `DownloadableSource`'s download.

    SoundCloud is a Direct Supplier — the Source Item's permalink addresses
    the audio — so this adapter implements only the base `Supplier` protocol
    and delegates straight to today's download behavior. No search, no
    transfer-state, no lying no-ops.
    """

    def __init__(self, source: "_DownloadableSource") -> None:
        self._source = source

    def download(self, permalink_url: str, dest_dir: Path, basename: str) -> Path:
        return self._source.download(permalink_url, dest_dir, basename)


class _DownloadableSource(Protocol):
    """The download-only capability `SoundCloudSupplier` wraps (e.g. SoundCloudSource)."""

    def download(self, permalink_url: str, dest_dir: Path, basename: str) -> Path: ...
