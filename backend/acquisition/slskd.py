"""The Soulseek Supplier: a thin client for a local slskd daemon's REST API.

manadj does no P2P itself — slskd (launchd-managed, see README "Soulseek
Supplier (slskd)") holds the network connection and stages downloads in its
own directory; this adapter implements the `SearchSupplier` seam over its
HTTP API. Deliberately thin and untested (ADR-0004 deferral: external system,
no fixtures worth committing) — live verification is the check.

Identifier plumbing: slskd addresses a remote file by (username, filename,
size). `SupplierSearchResult.download_token` and the transfer id are JSON
blobs of those fields, opaque to everything but this module.
"""

import json
import logging
import time
from pathlib import Path
from typing import Any

import requests

from .supplier import SupplierSearchResult, TransferState, TransferStatus

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT_SECS = 30
# slskd searches are async server-side, and /searches/{id}/responses stays
# EMPTY until the search completes (observed live) — so ask slskd for a
# bounded search and wait it out. Completion overshoots searchTimeout by a
# few seconds; responses can lag completion by another beat.
SEARCH_TIMEOUT_MS = 8_000
SEARCH_WAIT_SECS = 20.0
SEARCH_POLL_SECS = 0.5
RESPONSES_GRACE_SECS = 5.0

# slskd TransferStates are flag-style strings like "Completed, Succeeded".
_FAILED_FLAGS = ("errored", "cancelled", "rejected", "timedout", "aborted")


class SlskdSupplier:
    """Search Supplier over slskd's REST API (localhost daemon)."""

    def __init__(self, base_url: str, api_key: str) -> None:
        self._base = base_url.rstrip("/") + "/api/v0"
        self._session = requests.Session()
        self._session.headers["X-API-Key"] = api_key
        self._downloads_dir: Path | None = None

    def _get(self, path: str) -> Any:
        resp = self._session.get(self._base + path, timeout=REQUEST_TIMEOUT_SECS)
        resp.raise_for_status()
        return resp.json()

    def _post(self, path: str, body: Any) -> Any:
        resp = self._session.post(self._base + path, json=body, timeout=REQUEST_TIMEOUT_SECS)
        resp.raise_for_status()
        return resp.json() if resp.content else None

    # Supplier ------------------------------------------------------------
    def download(self, permalink_url: str, dest_dir: Path, basename: str) -> Path:
        raise NotImplementedError(
            "Soulseek is a Search Supplier: pick a search result instead of "
            "downloading by address"
        )

    # SearchSupplier -------------------------------------------------------
    def search(self, query: str) -> list[SupplierSearchResult]:
        search = self._post(
            "/searches", {"searchText": query, "searchTimeout": SEARCH_TIMEOUT_MS}
        )
        search_id = search["id"]
        deadline = time.monotonic() + SEARCH_WAIT_SECS
        file_count = 0
        while time.monotonic() < deadline:
            detail = self._get(f"/searches/{search_id}")
            file_count = int(detail.get("fileCount") or 0)
            if "Completed" in str(detail.get("state", "")):
                break
            time.sleep(SEARCH_POLL_SECS)
        responses = self._get(f"/searches/{search_id}/responses")
        # responses persist a beat after completion; if the search saw files,
        # give them a moment to materialize
        grace = time.monotonic() + RESPONSES_GRACE_SECS
        while not responses and file_count > 0 and time.monotonic() < grace:
            time.sleep(SEARCH_POLL_SECS)
            responses = self._get(f"/searches/{search_id}/responses")

        results: list[SupplierSearchResult] = []
        for resp in responses:
            username = resp.get("username", "")
            queue = resp.get("queueLength")
            for f in resp.get("files", []):
                filename = f.get("filename", "")
                size = f.get("size")
                length_secs = f.get("length")
                results.append(
                    SupplierSearchResult(
                        download_token=json.dumps(
                            {"username": username, "filename": filename, "size": size}
                        ),
                        filename=filename,
                        format=Path(filename.replace("\\", "/")).suffix.lstrip(".").lower(),
                        bitrate_kbps=f.get("bitRate"),
                        size_bytes=size,
                        duration_ms=length_secs * 1000 if length_secs else None,
                        queue_length=queue,
                    )
                )
        logger.info("slskd search %r: %d candidate files", query, len(results))
        return results

    def request(self, result: SupplierSearchResult) -> str:
        token = json.loads(result.download_token)
        username, filename, size = token["username"], token["filename"], token["size"]
        try:
            self._post(
                f"/transfers/downloads/{username}",
                [{"filename": filename, "size": size}],
            )
        except requests.HTTPError:
            # a transfer for this exact file may already exist (a previous
            # pick's attempt) — polling it is as good as a fresh request
            if self._find_transfer(username, filename) is None:
                raise
            logger.info("slskd already has a transfer for %s from %s", filename, username)
        else:
            logger.info("slskd download requested: %s from %s", filename, username)
        return json.dumps({"username": username, "filename": filename})

    def transfer_status(self, transfer_id: str) -> TransferStatus:
        ref = json.loads(transfer_id)
        username, filename = ref["username"], ref["filename"]
        entry = self._find_transfer(username, filename)
        if entry is None:
            # slskd lost/expired the transfer — treat as failed, the operator
            # searches and picks again
            return TransferStatus(state=TransferState.FAILED)
        state = str(entry.get("state", "")).lower()
        if "completed" in state:
            if "succeeded" in state:
                return TransferStatus(
                    state=TransferState.COMPLETED,
                    local_path=self._completed_local_path(entry),
                )
            return TransferStatus(state=TransferState.FAILED)
        if any(flag in state for flag in _FAILED_FLAGS):
            return TransferStatus(state=TransferState.FAILED)
        if "inprogress" in state:
            return TransferStatus(state=TransferState.IN_PROGRESS)
        return TransferStatus(state=TransferState.QUEUED)

    def _completed_local_path(self, entry: dict[str, Any]) -> Path | None:
        """Where slskd put a completed download.

        slskd's transfer records carry no local path (verified live against
        0.25.1), but it saves completed files to
        `<downloads>/<remote parent dir name>/<basename>` and reports its
        downloads directory on /options — so no manadj-side staging config.
        """
        local = entry.get("localFilename")  # future-proof: not in 0.25.1
        if local:
            return Path(local)
        parts = str(entry.get("filename", "")).replace("\\", "/").split("/")
        basename = parts[-1] if parts else ""
        if not basename:
            return None
        downloads = self._get_downloads_dir()
        candidates = [downloads / parts[-2] / basename] if len(parts) >= 2 else []
        candidates.append(downloads / basename)
        for candidate in candidates:
            if candidate.exists():
                return candidate
        logger.warning(
            "completed slskd transfer not found on disk (looked at %s)",
            ", ".join(str(c) for c in candidates),
        )
        return None

    def _get_downloads_dir(self) -> Path:
        if self._downloads_dir is None:
            options = self._get("/options")
            self._downloads_dir = Path(options["directories"]["downloads"])
        return self._downloads_dir

    def _find_transfer(self, username: str, filename: str) -> dict[str, Any] | None:
        """The latest transfer for (username, filename), if any."""
        try:
            user = self._get(f"/transfers/downloads/{requests.utils.quote(username)}")
        except requests.HTTPError as e:
            if e.response is not None and e.response.status_code == 404:
                return None
            raise
        matches = [
            f
            for directory in user.get("directories", [])
            for f in directory.get("files", [])
            if f.get("filename") == filename
        ]
        if not matches:
            return None
        return max(matches, key=lambda f: str(f.get("requestedAt") or ""))
