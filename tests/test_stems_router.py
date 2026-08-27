"""Stem serving endpoint + has_stems on the track API (#197)."""

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.config import StemsConfig
from backend.database import get_db
from backend.routers import tracks as tracks_router
from backend.schemas import Track as TrackSchema
from backend.stems import STEM_NAMES, STEMS_VERSION, StemsMeta, stems_dir


@pytest.fixture
def client(db_session: Session) -> TestClient:
    app = FastAPI()
    app.include_router(tracks_router.router, prefix="/api/tracks")
    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


@pytest.fixture
def stems_config(tmp_path: Path, monkeypatch) -> StemsConfig:
    from backend import config as config_module

    config = config_module.get_config()
    stems = StemsConfig(directory=str(tmp_path / "stems"))
    monkeypatch.setattr(config, "stems", stems)
    return stems


def materialize_stems(track_id: int, source: Path, config: StemsConfig) -> None:
    st = source.stat()
    d = stems_dir(track_id, config)
    d.mkdir(parents=True)
    for stem in STEM_NAMES:
        (d / f"{stem}.m4a").write_bytes(b"m4a" * 100)
    meta = StemsMeta(
        model=config.model,
        stems_version=STEMS_VERSION,
        codec="aac",
        bitrate="256k",
        sample_rate=44100,
        source_mtime_ns=st.st_mtime_ns,
        source_size=st.st_size,
    )
    (d / "meta.json").write_text(meta.to_json())


@pytest.fixture
def track_with_stems(make_track, tmp_path: Path, stems_config: StemsConfig):
    source = tmp_path / "track.mp3"
    source.write_bytes(b"x" * 500)
    track = make_track(filename=str(source))
    materialize_stems(track.id, source, stems_config)
    return track


def test_stem_streams_with_range(client: TestClient, track_with_stems) -> None:
    full = client.get(f"/api/tracks/{track_with_stems.id}/stems/drums")
    assert full.status_code == 200
    assert full.headers["content-type"] == "audio/mp4"
    partial = client.get(
        f"/api/tracks/{track_with_stems.id}/stems/drums", headers={"Range": "bytes=0-9"}
    )
    assert partial.status_code == 206
    assert len(partial.content) == 10
    assert partial.content == full.content[:10]


def test_all_four_stems_serve(client: TestClient, track_with_stems) -> None:
    for stem in STEM_NAMES:
        assert client.get(f"/api/tracks/{track_with_stems.id}/stems/{stem}").status_code == 200


def test_404s(client: TestClient, track_with_stems, make_track, tmp_path: Path) -> None:
    # invalid stem name
    assert client.get(f"/api/tracks/{track_with_stems.id}/stems/guitar").status_code == 404
    # unknown track
    assert client.get("/api/tracks/424242/stems/drums").status_code == 404
    # track without stems
    bare = make_track(filename=str(tmp_path / "no-stems.mp3"))
    assert client.get(f"/api/tracks/{bare.id}/stems/drums").status_code == 404


def test_stale_stems_are_absent(
    client: TestClient, track_with_stems, stems_config: StemsConfig
) -> None:
    # Replace the source audio (size change) -> stems are stale -> 404.
    Path(track_with_stems.filename).write_bytes(b"y" * 501)
    assert client.get(f"/api/tracks/{track_with_stems.id}/stems/drums").status_code == 404


def test_has_stems_on_track_schema(
    db_session: Session, track_with_stems, make_track, tmp_path: Path
) -> None:
    assert TrackSchema.model_validate(track_with_stems).has_stems is True
    bare = make_track(filename=str(tmp_path / "bare.mp3"))
    assert TrackSchema.model_validate(bare).has_stems is False


def test_has_stems_goes_false_when_stale(
    track_with_stems, stems_config: StemsConfig
) -> None:
    assert TrackSchema.model_validate(track_with_stems).has_stems is True
    Path(track_with_stems.filename).write_bytes(b"y" * 501)
    assert TrackSchema.model_validate(track_with_stems).has_stems is False
