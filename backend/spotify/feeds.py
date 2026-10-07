"""Spotify Feeds (#347): Liked Songs and the user's playlists, read live.

A Feed is browsed, not persisted: rows become Source Items only when the user
wants them (POST /api/acquisition/want). Responses are cached briefly so
paging back and forth and the want lookup don't re-spend the Development
Mode quota.

Shapes follow the Web API after the February 2026 changes: playlists carry
`items.total` (formerly `tracks.total`), playlist entries carry `item`
(formerly `track`), and playlist contents are only readable for playlists
the user owns or collaborates on (others 403) — such Feeds are listed with
readable=False.
"""

from __future__ import annotations

import threading
import unicodedata
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from .connection import SpotifyConnection, SpotifyError

LIKED_FEED_ID = "liked"
PLAYLIST_PREFIX = "playlist:"
PAGE_MAX = 50  # Spotify's per-request cap
# A feed is loaded whole (every Spotify page) and cached, so sorting and
# filtering see all 3k+ tracks, not the first 50 (gh#342). Whole-feed loads
# are the expensive call, so they live longer than the feed list.
FEED_TTL_SECS = 600.0
CACHE_TTL_SECS = 600.0  # the feed list samples every feed's last page
SERVE_MAX = 100_000  # the router pages; this is the cached-feed slice cap
FETCH_WORKERS = 4
SORT_KEYS = ("feed", "added", "title", "artist", "length")


@dataclass(frozen=True)
class Feed:
    id: str
    kind: str  # "liked" | "playlist"
    name: str
    track_count: int
    readable: bool
    url: str | None = None
    image_url: str | None = None
    owner: str | None = None
    # when the feed last gained a track (newest added_at on its last page):
    # Spotify exposes no modified time, and playlists append at the end
    last_added_at: str | None = None


@dataclass(frozen=True)
class FeedTrack:
    spotify_id: str
    title: str
    artists: list[str]
    album: str | None
    duration_ms: int
    url: str
    isrc: str | None
    added_at: str | None = None

    @property
    def uploader(self) -> str:
        """Source Item `uploader`: the credited artists."""
        return ", ".join(self.artists)


@dataclass(frozen=True)
class FeedPage:
    feed_id: str
    # rows matching the query (what offset/limit page over)
    total: int
    offset: int
    limit: int
    tracks: list[FeedTrack] = field(default_factory=list)
    # every track in the feed as Spotify counts it (incl. local files/episodes)
    feed_total: int = 0

    @property
    def next_offset(self) -> int | None:
        nxt = self.offset + self.limit
        return nxt if nxt < self.total else None


def parse_track(obj: dict[str, Any] | None, added_at: str | None = None) -> FeedTrack | None:
    """A Web API TrackObject -> FeedTrack; None for episodes/local files/unavailable."""
    if not obj or obj.get("type", "track") != "track" or obj.get("is_local") or not obj.get("id"):
        return None
    spotify_id = str(obj["id"])
    album = obj.get("album") or {}
    urls = obj.get("external_urls") or {}
    ids = obj.get("external_ids") or {}
    return FeedTrack(
        spotify_id=spotify_id,
        title=str(obj.get("name") or ""),
        artists=[str(a.get("name")) for a in obj.get("artists") or [] if a.get("name")],
        album=album.get("name"),
        duration_ms=int(obj.get("duration_ms") or 0),
        url=str(urls.get("spotify") or f"https://open.spotify.com/track/{spotify_id}"),
        isrc=ids.get("isrc"),
        added_at=added_at,
    )


def _count(playlist: dict[str, Any]) -> int:
    for key in ("items", "tracks"):
        sub = playlist.get(key)
        if isinstance(sub, dict) and sub.get("total") is not None:
            return int(sub["total"])
    return 0


def _norm(text: str) -> str:
    return unicodedata.normalize("NFKD", text).casefold()


def filter_tracks(tracks: list[FeedTrack], query: str) -> list[FeedTrack]:
    """Every whitespace term must appear in title, an artist, or the album."""
    terms = [t for t in _norm(query).split() if t]
    if not terms:
        return tracks
    out = []
    for t in tracks:
        hay = _norm(" ".join([t.title, *t.artists, t.album or ""]))
        if all(term in hay for term in terms):
            out.append(t)
    return out


def sort_tracks(tracks: list[FeedTrack], sort: str, desc: bool) -> list[FeedTrack]:
    """Stable sort by a SORT_KEYS key; "feed" keeps Spotify's order (reversed
    when desc). Missing added_at sorts last either way."""
    if sort == "feed":
        return list(reversed(tracks)) if desc else list(tracks)
    if sort == "added":
        present = [t for t in tracks if t.added_at]
        missing = [t for t in tracks if not t.added_at]
        return sorted(present, key=lambda t: t.added_at or "", reverse=desc) + missing
    if sort == "title":
        key = lambda t: _norm(t.title)  # noqa: E731
    elif sort == "artist":
        key = lambda t: (_norm(", ".join(t.artists)), _norm(t.title))  # noqa: E731
    else:  # length
        key = lambda t: t.duration_ms  # noqa: E731
    return sorted(tracks, key=key, reverse=desc)


class SpotifyFeeds:
    """Feed listing and paging over a SpotifyConnection, with a TTL cache."""

    def __init__(
        self,
        conn: SpotifyConnection,
        ttl: float = CACHE_TTL_SECS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.conn = conn
        self.ttl = ttl
        self._clock = clock
        self._lock = threading.Lock()
        self._cache: dict[Any, tuple[float, Any]] = {}
        self._tracks: dict[str, FeedTrack] = {}  # spotify_id -> last seen row
        self._generation = conn.generation

    def _cached(
        self, key: Any, fetch: Callable[[], Any], fresh: bool = False, ttl: float | None = None
    ) -> Any:
        now = self._clock()
        with self._lock:
            if self._generation != self.conn.generation:  # signed in/out since
                self._cache.clear()
                self._tracks.clear()
                self._generation = self.conn.generation
            hit = self._cache.get(key)
        if hit and not fresh and now - hit[0] < (ttl if ttl is not None else self.ttl):
            return hit[1]
        value = fetch()
        with self._lock:
            self._cache[key] = (now, value)
        return value

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()
            self._tracks.clear()

    def feeds(self, fresh: bool = False) -> list[Feed]:
        feeds: list[Feed] = self._cached("feeds", self._fetch_feeds, fresh)
        return feeds

    def _fetch_feeds(self) -> list[Feed]:
        me = self.conn.account()
        liked = self.conn.get("/me/tracks", {"limit": 1})
        feeds = [
            Feed(
                id=LIKED_FEED_ID,
                kind="liked",
                name="Liked Songs",
                track_count=int(liked.get("total") or 0),
                readable=True,
                url="https://open.spotify.com/collection/tracks",
            )
        ]
        url: str | None = "/me/playlists"
        params: dict[str, Any] | None = {"limit": PAGE_MAX}
        while url:
            page = self.conn.get(url, params)
            for pl in page.get("items") or []:
                if not pl or not pl.get("id"):
                    continue
                owner = pl.get("owner") or {}
                images = pl.get("images") or []
                feeds.append(
                    Feed(
                        id=f"{PLAYLIST_PREFIX}{pl['id']}",
                        kind="playlist",
                        name=str(pl.get("name") or ""),
                        track_count=_count(pl),
                        readable=bool(pl.get("collaborative")) or owner.get("id") == me.id,
                        url=(pl.get("external_urls") or {}).get("spotify"),
                        image_url=images[0].get("url") if images else None,
                        owner=owner.get("display_name") or owner.get("id"),
                    )
                )
            url, params = page.get("next"), None
        return self._with_last_added(feeds)

    def _with_last_added(self, feeds: list[Feed]) -> list[Feed]:
        """Sample each readable feed's last page for its newest added_at
        (one request per feed, pooled) so the rail can sort by activity."""
        from concurrent.futures import ThreadPoolExecutor
        from dataclasses import replace

        def last_added(feed: Feed) -> str | None:
            if not feed.readable or feed.track_count <= 0:
                return None
            try:
                page = self._fetch_page(feed.id, max(0, feed.track_count - PAGE_MAX), PAGE_MAX)
            except SpotifyError:
                return None
            stamps = [t.added_at for t in page.tracks if t.added_at]
            return max(stamps) if stamps else None

        with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
            stamps = list(pool.map(last_added, feeds))
        return [replace(f, last_added_at=st) for f, st in zip(feeds, stamps)]

    def page(
        self,
        feed_id: str,
        offset: int = 0,
        limit: int = PAGE_MAX,
        fresh: bool = False,
        sort: str = "feed",
        desc: bool = False,
        query: str = "",
    ) -> FeedPage:
        """A page of the whole feed after filter + sort (server-side, so
        "latest 50 of 3k" is the latest 50, not the first page's latest)."""
        limit = max(1, min(limit, SERVE_MAX))
        offset = max(0, offset)
        if sort not in SORT_KEYS:
            raise SpotifyError(f"unknown sort {sort!r}", 422)
        feed_total, tracks = self.all_tracks(feed_id, fresh)
        rows = filter_tracks(tracks, query)
        rows = sort_tracks(rows, sort, desc)
        return FeedPage(
            feed_id=feed_id,
            total=len(rows),
            offset=offset,
            limit=limit,
            tracks=rows[offset : offset + limit],
            feed_total=feed_total,
        )

    def all_tracks(self, feed_id: str, fresh: bool = False) -> tuple[int, list[FeedTrack]]:
        """(Spotify's total, every parseable track) for a feed, cached."""
        result: tuple[int, list[FeedTrack]] = self._cached(
            ("feed", feed_id), lambda: self._fetch_all(feed_id), fresh, ttl=FEED_TTL_SECS
        )
        with self._lock:
            for t in result[1]:
                self._tracks[t.spotify_id] = t
        return result

    def _fetch_all(self, feed_id: str) -> tuple[int, list[FeedTrack]]:
        """Every page of a feed: the first page serially (learns the total),
        the rest through a small pool — a 3k-track feed is ~70 requests."""
        first = self._fetch_page(feed_id, 0, PAGE_MAX)
        total = first.total
        offsets = list(range(PAGE_MAX, total, PAGE_MAX))
        pages: dict[int, FeedPage] = {0: first}
        if offsets:
            from concurrent.futures import ThreadPoolExecutor

            with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
                for page in pool.map(lambda off: self._fetch_page(feed_id, off, PAGE_MAX), offsets):
                    pages[page.offset] = page
        tracks = [t for off in sorted(pages) for t in pages[off].tracks]
        return total, tracks

    def _fetch_page(self, feed_id: str, offset: int, limit: int) -> FeedPage:
        params = {"offset": offset, "limit": limit}
        if feed_id == LIKED_FEED_ID:
            body = self.conn.get("/me/tracks", params)
            tracks = [parse_track(e.get("track"), e.get("added_at")) for e in body.get("items") or []]
        elif feed_id.startswith(PLAYLIST_PREFIX):
            playlist_id = feed_id[len(PLAYLIST_PREFIX):]
            body = self.conn.get(f"/playlists/{playlist_id}/items", {**params, "additional_types": "track"})
            tracks = [
                parse_track(e.get("item") or e.get("track"), e.get("added_at"))
                for e in body.get("items") or []
            ]
        else:
            raise SpotifyError(f"unknown feed {feed_id!r}", 404)
        return FeedPage(
            feed_id=feed_id,
            total=int(body.get("total") or 0),
            offset=offset,
            limit=limit,
            tracks=[t for t in tracks if t is not None],
        )

    def track(self, spotify_id: str) -> FeedTrack:
        """A track's metadata: the last feed row seen, else GET /tracks/{id}."""
        with self._lock:
            hit = self._tracks.get(spotify_id)
        if hit is not None:
            return hit
        track = parse_track(self.conn.get(f"/tracks/{spotify_id}"))
        if track is None:
            raise SpotifyError(f"Spotify item {spotify_id} isn't a track", 404)
        return track


_feeds: SpotifyFeeds | None = None
_feeds_lock = threading.Lock()


def get_feeds() -> SpotifyFeeds:
    from .connection import get_connection

    global _feeds
    conn = get_connection()
    with _feeds_lock:
        if _feeds is None or _feeds.conn is not conn:
            _feeds = SpotifyFeeds(conn)
        return _feeds
