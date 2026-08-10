from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.models import Playlist, PlaylistTrack, Track
from backend.playlist_full_export import PlaylistExportTargetRunner, PlaylistFullExportService


class FakeService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, list[str]]] = []

    def export(self, playlist_name: str, targets: list[str]) -> dict:
        self.calls.append((playlist_name, targets))
        return {
            "playlist_name": playlist_name,
            "results": [
                {
                    "target": target,
                    "status": "exported",
                    "playlist_created": False,
                    "tracks_total": 1,
                    "tracks_exported": 1,
                    "tracks_skipped": 0,
                    "tracks_failed": 0,
                    "tracks": [
                        {
                            "track_id": 7,
                            "title": "Tracer",
                            "status": "exported",
                            "fields": {
                                "playlist": "exported",
                                "hotcues": "exported",
                                "beatgrid": "exported",
                                "key": "exported",
                                "maincue": "exported",
                            },
                            "reason": None,
                        }
                    ],
                }
                for target in targets
            ],
        }


def test_playlist_full_export_selects_destinations() -> None:
    from backend.routers import sync_export

    service = FakeService()
    app = FastAPI()
    app.include_router(sync_export.router, prefix="/api")
    app.dependency_overrides[sync_export.get_playlist_full_export_service] = lambda: service
    client = TestClient(app)

    response = client.post(
        "/api/sync/export/playlists/Alien/performance",
        json={"targets": ["rekordbox", "engine"]},
    )

    assert response.status_code == 200
    assert service.calls == [("Alien", ["rekordbox", "engine"])]
    assert [result["target"] for result in response.json()["results"]] == [
        "rekordbox",
        "engine",
    ]


class FakeTarget:
    def __init__(self, name: str) -> None:
        self.name = name
        self.calls: list[tuple[str, list[int]]] = []

    def export(self, playlist: Playlist, tracks: list[Track]) -> dict:
        self.calls.append((playlist.name, [track.id for track in tracks]))
        return {
            "target": self.name,
            "status": "exported",
            "playlist_created": True,
            "tracks_total": len(tracks),
            "tracks_exported": len(tracks),
            "tracks_skipped": 0,
            "tracks_failed": 0,
            "tracks": [],
        }


def test_service_exports_only_playlist_members_in_play_order(db) -> None:
    first = Track(filename="/music/first.flac", title="First")
    outside = Track(filename="/music/outside.flac", title="Outside")
    second = Track(filename="/music/second.flac", title="Second")
    playlist = Playlist(name="Alien")
    db.add_all([first, outside, second, playlist])
    db.flush()
    db.add_all([
        PlaylistTrack(playlist_id=playlist.id, track_id=second.id, position=1),
        PlaylistTrack(playlist_id=playlist.id, track_id=first.id, position=0),
    ])
    db.commit()
    target = FakeTarget("rekordbox")

    result = PlaylistFullExportService(db, {"rekordbox": target}).export(
        "Alien", ["rekordbox"]
    )

    assert target.calls == [("Alien", [first.id, second.id])]
    assert result["results"][0]["tracks_total"] == 2


class FakeWriter:
    target = "rekordbox"

    def __init__(self, unmatched_id: int) -> None:
        self.unmatched_id = unmatched_id
        self.prepared = False

    def prepare(self, tracks: list[Track]) -> None:
        self.prepared = True

    def replace_playlist(self, name: str, tracks: list[Track]):
        return False, {self.unmatched_id: "not found in Rekordbox"}

    def export_track(self, track: Track) -> dict[str, str]:
        return {
            "hotcues": "exported",
            "beatgrid": "skipped: Library has no saved grid",
            "key": "exported",
            "maincue": "skipped: unsupported by Rekordbox",
        }


def test_target_report_keeps_skips_and_unmatched_tracks(db) -> None:
    matched = Track(filename="/music/a.flac", title="A")
    unmatched = Track(filename="/music/b.flac", title="B")
    playlist = Playlist(name="Alien")
    db.add_all([matched, unmatched, playlist])
    db.commit()
    writer = FakeWriter(unmatched.id)

    report = PlaylistExportTargetRunner(writer).export(playlist, [matched, unmatched])

    assert writer.prepared
    assert report["tracks_exported"] == 1
    assert report["tracks_failed"] == 1
    assert report["tracks"][0]["fields"]["beatgrid"].startswith("skipped")
    assert report["tracks"][1]["reason"] == "not found in Rekordbox"
