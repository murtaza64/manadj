"""The Source boundary: the wishlist feature's single seam.

A Source lists items that are wanted (metadata only) — SoundCloud likes
today. manadj never downloads audio from a Source: acquisition is the
user's own (Beatport, free sources, files they already own), and a Source
Item is a wishlist entry pointing at a legit way to get the track. The real
implementation talks to SoundCloud's API v2; tests substitute a fake. See
.scratch/soundcloud-acquisition/issues/01-investigate-likes-scanning.md
for why API v2 (not yt-dlp) is used for enumeration.
"""

import logging
from dataclasses import dataclass
from typing import Any, Protocol

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)

API_BASE = "https://api-v2.soundcloud.com"
PAGE_SIZE = 200
REQUEST_TIMEOUT_SECS = 30
# api-v2 returns 403 for the default python-requests user agent
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


class RateLimitedError(Exception):
    """A service rejected a request for exceeding its rate budget (HTTP 429).

    Distinct from a permanent failure: the task system defers and retries the
    work instead of marking it `failed` (acquisition issue 08). SoundCloud's
    budget is ~600 requests / 10 min.
    """


def is_rate_limit(error: BaseException) -> bool:
    """True if an error indicates HTTP 429 (Too Many Requests).

    Upstream libraries often surface the status only in the message text, so
    we sniff both the numeric code and the phrase.
    """
    text = str(error).lower()
    return "429" in text or "too many requests" in text


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
    """A place wanted tracks are discovered (the wishlist's demand side)."""

    def list_items(self) -> list[SourceItemData]:
        """Return all items (e.g. likes) currently on the Source."""
        ...


class SoundCloudSource:
    """SoundCloud likes via API v2; personal OAuth token."""

    def __init__(self, oauth_token: str) -> None:
        self._oauth_token = oauth_token
        self._session = requests.Session()
        self._session.headers["Authorization"] = f"OAuth {oauth_token}"
        self._session.headers["User-Agent"] = USER_AGENT
        # Refresh resilience (issue 08): transparently retry transient 429s
        # during likes listing, honouring the server's Retry-After header.
        retry = Retry(
            total=5,
            status_forcelist=(429,),
            backoff_factor=1.0,  # 0, 1, 2, 4, 8 s (exponential)
            respect_retry_after_header=True,
            allowed_methods=frozenset({"GET"}),
        )
        adapter = HTTPAdapter(max_retries=retry)
        self._session.mount("https://", adapter)
        self._session.mount("http://", adapter)

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