"""The Source boundary: the feature's single seam.

A Source lists items available for acquisition (metadata only). The real
implementation talks to SoundCloud's API v2; tests substitute a fake.
See .scratch/soundcloud-acquisition/issues/01-investigate-likes-scanning.md
for why API v2 (not yt-dlp) is used for enumeration.
"""

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, cast

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
    """The Source rejected a request for exceeding its rate budget (HTTP 429).

    Distinct from a permanent failure: the task system defers and retries the
    work instead of marking it `failed` (acquisition issue 08). SoundCloud's
    budget is ~600 requests / 10 min; a bulk catch-up trips it.
    """


def is_rate_limit(error: BaseException) -> bool:
    """True if a yt-dlp / requests error indicates HTTP 429 (Too Many Requests).

    yt-dlp surfaces the upstream status only in the message text, so we sniff
    both the numeric code and the phrase.
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
    """A place tracks are acquired from."""

    def list_items(self) -> list[SourceItemData]:
        """Return all items (e.g. likes) currently on the Source."""
        ...

    def download(self, permalink_url: str, dest_dir: Path, basename: str) -> Path:
        """Download an item's audio to dest_dir as `basename.<ext>`; return the path."""
        ...


class SoundCloudSource:
    """SoundCloud likes via API v2, downloads via yt-dlp; personal OAuth token."""

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

    def download(self, permalink_url: str, dest_dir: Path, basename: str) -> Path:
        """Download best non-opus audio via yt-dlp (the user's proven incantation).

        A 429 surfaces as RateLimitedError so the task system can defer rather
        than fast-fail (issue 08). extractor_retries + exponential
        retry_sleep_functions absorb transient blips before that point.
        """
        from yt_dlp import YoutubeDL  # heavy import, keep it out of module load
        from yt_dlp.utils import DownloadError

        options = {
            "format": "ba[acodec!=opus]/ba",
            "outtmpl": str(dest_dir / f"{basename}.%(ext)s"),
            "username": "oauth",
            "password": self._oauth_token,
            "quiet": True,
            "noprogress": True,
            # transient-blip absorption (issue 08)
            "extractor_retries": 5,
            "retry_sleep_functions": {
                "http": lambda n: min(2 ** n, 60),
                "extractor": lambda n: min(2 ** n, 60),
            },
        }
        try:
            with YoutubeDL(cast(Any, options)) as ydl:
                info = cast(
                    "dict[str, Any] | None", ydl.extract_info(permalink_url, download=True)
                )
        except DownloadError as e:
            if is_rate_limit(e):
                raise RateLimitedError(str(e)) from e
            raise
        if info is None:
            raise RuntimeError(f"yt-dlp returned no info for {permalink_url}")
        downloads: list[dict[str, Any]] = info.get("requested_downloads") or []
        if not downloads or not downloads[0].get("filepath"):
            raise RuntimeError(f"yt-dlp reported no downloaded file for {permalink_url}")
        return Path(downloads[0]["filepath"])
