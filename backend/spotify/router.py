"""Spotify API (#347).

/api/spotify:
GET    /status          state (no_client|disconnected|connected|reconnect), account
PUT    /client          store the Spotify app's Client ID
DELETE /client          forget Client ID + refresh token
POST   /connect         start PKCE sign-in -> {authorize_url} (the redirect
                        lands on loopback.py's fixed-port listener)
DELETE /token           disconnect (forget the refresh token)
GET    /feeds           Liked Songs + playlists, with counts
GET    /feeds/{id}      a page of a Feed, rows annotated with library matches
                        and existing Source Items

/api/acquisition (want_router):
POST   /want            Source Item for a Spotify track (source="spotify")
"""

from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..acquisition.classification import classify
from ..acquisition.manager import get_correspondence, run_matching
from ..acquisition.matching import LibraryIndex, LibraryTrack, MatchingConfig
from ..acquisition.models import SourceItem
from ..acquisition.router import (
    CorrespondenceInfo,
    DownloadStatus,
    ProvenanceInfo,
    SourceItemResponse,
    get_soulseek_supplier,
    item_responses,
)
from ..acquisition.searches import enqueue_soulseek_search
from ..acquisition.supplier import SearchSupplier
from ..config import get_config
from ..database import get_db
from ..models import Track
from .connection import (
    SCOPES,
    NeedsReconnect,
    SpotifyConnection,
    SpotifyError,
    get_connection,
)
from .feeds import PAGE_MAX, Feed, FeedTrack, SpotifyFeeds, get_feeds

logger = logging.getLogger(__name__)

router = APIRouter()
want_router = APIRouter()

SOURCE_NAME = "spotify"


def _raise(e: SpotifyError) -> HTTPException:
    return HTTPException(status_code=e.status, detail=str(e))


# -- connection --------------------------------------------------------------


class AccountOut(BaseModel):
    id: str
    display_name: str


class SpotifyStatus(BaseModel):
    state: Literal["no_client", "disconnected", "connected", "reconnect"]
    client_id: str | None
    # register this in the Spotify dashboard (fixed loopback port)
    redirect_uri: str
    scopes: list[str]
    account: AccountOut | None
    error: str | None


def _status(conn: SpotifyConnection, fresh: bool = False) -> SpotifyStatus:
    account: AccountOut | None = None
    error: str | None = None
    if conn.state() == "connected":
        try:
            a = conn.account(fresh=fresh)
            account = AccountOut(id=a.id, display_name=a.display_name)
        except NeedsReconnect:
            pass  # state() now says reconnect
        except SpotifyError as e:
            error = str(e)
    state = conn.state()
    if state == "reconnect":
        error = conn.reconnect_reason
    return SpotifyStatus(
        state=state,
        client_id=conn.client_id,
        redirect_uri=conn.redirect_uri(),
        scopes=list(SCOPES),
        account=account,
        error=error,
    )


@router.get("/status", response_model=SpotifyStatus)
def get_status(
    fresh: bool = False, conn: SpotifyConnection = Depends(get_connection)
) -> SpotifyStatus:
    return _status(conn, fresh)


class ClientIn(BaseModel):
    client_id: str = Field(min_length=1, max_length=128, pattern=r"^\s*[A-Za-z0-9]+\s*$")


@router.put("/client", response_model=SpotifyStatus)
def put_client(
    body: ClientIn,
    conn: SpotifyConnection = Depends(get_connection),
    feeds: SpotifyFeeds = Depends(get_feeds),
) -> SpotifyStatus:
    conn.set_client_id(body.client_id)
    feeds.clear()
    return _status(conn)


@router.delete("/client", response_model=SpotifyStatus)
def delete_client(
    conn: SpotifyConnection = Depends(get_connection),
    feeds: SpotifyFeeds = Depends(get_feeds),
) -> SpotifyStatus:
    conn.forget_client()
    feeds.clear()
    return _status(conn)


@router.delete("/token", response_model=SpotifyStatus)
def delete_token(
    conn: SpotifyConnection = Depends(get_connection),
    feeds: SpotifyFeeds = Depends(get_feeds),
) -> SpotifyStatus:
    conn.disconnect()
    feeds.clear()
    return _status(conn)


class ConnectOut(BaseModel):
    authorize_url: str
    redirect_uri: str


@router.post("/connect", response_model=ConnectOut)
def connect(conn: SpotifyConnection = Depends(get_connection)) -> ConnectOut:
    try:
        url = conn.begin()
        return ConnectOut(authorize_url=url, redirect_uri=conn.redirect_uri())
    except SpotifyError as e:
        raise _raise(e)


# -- feeds -------------------------------------------------------------------


class FeedOut(BaseModel):
    id: str
    kind: Literal["liked", "playlist"]
    name: str
    track_count: int
    # Development Mode only returns contents of playlists you own/collaborate on
    readable: bool
    url: str | None
    image_url: str | None
    owner: str | None
    # newest added_at sampled from the feed's last page (sort-by-activity)
    last_added_at: str | None = None


@router.get("/feeds", response_model=list[FeedOut])
def list_feeds(fresh: bool = False, feeds: SpotifyFeeds = Depends(get_feeds)) -> list[FeedOut]:
    try:
        return [FeedOut(**vars(f)) for f in feeds.feeds(fresh)]
    except SpotifyError as e:
        raise _raise(e)


class LibraryMatchOut(BaseModel):
    track_id: int
    title: str | None
    artist: str | None
    duration_secs: float | None
    score: float | None
    # match = confirmed/auto-confirmable; probable = needs review
    confidence: Literal["match", "probable"]
    # True when it comes from the Source Item's Source Correspondence
    linked: bool


class FeedRowOut(BaseModel):
    spotify_id: str
    title: str
    artists: list[str]
    album: str | None
    duration_ms: int
    url: str
    isrc: str | None
    added_at: str | None
    library: LibraryMatchOut | None
    source_item: SourceItemResponse | None


class FeedPageOut(BaseModel):
    feed: FeedOut | None
    feed_id: str
    total: int
    offset: int
    limit: int
    next_offset: int | None
    # Spotify's own count for the feed (incl. rows manadj drops)
    feed_total: int = 0
    # category sizes over the whole (query-filtered) feed
    counts: dict[str, int] = {}
    rows: list[FeedRowOut]


def library_index(db: Session) -> LibraryIndex:
    rows = db.query(Track.id, Track.title, Track.artist, Track.filename, Track.duration_secs).all()
    return LibraryIndex(
        [LibraryTrack(r[0], r[1], r[2], str(r[3]), r[4]) for r in rows], MatchingConfig()
    )


def annotate(db: Session, tracks: list[FeedTrack]) -> list[FeedRowOut]:
    """Feed rows + in-library detection + existing Source Items."""
    ids = [t.spotify_id for t in tracks]
    items = (
        db.query(SourceItem)
        .filter(SourceItem.source == SOURCE_NAME, SourceItem.external_id.in_(ids))
        .all()
        if ids
        else []
    )
    by_external = {r.external_id: r for r in item_responses(db, items)}
    index = library_index(db)
    rows = []
    for t in tracks:
        item = by_external.get(t.spotify_id)
        library: LibraryMatchOut | None = None
        if item is not None and item.correspondence is not None:
            c = item.correspondence
            library = LibraryMatchOut(
                track_id=c.track_id,
                title=c.track_title,
                artist=c.track_artist,
                duration_secs=c.track_duration_secs,
                score=c.score,
                confidence="match" if c.status == "confirmed" else "probable",
                linked=True,
            )
        else:
            m = index.best(t.title, [t.uploader, *t.artists[:1]], t.duration_ms)
            if m is not None:
                library = LibraryMatchOut(
                    track_id=m.track.track_id,
                    title=m.track.title,
                    artist=m.track.artist,
                    duration_secs=m.track.duration_secs,
                    score=round(m.score, 3),
                    confidence="match" if m.confidence == "match" else "probable",
                    linked=False,
                )
        rows.append(
            FeedRowOut(
                spotify_id=t.spotify_id,
                title=t.title,
                artists=t.artists,
                album=t.album,
                duration_ms=t.duration_ms,
                url=t.url,
                isrc=t.isrc,
                added_at=t.added_at,
                library=library,
                source_item=item,
            )
        )
    return rows


@router.get("/feeds/{feed_id}", response_model=FeedPageOut)
def get_feed_page(
    feed_id: str,
    offset: int = 0,
    limit: int = PAGE_MAX,
    fresh: bool = False,
    sort: str = "feed",
    dir: str = "asc",
    q: str = "",
    status: str = "all",
    db: Session = Depends(get_db),
    feeds: SpotifyFeeds = Depends(get_feeds),
) -> FeedPageOut:
    """A page of a feed after server-side filter (`q`: every term in title /
    artist / album; `status`: all | open (not in the library, not wanted) |
    wanted (a Source Item) | library (matched or fulfilled)) and sort
    (`sort`: feed|added|title|artist|length, `dir`: asc|desc). The whole feed
    is loaded and cached behind this (gh#342), so `limit` may go up to 500."""
    if status not in FEED_STATUSES:
        raise HTTPException(status_code=422, detail=f"unknown status {status!r}")
    try:
        # page over everything so the status filter (which needs library
        # detection) sees the whole feed; the slice happens after
        whole = feeds.page(feed_id, 0, SERVE_ALL, fresh, sort=sort, desc=dir == "desc", query=q)
        feed = next((f for f in feeds.feeds() if f.id == feed_id), None)
    except SpotifyError as e:
        raise _raise(e)
    rows = annotate(db, whole.tracks)
    counts = {k: 0 for k in FEED_STATUSES}
    for r in rows:
        counts["all"] += 1
        counts[row_status(r)] += 1
    kept = rows if status == "all" else [r for r in rows if row_status(r) == status]
    limit = max(1, min(limit, PAGE_LIMIT))
    offset = max(0, offset)
    nxt = offset + limit
    return FeedPageOut(
        feed=FeedOut(**vars(feed)) if isinstance(feed, Feed) else None,
        feed_id=whole.feed_id,
        total=len(kept),
        offset=offset,
        limit=limit,
        next_offset=nxt if nxt < len(kept) else None,
        feed_total=whole.feed_total,
        counts=counts,
        rows=kept[offset:nxt],
    )


FEED_STATUSES = ("all", "open", "wanted", "library")
PAGE_LIMIT = 500
SERVE_ALL = 100_000


def row_status(r: FeedRowOut) -> str:
    """A feed row's category: wanted (a Source Item exists, whatever its
    stage) > library (a Track matches) > open."""
    if r.source_item is not None and r.source_item.state != "fulfilled":
        return "wanted"
    if r.library is not None or (r.source_item is not None and r.source_item.state == "fulfilled"):
        return "library"
    return "open"


# -- want --------------------------------------------------------------------


class WantIn(BaseModel):
    source: Literal["spotify"] = "spotify"
    external_id: str = Field(min_length=1, max_length=64)
    # "that library match is wrong": any correspondence matching proposes or
    # confirms against this Track is rejected, so the item stays acquirable
    reject_track_id: int | None = None


class WantOut(SourceItemResponse):
    created: bool


WantOut.model_rebuild(
    _types_namespace={
        "CorrespondenceInfo": CorrespondenceInfo,
        "DownloadStatus": DownloadStatus,
        "ProvenanceInfo": ProvenanceInfo,
    }
)


@want_router.post("/want", response_model=WantOut)
def want(
    body: WantIn,
    db: Session = Depends(get_db),
    feeds: SpotifyFeeds = Depends(get_feeds),
    soulseek: SearchSupplier | None = Depends(get_soulseek_supplier),
) -> WantOut:
    """Mark a Spotify track wanted: a Source Item (source="spotify").

    Spotify supplies no audio, so there is no Direct Supplier download; when
    Soulseek is configured an automatic search is queued so candidates are
    waiting in the picker. Idempotent per Spotify track.
    """
    existing = (
        db.query(SourceItem)
        .filter(SourceItem.source == body.source, SourceItem.external_id == body.external_id)
        .one_or_none()
    )
    if existing is not None:
        return WantOut(**item_responses(db, [existing])[0].model_dump(), created=False)
    try:
        track = feeds.track(body.external_id)
    except SpotifyError as e:
        raise _raise(e)
    cfg = get_config().acquisition
    item = SourceItem(
        source=SOURCE_NAME,
        external_id=track.spotify_id,
        title=track.title,
        uploader=track.uploader,
        duration_ms=track.duration_ms,
        permalink_url=track.url,
        liked_at=track.added_at,
        classification=classify(track.title, track.duration_ms, cfg.classification),
    )
    db.add(item)
    db.commit()
    run_matching(db, MatchingConfig(), source_name=SOURCE_NAME)
    db.refresh(item)
    if body.reject_track_id is not None:
        corr = get_correspondence(db, item.id)
        if corr is not None and corr.track_id == body.reject_track_id and corr.status != "rejected":
            corr.status = "rejected"  # remembered: matching never re-proposes it
            item.state = "new"
            db.commit()
            db.refresh(item)
            logger.info("want: rejected library match track %d for item %d", corr.track_id, item.id)
    if item.state == "new" and soulseek is not None:
        enqueue_soulseek_search(db, item)
    logger.info("wanted spotify track %s (%s) -> source item %d", track.spotify_id, track.title, item.id)
    return WantOut(**item_responses(db, [item])[0].model_dump(), created=True)
