"""Spotify API (#347).

/api/spotify:
GET    /status          state (no_client|disconnected|connected|reconnect), account
PUT    /client          store the Spotify app's Client ID
DELETE /client          forget Client ID + refresh token
POST   /connect         start PKCE sign-in -> {authorize_url}
GET    /callback        loopback redirect target (HTML page for the browser)
DELETE /token           disconnect (forget the refresh token)
GET    /feeds           Liked Songs + playlists, with counts
GET    /feeds/{id}      a page of a Feed, rows annotated with library matches
                        and existing Source Items

/api/acquisition (want_router):
POST   /want            Source Item for a Spotify track (source="spotify")
"""

from __future__ import annotations

import html
import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..acquisition.classification import classify
from ..acquisition.manager import run_matching
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
    REGISTERED_REDIRECT_URI,
    SCOPES,
    NeedsReconnect,
    SpotifyConnection,
    SpotifyError,
    get_connection,
    redirect_uri_for_port,
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
    # register this in the Spotify dashboard (loopback, any port)
    redirect_uri: str
    # this backend's exact callback, should the portless one be refused
    redirect_uri_exact: str
    scopes: list[str]
    account: AccountOut | None
    error: str | None


def _status(request: Request, conn: SpotifyConnection, fresh: bool = False) -> SpotifyStatus:
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
        redirect_uri=REGISTERED_REDIRECT_URI,
        redirect_uri_exact=redirect_uri_for_port(request.url.port),
        scopes=list(SCOPES),
        account=account,
        error=error,
    )


@router.get("/status", response_model=SpotifyStatus)
def get_status(
    request: Request, fresh: bool = False, conn: SpotifyConnection = Depends(get_connection)
) -> SpotifyStatus:
    return _status(request, conn, fresh)


class ClientIn(BaseModel):
    client_id: str = Field(min_length=1, max_length=128, pattern=r"^\s*[A-Za-z0-9]+\s*$")


@router.put("/client", response_model=SpotifyStatus)
def put_client(
    body: ClientIn,
    request: Request,
    conn: SpotifyConnection = Depends(get_connection),
    feeds: SpotifyFeeds = Depends(get_feeds),
) -> SpotifyStatus:
    conn.set_client_id(body.client_id)
    feeds.clear()
    return _status(request, conn)


@router.delete("/client", response_model=SpotifyStatus)
def delete_client(
    request: Request,
    conn: SpotifyConnection = Depends(get_connection),
    feeds: SpotifyFeeds = Depends(get_feeds),
) -> SpotifyStatus:
    conn.forget_client()
    feeds.clear()
    return _status(request, conn)


@router.delete("/token", response_model=SpotifyStatus)
def delete_token(
    request: Request,
    conn: SpotifyConnection = Depends(get_connection),
    feeds: SpotifyFeeds = Depends(get_feeds),
) -> SpotifyStatus:
    conn.disconnect()
    feeds.clear()
    return _status(request, conn)


class ConnectOut(BaseModel):
    authorize_url: str
    redirect_uri: str


@router.post("/connect", response_model=ConnectOut)
def connect(request: Request, conn: SpotifyConnection = Depends(get_connection)) -> ConnectOut:
    redirect_uri = redirect_uri_for_port(request.url.port)
    try:
        return ConnectOut(authorize_url=conn.begin(redirect_uri), redirect_uri=redirect_uri)
    except SpotifyError as e:
        raise _raise(e)


def _page(title: str, message: str, ok: bool) -> HTMLResponse:
    color = "#00e05a" if ok else "#ff2a2a"
    close = "<script>setTimeout(() => window.close(), 1500)</script>" if ok else ""
    body = f"""<!doctype html><meta charset="utf-8"><title>{html.escape(title)}</title>
<body style="background:#000;color:#fff;font:16px system-ui;display:grid;place-items:center;height:90vh">
<div style="max-width:32em;text-align:center"><h1 style="color:{color}">{html.escape(title)}</h1>
<p>{html.escape(message)}</p></div>{close}</body>"""
    return HTMLResponse(body, status_code=200 if ok else 400)


@router.get("/callback", response_class=HTMLResponse)
def callback(
    state: str = "",
    code: str | None = None,
    error: str | None = None,
    conn: SpotifyConnection = Depends(get_connection),
    feeds: SpotifyFeeds = Depends(get_feeds),
) -> HTMLResponse:
    if error or not code:
        reason = "you declined access" if error == "access_denied" else (error or "no code returned")
        return _page("Spotify not connected", f"Spotify sign-in ended: {reason}.", ok=False)
    try:
        account = conn.complete(state, code)
    except SpotifyError as e:
        return _page("Spotify not connected", str(e), ok=False)
    feeds.clear()
    return _page(
        "Spotify connected",
        f"Signed in as {account.display_name}. You can close this window and return to manaDJ.",
        ok=True,
    )


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
    db: Session = Depends(get_db),
    feeds: SpotifyFeeds = Depends(get_feeds),
) -> FeedPageOut:
    try:
        page = feeds.page(feed_id, offset, limit, fresh)
        feed = next((f for f in feeds.feeds() if f.id == feed_id), None)
    except SpotifyError as e:
        raise _raise(e)
    return FeedPageOut(
        feed=FeedOut(**vars(feed)) if isinstance(feed, Feed) else None,
        feed_id=page.feed_id,
        total=page.total,
        offset=page.offset,
        limit=page.limit,
        next_offset=page.next_offset,
        rows=annotate(db, page.tracks),
    )


# -- want --------------------------------------------------------------------


class WantIn(BaseModel):
    source: Literal["spotify"] = "spotify"
    external_id: str = Field(min_length=1, max_length=64)


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
    if item.state == "new" and soulseek is not None:
        enqueue_soulseek_search(db, item)
    logger.info("wanted spotify track %s (%s) -> source item %d", track.spotify_id, track.title, item.id)
    return WantOut(**item_responses(db, [item])[0].model_dump(), created=True)
