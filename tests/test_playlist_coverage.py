"""Coverage view: per-source read status, same-name playlists kept apart."""

from backend.playlists.coverage import build_coverage
from backend.playlists.models import PlaylistInfo, TrackReference


def _pl(name, source, sid, files):
    return PlaylistInfo(
        name=name, source=source, source_id=sid, hierarchy_parts=None, last_modified=None,
        tracks=[TrackReference(path=f"/m/{f}", filename=f, track_id=i) for i, f in enumerate(files)],
    )


def test_status_distinguishes_read_failed_and_not_configured():
    def boom():
        raise FileNotFoundError("/secret/path/master.db")

    cov = build_coverage({"manadj": lambda: [], "engine": boom, "rekordbox": None})
    assert cov["sources"]["manadj"]["status"] == "read"
    assert cov["sources"]["engine"] == {**cov["sources"]["engine"], "status": "failed", "reason": "FileNotFoundError"}
    assert "secret" not in str(cov["sources"]["engine"])
    assert cov["sources"]["rekordbox"]["status"] == "not_configured"


def test_same_name_playlists_in_one_source_are_kept_apart():
    cov = build_coverage({
        "manadj": lambda: [_pl("Peak", "manadj", 1, ["a"])],
        "engine": lambda: [_pl("Peak", "engine", 7, ["a"]), _pl("Peak", "engine", 8, ["z"])],
        "rekordbox": None,
    })
    (row,) = cov["playlists"]
    assert [e["id"] for e in row["entries"]["engine"]] == ["7", "8"]
    assert len(row["entries"]["manadj"]) == 1 and row["entries"]["rekordbox"] == []


def test_only_source_marked_folders_are_dropped_never_guessed_from_names():
    def p(name, sid, files, folder):
        x = _pl(name, "engine", sid, files)
        x.is_folder = folder
        return x

    cov = build_coverage({
        "manadj": lambda: [],
        # "Archive" is a real folder; "Empty" has a child-looking name below it but the
        # source gives no type, so a genuine empty playlist is never erased.
        "engine": lambda: [p("Archive", 1, [], True), p("Archive > Peak", 2, ["a"], None), p("Empty", 3, [], None), p("Empty > Sub", 4, ["a"], None)],
        "rekordbox": None,
    })
    assert [x["name"] for x in cov["playlists"]] == ["Archive > Peak", "Empty", "Empty > Sub"]


def test_empty_non_folder_playlist_is_kept():
    cov = build_coverage({"manadj": lambda: [_pl("Empty", "manadj", 1, [])], "engine": None, "rekordbox": None})
    assert [p["name"] for p in cov["playlists"]] == ["Empty"]


def test_skipped_entries_are_reported_per_entry():
    p = _pl("Gappy", "engine", 3, ["a"])
    p.skipped_tracks = 2
    cov = build_coverage({"manadj": lambda: [], "engine": lambda: [p], "rekordbox": None})
    assert cov["playlists"][0]["entries"]["engine"][0]["skipped"] == 2


def test_engine_reader_counts_entries_without_a_path(tmp_path):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from enginedj.base import Base
    from enginedj.connection import EngineDJDatabase
    from enginedj.models.information import Information
    from enginedj.models.playlist import Playlist
    from enginedj.models.playlist_entity import PlaylistEntity
    from enginedj.models.track import Track
    from enginedj.playlist_reader import EnginePlaylistReader

    d = tmp_path / "Database2"
    d.mkdir()
    eng = create_engine(f"sqlite:///{d / 'm.db'}")
    Base.metadata.create_all(eng)
    with Session(eng) as s:
        s.add(Information(uuid="u", schemaVersionMajor=3, schemaVersionMinor=0, schemaVersionPatch=1))
        s.add_all([Track(id=1, path=str(tmp_path / "a.mp3"), filename="a.mp3"), Track(id=2, path=None, filename=None)])
        s.add(Playlist(id=1, title="Gappy", parentListId=None, isPersisted=True, nextListId=0))
        s.add_all([
            PlaylistEntity(id=1, listId=1, trackId=1, databaseUuid="u", nextEntityId=2, membershipReference=0),
            PlaylistEntity(id=2, listId=1, trackId=2, databaseUuid="u", nextEntityId=0, membershipReference=0),
        ])
        s.commit()
    eng.dispose()
    (info,) = EnginePlaylistReader(EngineDJDatabase(d)).get_all_playlists()
    assert [t.filename for t in info.tracks] == ["a.mp3"]
    assert info.skipped_tracks == 1
    assert info.path_parts == ["Gappy"]


def test_identity_is_the_source_path_not_the_display_string():
    folder = _pl("A > B", "engine", 1, ["a"])
    folder.path_parts = ["A", "B"]
    flat = _pl("A > B", "manadj", 7, ["a"])  # a playlist literally named "A > B"
    flat.path_parts = ["A > B"]
    cov = build_coverage({"manadj": lambda: [flat], "engine": lambda: [folder], "rekordbox": None})
    assert len(cov["playlists"]) == 2
    paths = sorted(tuple(p["path"]) for p in cov["playlists"])
    assert paths == [("A", "B"), ("A > B",)]
    by_path = {tuple(p["path"]): p for p in cov["playlists"]}
    assert by_path[("A > B",)]["entries"]["engine"] == [] and by_path[("A", "B")]["entries"]["manadj"] == []


def test_engine_parent_with_its_own_tracks_is_not_dropped_as_a_folder(tmp_path):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from enginedj.base import Base
    from enginedj.connection import EngineDJDatabase
    from enginedj.models.information import Information
    from enginedj.models.playlist import Playlist
    from enginedj.models.playlist_entity import PlaylistEntity
    from enginedj.models.track import Track
    from enginedj.playlist_reader import EnginePlaylistReader

    d = tmp_path / "Database2"
    d.mkdir()
    eng = create_engine(f"sqlite:///{d / 'm.db'}")
    Base.metadata.create_all(eng)
    with Session(eng) as s:
        s.add(Information(uuid="u", schemaVersionMajor=3, schemaVersionMinor=0, schemaVersionPatch=1))
        s.add(Track(id=1, path=str(tmp_path / "a.mp3"), filename="a.mp3"))
        s.add_all([
            Playlist(id=1, title="Pure folder", parentListId=None, isPersisted=True, nextListId=0),
            Playlist(id=2, title="Child", parentListId=1, isPersisted=True, nextListId=0),
            Playlist(id=3, title="Parent with tracks", parentListId=None, isPersisted=True, nextListId=0),
            Playlist(id=4, title="Kid", parentListId=3, isPersisted=True, nextListId=0),
        ])
        s.add(PlaylistEntity(id=1, listId=3, trackId=1, databaseUuid="u", nextEntityId=0, membershipReference=0))
        s.commit()
    eng.dispose()
    cov = build_coverage({"manadj": lambda: [], "engine": lambda: EnginePlaylistReader(EngineDJDatabase(d)).get_all_playlists(), "rekordbox": None})
    names = [p["name"] for p in cov["playlists"]]
    assert "Pure folder" not in names           # only a childful playlist with no entries of its own
    assert "Parent with tracks" in names         # direct content is never dropped
    tracks = next(p for p in cov["playlists"] if p["name"] == "Parent with tracks")["entries"]["engine"][0]["tracks"]
    assert [t["filename"] for t in tracks] == ["a.mp3"]
