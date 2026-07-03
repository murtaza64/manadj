"""The Source boundary: the feature's single seam.

A Source lists items available for acquisition (metadata only). The real
implementation talks to SoundCloud's API v2; tests substitute a fake.
See .scratch/soundcloud-acquisition/issues/01-investigate-likes-scanning.md
for why API v2 (not yt-dlp) is used for enumeration.
"""

import logging
from dataclasses import dataclass
from typing import Any, Protocol

import requests

logger = logging.getLogger(__name__)

API_BASE = "https://api-v2.soundcloud.com"
PAGE_SIZE = 200
REQUEST_TIMEOUT_SECS = 30
# api-v2 returns 403 for the default python-requests user agent
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


@dataclass(frozen=True)
class SourceItemData:
    """Metadata for one item on a Source."""

    external_id: str
    title: str
    uploader: str
    duration_ms: int
    permalink_url: str
    liked_at: str | None


class Source(Protocol):
    """A place tracks are acquired from."""

    def list_items(self) -> list[SourceItemData]:
        """Return all items (e.g. likes) currently on the Source."""
        ...


class SoundCloudSource:
    """SoundCloud likes via API v2, authenticated with a personal OAuth token."""

    def __init__(self, oauth_token: str) -> None:
        self._session = requests.Session()
        self._session.headers["Authorization"] = f"OAuth {oauth_token}"
        self._session.headers["User-Agent"] = USER_AGENT

    def _get(self, url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        resp = self._session.get(url, params=params, timeout=REQUEST_TIMEOUT_SECS)
        resp.raise_for_status()
        data: dict[str, Any] = resp.json()
        return data

    def _user_id(self) -> int:
        me = self._get(f"{API_BASE}/me")
        return int(me["id"])

    def list_items(self) -> list[SourceItemData]:
        user_id = self._user_id()
        items: list[SourceItemData] = []
        url: str | None = f"{API_BASE}/users/{user_id}/track_likes"
        params: dict[str, Any] | None = {"limit": PAGE_SIZE}
        while url:
            page = self._get(url, params=params)
            params = None  # next_href already carries the query string
            for entry in page.get("collection", []):
                track = entry.get("track")
                if not track:  # non-track likes (playlists etc.)
                    continue
                items.append(
                    SourceItemData(
                        external_id=str(track["id"]),
                        title=track.get("title") or "",
                        uploader=(track.get("user") or {}).get("username") or "",
                        duration_ms=int(track.get("full_duration") or track.get("duration") or 0),
                        permalink_url=track.get("permalink_url") or "",
                        liked_at=entry.get("created_at"),
                    )
                )
            url = page.get("next_href")
        logger.info("SoundCloud: listed %d liked tracks", len(items))
        return items
