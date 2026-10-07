"""Spotify read-only Source (#347): PKCE connect, token refresh/reconnect,
Feeds with in-library detection, and want -> Source Item.

Spotify is faked at the transport seam (ADR-0002): FakeSpotify implements
the accounts token endpoint (verifying PKCE) and the Web API endpoints in the
post-February-2026 shapes, so the real connection, paging, and parsing code
runs end to end.
"""

from __future__ import annotations

import base64
import hashlib
import os
import stat
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.acquisition.models import SourceItem
from backend.acquisition.router import get_soulseek_supplier
from backend.acquisition.router import router as acquisition_router
from backend.acquisition.supplier import SupplierSearchResult
from backend.database import get_db
from backend.models import Track
from backend.spotify import router as spotify_router
from backend.spotify.connection import (
    API_BASE,
    CLIENT_ID_KEY,
    REFRESH_TOKEN_KEY,
    SpotifyConnection,
    get_connection,
)
from backend.spotify.feeds import SpotifyFeeds, get_feeds

from .conftest import FakeSource

CLIENT_ID = "abc123clientid"
BASE_URL = "http://127.0.0.1:8127"


def _track(i: str, name: str, artists: list[str], ms: int, isrc: str | None = None) -> dict[str, Any]:
    return {
        "type": "track",
        "id": i,
        "name": name,
        "artists": [{"name": a} for a in artists],
        "album": {"name": f"{name} EP"},
        "duration_ms": ms,
        "external_urls": {"spotify": f"https://open.spotify.com/track/{i}"},
        "external_ids": {"isrc": isrc} if isrc else {},
        "is_local": False,
    }


LIKED = [
    _track("sp1", "Wake Up", ["Hoax"], 274_000, "GBXXX2600001"),
    _track("sp2", "Night Drive", ["Kessler", "Overmono"], 301_000),
    _track("sp3", "Rain Song", ["Anna Lee"], 245_000),
]
MINE = [_track("sp4", "Pressure", ["Bicep"], 330_000)]


class FakeSpotify:
    """In-memory Spotify accounts service + Web API."""

    def __init__(self) -> None:
        self.codes: dict[str, tuple[str, str]] = {}  # code -> (challenge, redirect_uri)
        self.refresh_tokens: set[str] = set()
        self.access_tokens: set[str] = set()
        self.rotate = False
        self.calls: list[str] = []
        self._n = 0
        self.playlists = [
            {"id": "pl-mine", "name": "Warmup", "owner": {"id": "dj1", "display_name": "DJ One"},
             "collaborative": False, "items": {"total": len(MINE)}, "images": [{"url": "http://img/1"}],
             "external_urls": {"spotify": "https://open.spotify.com/playlist/pl-mine"}},
            {"id": "pl-collab", "name": "Shared", "owner": {"id": "friend"}, "collaborative": True,
             "tracks": {"total": 0}},  # pre-2026 count field still parsed
            {"id": "pl-followed", "name": "Editorial", "owner": {"id": "spotify"},
             "collaborative": False},  # no items object: not readable
        ]

    def _next(self, prefix: str) -> str:
        self._n += 1
        return f"{prefix}{self._n}"

    def approve(self, authorize_url: str) -> tuple[str, str]:
        """The user signs in and approves: returns (state, code)."""
        q = {k: v[0] for k, v in parse_qs(urlparse(authorize_url).query).items()}
        assert q["client_id"] == CLIENT_ID and q["response_type"] == "code"
        assert q["code_challenge_method"] == "S256"
        assert set(q["scope"].split()) == {
            "user-library-read", "playlist-read-private", "playlist-read-collaborative",
        }
        code = self._next("code")
        self.codes[code] = (q["code_challenge"], q["redirect_uri"])
        return q["state"], code

    def _issue(self, with_refresh: bool) -> dict[str, Any]:
        access = self._next("at")
        self.access_tokens.add(access)
        body: dict[str, Any] = {"access_token": access, "token_type": "Bearer", "expires_in": 3600}
        if with_refresh:
            refresh = self._next("rt")
            self.refresh_tokens.add(refresh)
            body["refresh_token"] = refresh
        return body

    def post_token(self, form: dict[str, str]) -> tuple[int, dict[str, Any]]:
        self.calls.append(f"token:{form['grant_type']}")
        if form.get("client_id") != CLIENT_ID:
            return 400, {"error": "invalid_client"}
        if form["grant_type"] == "authorization_code":
            challenge, redirect = self.codes.pop(form["code"], (None, None))
            digest = hashlib.sha256(form["code_verifier"].encode()).digest()
            expected = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
            if challenge != expected or redirect != form["redirect_uri"]:
                return 400, {"error": "invalid_grant", "error_description": "bad verifier"}
            return 200, self._issue(with_refresh=True)
        if form["refresh_token"] not in self.refresh_tokens:
            return 400, {"error": "invalid_grant", "error_description": "Refresh token revoked"}
        if self.rotate:
            self.refresh_tokens.discard(form["refresh_token"])
        return 200, self._issue(with_refresh=self.rotate)

    def revoke(self) -> None:
        self.refresh_tokens.clear()
        self.access_tokens.clear()

    def _paged(self, path: str, items: list[Any], params: dict[str, Any]) -> dict[str, Any]:
        offset, limit = int(params.get("offset", 0)), int(params.get("limit", 20))
        assert limit <= 50
        nxt = f"{API_BASE}{path}?offset={offset + limit}&limit={limit}" if offset + limit < len(items) else None
        return {"items": items[offset:offset + limit], "total": len(items), "offset": offset,
                "limit": limit, "next": nxt}

    def get(self, url: str, params: dict[str, Any] | None, access_token: str) -> tuple[int, dict[str, Any], dict[str, str]]:
        parsed = urlparse(url)
        path = parsed.path.removeprefix("/v1")
        params = {**{k: v[0] for k, v in parse_qs(parsed.query).items()}, **(params or {})}
        self.calls.append(f"GET {path}")
        if access_token not in self.access_tokens:
            return 401, {"error": {"status": 401, "message": "The access token expired"}}, {}
        if path == "/me":
            return 200, {"id": "dj1", "display_name": "DJ One", "account_id": "acc1"}, {}
        if path == "/me/tracks":
            entries = [{"added_at": f"2026-10-0{i + 1}T10:00:00Z", "track": t} for i, t in enumerate(LIKED)]
            return 200, self._paged(path, entries, params), {}
        if path == "/me/playlists":
            return 200, self._paged(path, self.playlists, params), {}
        if path == "/playlists/pl-mine/items":
            entries: list[dict[str, Any]] = [{"added_at": "2026-09-01T00:00:00Z", "item": t} for t in MINE]
            entries.append({"added_at": None, "item": {"type": "track", "id": None, "is_local": True, "name": "local"}})
            entries.append({"added_at": None, "item": {"type": "episode", "id": "ep1", "name": "pod"}})
            return 200, self._paged(path, entries, params), {}
        if path.startswith("/playlists/"):
            return 403, {"error": {"status": 403, "message": "Forbidden"}}, {}
        if path.startswith("/tracks/"):
            tid = path.split("/")[-1]
            for t in LIKED + MINE + [_track("sp9", "Elsewhere", ["Someone"], 200_000)]:
                if t["id"] == tid:
                    return 200, t, {}
            return 404, {"error": {"status": 404, "message": "Not found"}}, {}
        return 404, {"error": {"status": 404, "message": "no route"}}, {}


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    root = tmp_path / "data"
    monkeypatch.setenv("MANADJ_DATA_DIR", str(root))
    for key in (CLIENT_ID_KEY, REFRESH_TOKEN_KEY):
        monkeypatch.delenv(key, raising=False)
    yield root
    for key in (CLIENT_ID_KEY, REFRESH_TOKEN_KEY):
        os.environ.pop(key, None)


@pytest.fixture
def fake() -> FakeSpotify:
    return FakeSpotify()


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def conn(env: Path, fake: FakeSpotify, clock: Clock) -> SpotifyConnection:
    return SpotifyConnection(transport=fake, clock=clock)


@pytest.fixture
def make_client(
    db_session: Session, conn: SpotifyConnection, clock: Clock
) -> Callable[..., TestClient]:
    def make(soulseek: Any = None) -> TestClient:
        feeds = SpotifyFeeds(conn, clock=clock)
        app = FastAPI()
        app.include_router(spotify_router.router, prefix="/api/spotify")
        app.include_router(spotify_router.want_router, prefix="/api/acquisition")
        app.include_router(acquisition_router, prefix="/api/acquisition")
        app.dependency_overrides[get_db] = lambda: db_session
        app.dependency_overrides[get_connection] = lambda: conn
        app.dependency_overrides[get_feeds] = lambda: feeds
        app.dependency_overrides[get_soulseek_supplier] = lambda: soulseek
        return TestClient(app, base_url=BASE_URL)

    return make


@pytest.fixture
def client(make_client: Callable[..., TestClient]) -> TestClient:
    return make_client()


def _connect(client: TestClient, fake: FakeSpotify) -> None:
    assert client.put("/api/spotify/client", json={"client_id": CLIENT_ID}).status_code == 200
    started = client.post("/api/spotify/connect").json()
    state, code = fake.approve(started["authorize_url"])
    r = client.get("/api/spotify/callback", params={"state": state, "code": code})
    assert r.status_code == 200, r.text


# -- connect -----------------------------------------------------------------


def test_connect_flow(client: TestClient, fake: FakeSpotify, env: Path) -> None:
    st = client.get("/api/spotify/status").json()
    assert st["state"] == "no_client" and st["account"] is None
    assert st["redirect_uri"] == "http://127.0.0.1/api/spotify/callback"
    assert st["redirect_uri_exact"] == "http://127.0.0.1:8127/api/spotify/callback"
    assert client.post("/api/spotify/connect").status_code == 409

    assert client.put("/api/spotify/client", json={"client_id": "not a client id!"}).status_code == 422
    st = client.put("/api/spotify/client", json={"client_id": f" {CLIENT_ID} "}).json()
    assert st["state"] == "disconnected" and st["client_id"] == CLIENT_ID

    started = client.post("/api/spotify/connect").json()
    assert started["redirect_uri"] == "http://127.0.0.1:8127/api/spotify/callback"
    state, code = fake.approve(started["authorize_url"])
    page = client.get("/api/spotify/callback", params={"state": state, "code": code})
    assert page.status_code == 200 and "Spotify connected" in page.text and "DJ One" in page.text

    st = client.get("/api/spotify/status").json()
    assert st["state"] == "connected"
    assert st["account"] == {"id": "dj1", "display_name": "DJ One"}
    dotenv = env / ".env"
    text = dotenv.read_text()
    assert f"{CLIENT_ID_KEY}={CLIENT_ID}" in text and f"{REFRESH_TOKEN_KEY}=rt" in text
    assert stat.S_IMODE(dotenv.stat().st_mode) == 0o600

    # a state can't be replayed
    replay = client.get("/api/spotify/callback", params={"state": state, "code": code})
    assert replay.status_code == 400 and "expired or was already used" in replay.text

    st = client.delete("/api/spotify/token").json()
    assert st["state"] == "disconnected" and REFRESH_TOKEN_KEY not in dotenv.read_text()
    st = client.delete("/api/spotify/client").json()
    assert st["state"] == "no_client" and CLIENT_ID_KEY not in dotenv.read_text()


def test_callback_denied_and_bad_verifier(client: TestClient, fake: FakeSpotify) -> None:
    client.put("/api/spotify/client", json={"client_id": CLIENT_ID})
    denied = client.get("/api/spotify/callback", params={"state": "x", "error": "access_denied"})
    assert denied.status_code == 400 and "declined" in denied.text

    started = client.post("/api/spotify/connect").json()
    state, code = fake.approve(started["authorize_url"])
    fake.codes[code] = ("wrong-challenge", fake.codes[code][1])
    bad = client.get("/api/spotify/callback", params={"state": state, "code": code})
    assert bad.status_code == 400 and "refused the sign-in" in bad.text
    assert client.get("/api/spotify/status").json()["state"] == "disconnected"


def test_changing_client_id_drops_the_token(client: TestClient, fake: FakeSpotify) -> None:
    _connect(client, fake)
    st = client.put("/api/spotify/client", json={"client_id": "otherapp"}).json()
    assert st["state"] == "disconnected"


def test_access_token_refresh_and_rotation(
    client: TestClient, fake: FakeSpotify, clock: Clock, env: Path
) -> None:
    _connect(client, fake)
    first_refresh = os.environ[REFRESH_TOKEN_KEY]
    fake.calls.clear()
    client.get("/api/spotify/feeds")
    assert "token:refresh_token" not in fake.calls  # access token still fresh

    clock.t += 3600  # expired
    fake.rotate = True
    client.get("/api/spotify/feeds", params={"fresh": True})
    assert fake.calls.count("token:refresh_token") == 1
    rotated = os.environ[REFRESH_TOKEN_KEY]
    assert rotated != first_refresh and f"{REFRESH_TOKEN_KEY}={rotated}" in (env / ".env").read_text()

    # Spotify invalidates the access token early: one 401 -> refresh -> retry
    fake.access_tokens.clear()
    fake.calls.clear()
    assert client.get("/api/spotify/feeds", params={"fresh": True}).status_code == 200
    assert fake.calls.count("token:refresh_token") == 1


def test_revoked_refresh_token_means_reconnect(client: TestClient, fake: FakeSpotify, clock: Clock) -> None:
    _connect(client, fake)
    fake.revoke()
    clock.t += 3600
    r = client.get("/api/spotify/feeds")
    assert r.status_code == 409 and "reconnect" in r.json()["detail"]
    st = client.get("/api/spotify/status").json()
    assert st["state"] == "reconnect" and "Refresh token revoked" in st["error"]

    # reconnecting clears it
    started = client.post("/api/spotify/connect").json()
    state, code = fake.approve(started["authorize_url"])
    client.get("/api/spotify/callback", params={"state": state, "code": code})
    assert client.get("/api/spotify/status").json()["state"] == "connected"
    assert client.get("/api/spotify/feeds").status_code == 200


def test_not_connected_feeds_409(client: TestClient) -> None:
    r = client.get("/api/spotify/feeds")
    assert r.status_code == 409 and "connect" in r.json()["detail"]


# -- feeds -------------------------------------------------------------------


def test_feeds_list(client: TestClient, fake: FakeSpotify) -> None:
    _connect(client, fake)
    fake.playlists = fake.playlists * 20  # 60 playlists: /me/playlists pages at 50
    feeds = client.get("/api/spotify/feeds").json()
    assert feeds[0] == {
        "id": "liked", "kind": "liked", "name": "Liked Songs", "track_count": 3, "readable": True,
        "url": "https://open.spotify.com/collection/tracks", "image_url": None, "owner": None,
    }
    assert len(feeds) == 61
    mine, collab, followed = feeds[1:4]
    assert (mine["id"], mine["track_count"], mine["readable"], mine["image_url"], mine["owner"]) == (
        "playlist:pl-mine", 1, True, "http://img/1", "DJ One",
    )
    assert (collab["track_count"], collab["readable"]) == (0, True)
    assert (followed["track_count"], followed["readable"]) == (0, False)

    # cached briefly
    fake.calls.clear()
    client.get("/api/spotify/feeds")
    assert fake.calls == []


def test_feed_page_paging_and_parsing(client: TestClient, fake: FakeSpotify, clock: Clock) -> None:
    _connect(client, fake)
    page = client.get("/api/spotify/feeds/liked", params={"limit": 2}).json()
    assert (page["total"], page["offset"], page["limit"], page["next_offset"]) == (3, 0, 2, 2)
    assert page["feed"]["name"] == "Liked Songs"
    row = page["rows"][0]
    assert row == {
        "spotify_id": "sp1", "title": "Wake Up", "artists": ["Hoax"], "album": "Wake Up EP",
        "duration_ms": 274_000, "url": "https://open.spotify.com/track/sp1", "isrc": "GBXXX2600001",
        "added_at": "2026-10-01T10:00:00Z", "library": None, "source_item": None,
    }
    page2 = client.get("/api/spotify/feeds/liked", params={"offset": 2, "limit": 2}).json()
    assert [r["spotify_id"] for r in page2["rows"]] == ["sp3"] and page2["next_offset"] is None

    # cache: same page again doesn't hit Spotify; after the TTL it does
    fake.calls.clear()
    client.get("/api/spotify/feeds/liked", params={"limit": 2})
    assert not any(c.startswith("GET /me/tracks") for c in fake.calls)
    clock.t += 1000
    client.get("/api/spotify/feeds/liked", params={"limit": 2})
    assert "GET /me/tracks" in fake.calls

    # playlist entries use `item`; local files and episodes are dropped
    pl = client.get("/api/spotify/feeds/playlist:pl-mine").json()
    assert pl["total"] == 3 and [r["spotify_id"] for r in pl["rows"]] == ["sp4"]

    forbidden = client.get("/api/spotify/feeds/playlist:pl-followed")
    assert forbidden.status_code == 403 and "own or collaborate" in forbidden.json()["detail"]
    assert client.get("/api/spotify/feeds/bogus").status_code == 404


def test_in_library_detection(
    client: TestClient, fake: FakeSpotify, make_track: Callable[..., Track]
) -> None:
    _connect(client, fake)
    exact = make_track(title="Wake Up", artist="Hoax", duration_secs=274.4)
    make_track(title="Night Drive (Extended)", artist="Kessler", duration_secs=303.0)
    make_track(title="Rain Song", artist="Anna Lee", duration_secs=400.0)  # duration mismatch
    rows = {r["spotify_id"]: r for r in client.get("/api/spotify/feeds/liked").json()["rows"]}

    lib = rows["sp1"]["library"]
    assert lib["track_id"] == exact.id and lib["confidence"] == "match" and lib["linked"] is False
    assert rows["sp2"]["library"]["confidence"] == "probable"
    assert rows["sp3"]["library"] is None


# -- want --------------------------------------------------------------------


def test_want_creates_spotify_source_item(client: TestClient, fake: FakeSpotify, db_session: Session) -> None:
    _connect(client, fake)
    client.get("/api/spotify/feeds/liked")
    fake.calls.clear()

    r = client.post("/api/acquisition/want", json={"source": "spotify", "external_id": "sp2"})
    assert r.status_code == 200
    item = r.json()
    assert item["created"] is True
    assert fake.calls == []  # metadata from the feed rows just seen
    assert (item["source"], item["external_id"], item["title"], item["uploader"]) == (
        "spotify", "sp2", "Night Drive", "Kessler, Overmono",
    )
    assert item["permalink_url"] == "https://open.spotify.com/track/sp2"
    assert (item["duration_ms"], item["state"], item["liked_at"]) == (301_000, "new", "2026-10-02T10:00:00Z")
    assert item["classification"] == "track"

    again = client.post("/api/acquisition/want", json={"external_id": "sp2"}).json()
    assert again["created"] is False and again["id"] == item["id"]
    assert db_session.query(SourceItem).filter(SourceItem.source == "spotify").count() == 1

    # the row now carries the Source Item
    rows = {r["spotify_id"]: r for r in client.get("/api/spotify/feeds/liked").json()["rows"]}
    assert rows["sp2"]["source_item"]["id"] == item["id"]

    # unseen track: fetched by id
    other = client.post("/api/acquisition/want", json={"external_id": "sp9"}).json()
    assert other["title"] == "Elsewhere" and other["liked_at"] is None
    assert client.post("/api/acquisition/want", json={"external_id": "nope"}).status_code == 404

    # Acquisition lists every Source; Spotify items have no Direct Supplier
    assert {i["source"] for i in client.get("/api/acquisition/items").json()} == {"spotify"}
    assert len(client.get("/api/acquisition/items", params={"source": "soundcloud"}).json()) == 0
    q = client.post(f"/api/acquisition/items/{item['id']}/queue")
    assert q.status_code == 409 and "Soulseek" in q.json()["detail"]
    bulk = client.post("/api/acquisition/items/queue-bulk", json={"item_ids": [item["id"]]}).json()
    assert bulk == {"queued": 0, "skipped": 1}


def test_want_in_library_track_links(
    client: TestClient, fake: FakeSpotify, make_track: Callable[..., Track]
) -> None:
    _connect(client, fake)
    track = make_track(title="Wake Up", artist="Hoax", duration_secs=274.0)
    item = client.post("/api/acquisition/want", json={"external_id": "sp1"}).json()
    assert item["state"] == "fulfilled" and item["correspondence"]["track_id"] == track.id

    rows = {r["spotify_id"]: r for r in client.get("/api/spotify/feeds/liked").json()["rows"]}
    assert rows["sp1"]["library"]["linked"] is True
    assert rows["sp1"]["library"]["confidence"] == "match"


def test_want_queues_soulseek_search_when_configured(
    make_client: Callable[..., TestClient], fake: FakeSpotify, db_session: Session
) -> None:
    from backend.tasks.models import Task

    soulseek = FakeSource([], search_results=[SupplierSearchResult(
        download_token="t", filename="@@p\\Hoax - Wake Up.mp3", format="mp3", bitrate_kbps=320,
        size_bytes=1, duration_ms=274_000, queue_length=0,
    )])
    client = make_client(soulseek=soulseek)
    _connect(client, fake)
    item = client.post("/api/acquisition/want", json={"external_id": "sp1"}).json()
    tasks = db_session.query(Task).filter(Task.type == "soulseek-search").all()
    assert [t.ref for t in tasks] == [f"source_item:{item['id']}:soulseek-search"]
