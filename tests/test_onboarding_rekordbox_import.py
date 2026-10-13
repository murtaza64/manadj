"""Rekordbox onboarding import (#274) — module-interface tests (ADR 0002).

A fixture Rekordbox library (plain-sqlite master.db built with
pyrekordbox's own table metadata, opened with unlock=False — the
external-DB seam) plus real temp audio files and a synthetic ANLZ .DAT.
Asserts tracks, cues (incl. the pink Color=0 and legacy Color=255 fixes),
grid, key, Main cue, tags, genre, playlists, dropped counts, enqueue
behavior (never stems), and the idempotent re-run.
"""

import json
import shutil
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine

from backend import models
from backend.onboarding.rekordbox_import import preview_import, run_import
from backend.tasks.models import Task
from rekordbox.anlz_grid import generate_beats, write_pqtz
from backend.sync_status.models import TempoChangeValue

from tests.conftest import FIXTURES_DIR
from tests.test_rekordbox_beatgrid_export import synthetic_dat

PINK = "#ED64D8"
YELLOW = "#E8DC28"
AM_ENGINE_ID = 1  # Key.from_musical("Am").engine_id


# -- fixture Rekordbox library -------------------------------------------------


def _row(cls, **kw):
    """A pyrekordbox table row with NOT NULL no-default columns zero-filled
    (the real DB carries values everywhere; the mappings mark them NOT NULL)."""
    from datetime import datetime as _dt

    from sqlalchemy import DateTime, Float, Integer

    for col in cls.__table__.columns:
        if col.name in kw or col.nullable or col.default is not None:
            continue
        if isinstance(col.type, Integer):
            kw[col.name] = 0
        elif isinstance(col.type, Float):
            kw[col.name] = 0.0
        elif isinstance(col.type, DateTime):
            kw[col.name] = _dt.now()
        else:
            kw[col.name] = ""
    return cls(**kw)


def build_rb_library(tmp_path: Path) -> tuple[Path, dict[str, Path]]:
    """A tiny Rekordbox library dir: master.db + share/ ANLZ + real files.

    t1: full-featured (cues, grid, key, genre, StockDate, tags, playlists)
    t2: bare local track
    t3: missing file  ·  t4: streaming (ServiceID set, no local path)
    """
    from pyrekordbox.db6.tables import (
        Base,
        DjmdArtist,
        DjmdContent,
        DjmdCue,
        DjmdGenre,
        DjmdKey,
        DjmdMyTag,
        DjmdPlaylist,
        DjmdSongMyTag,
        DjmdSongPlaylist,
    )
    from sqlalchemy.orm import sessionmaker

    lib = tmp_path / "rekordbox"
    (lib / "share" / "anlz").mkdir(parents=True)
    tracks_dir = tmp_path / "tracks"
    tracks_dir.mkdir()
    files = {}
    for name in ("t1", "t2"):
        files[name] = tracks_dir / f"{name}.wav"
        shutil.copy(FIXTURES_DIR / "silence.wav", files[name])
    files["t3"] = tracks_dir / "t3-missing.wav"  # never created

    # Synthetic ANLZ .DAT with a 128 BPM grid starting at 0.5s (wav: offset 0).
    dat = synthetic_dat(lib / "share" / "anlz")
    beats = generate_beats(
        [TempoChangeValue(start_time=0.5, bpm=128.0, bar_position=1)], end_s=30.0
    )
    write_pqtz(dat, beats)
    anlz_rel = "/anlz/" + dat.name

    engine = create_engine(f"sqlite:///{lib / 'master.db'}")
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()

    s.add(_row(DjmdKey, ID="k1", ScaleName="Am"))
    s.add(_row(DjmdArtist, ID="a1", Name="Artist One", SearchStr="artist one"))
    s.add(_row(DjmdGenre, ID="g1", Name="Techno"))
    s.add(_row(DjmdGenre, ID="g2", Name="House"))

    s.add(
        _row(
            DjmdContent,
            ID="c1",
            FolderPath=str(files["t1"]),
            Title="Track One",
            ArtistID="a1",
            GenreID="g1",
            KeyID="k1",
            BPM=12800,
            StockDate="2023-05-01",
            AnalysisDataPath=anlz_rel,
            ServiceID=0,
        )
    )
    s.add(
        _row(
            DjmdContent,
            ID="c2",
            FolderPath=str(files["t2"]),
            Title="Track Two",
            GenreID="g2",
            BPM=14000,
            ServiceID=0,
        )
    )
    s.add(
        _row(
            DjmdContent,
            ID="c3", FolderPath=str(files["t3"]), Title="Gone", ServiceID=0
        )
    )
    s.add(_row(DjmdContent, ID="c4", FolderPath="", Title="Streamed", ServiceID=2))

    def cue(id_, content, kind, ms, color=-1, comment="", out=-1, color_table=0):
        return _row(
            DjmdCue,
            ID=id_,
            ContentID=content,
            Kind=kind,
            InMsec=ms,
            OutMsec=out,
            Color=color,
            ColorTableIndex=color_table,
            Comment=comment,
        )

    # t1 cues: pad A pink (Color=0 — the falsy-color bug), pad B legacy
    # (Color=255 + ColorTableIndex=3 yellow), mirror twin at pad A's ms,
    # standalone memories at 5s (-> Main cue) and 8s (dropped), one loop.
    s.add(cue("q1", "c1", 1, 1000, color=0, comment="drop"))
    s.add(cue("q2", "c1", 2, 2000, color=255, color_table=3))
    s.add(cue("q3", "c1", 0, 1000))  # twin of q1
    s.add(cue("q4", "c1", 0, 5000))  # first standalone memory -> Main cue
    s.add(cue("q5", "c1", 0, 8000))  # second standalone memory -> dropped
    s.add(cue("q6", "c1", 0, 10000, out=14000))  # saved loop -> dropped

    # MyTags: Situation (imported), Energy (excluded by design).
    s.add(_row(DjmdMyTag, ID="m1", Seq=1, Name="Situation", ParentID="root"))
    s.add(_row(DjmdMyTag, ID="m2", Seq=1, Name="Opener", ParentID="m1"))
    s.add(_row(DjmdMyTag, ID="m3", Seq=2, Name="Closer", ParentID="m1"))
    s.add(_row(DjmdMyTag, ID="m4", Seq=2, Name="Energy", ParentID="root"))
    s.add(_row(DjmdMyTag, ID="m5", Seq=1, Name="High", ParentID="m4"))
    s.add(_row(DjmdSongMyTag, ID="sm1", MyTagID="m2", ContentID="c1"))
    s.add(_row(DjmdSongMyTag, ID="sm2", MyTagID="m3", ContentID="c2"))
    s.add(_row(DjmdSongMyTag, ID="sm3", MyTagID="m5", ContentID="c1"))  # Energy

    # Playlists: folder > playlist (play order 2,1; includes the missing
    # track), a smart playlist with stored rows, one without (skipped),
    # and a manadj-written playlist (skipped).
    s.add(_row(DjmdPlaylist, ID="p0", Seq=1, Name="Crates", Attribute=1, ParentID="root"))
    s.add(_row(DjmdPlaylist, ID="p1", Seq=1, Name="Party", Attribute=0, ParentID="p0"))
    s.add(_row(DjmdSongPlaylist, ID="sp1", PlaylistID="p1", ContentID="c2", TrackNo=1))
    s.add(_row(DjmdSongPlaylist, ID="sp2", PlaylistID="p1", ContentID="c1", TrackNo=2))
    s.add(_row(DjmdSongPlaylist, ID="sp3", PlaylistID="p1", ContentID="c3", TrackNo=3))
    s.add(_row(DjmdPlaylist, ID="p2", Seq=2, Name="Hot", Attribute=4, ParentID="root"))
    s.add(_row(DjmdSongPlaylist, ID="sp4", PlaylistID="p2", ContentID="c1", TrackNo=1))
    s.add(_row(DjmdPlaylist, ID="p3", Seq=3, Name="Empty Smart", Attribute=4, ParentID="root"))
    s.add(_row(DjmdPlaylist, ID="p4", Seq=4, Name="manadj Export", Attribute=0, ParentID="root"))
    # manadj-exported playlists under a "manadj Playlists" folder are
    # skipped by ancestry, not just by leaf name.
    s.add(_row(DjmdPlaylist, ID="p5", Seq=5, Name="manadj Playlists", Attribute=1, ParentID="root"))
    s.add(_row(DjmdPlaylist, ID="p6", Seq=1, Name="exported", Attribute=0, ParentID="p5"))
    s.add(_row(DjmdSongPlaylist, ID="sp5", PlaylistID="p6", ContentID="c1", TrackNo=1))

    s.commit()
    s.close()
    engine.dispose()
    return lib, files


@pytest.fixture
def rb_db(tmp_path):
    from pyrekordbox.db6 import Rekordbox6Database

    lib, files = build_rb_library(tmp_path)
    db = Rekordbox6Database(path=lib / "master.db", db_dir=lib, unlock=False)
    yield db, files
    db.close()


# -- preview -------------------------------------------------------------------


def test_preview_counts(db, rb_db):
    rb, _files = rb_db
    p = preview_import(db, rb)
    assert p.tracks_total == 4
    assert p.tracks_importable == 2
    assert p.tracks_already_imported == 0
    assert p.tracks_missing_file == 1
    assert p.tracks_streaming == 1
    assert p.hotcues == 2
    assert p.saved_loops == 1
    assert p.grids == 1
    assert p.keys == 1
    assert p.tag_categories == 1  # Energy excluded
    assert p.tags == 2
    assert p.tag_assignments == 2  # the Energy assignment excluded
    assert p.genres == 2
    assert p.playlists == 2  # Party + Hot (snapshotable); folders never counted
    assert p.smart_playlists == 1
    assert p.smart_playlists_skipped == 1


def test_preview_counts_already_imported(db, rb_db, make_track):
    rb, files = rb_db
    make_track(filename=str(files["t1"]))
    assert preview_import(db, rb).tracks_already_imported == 1


# -- run -----------------------------------------------------------------------


def test_import_tracks_fields(db, rb_db):
    rb, files = rb_db
    summary = run_import(db, rb)
    assert summary.tracks_imported == 2
    assert summary.tracks_missing_file == 1
    assert summary.tracks_streaming == 1

    t1 = db.query(models.Track).filter_by(filename=str(files["t1"])).one()
    assert t1.title == "Track One"
    assert t1.artist == "Artist One"
    assert t1.created_at.strftime("%Y-%m-%d") == "2023-05-01"  # StockDate
    assert t1.key == AM_ENGINE_ID
    assert t1.key_provenance == "imported"
    t2 = db.query(models.Track).filter_by(filename=str(files["t2"])).one()
    assert t2.bpm == 14000
    assert t2.key is None


def test_import_hotcues_with_color_fixes(db, rb_db):
    rb, files = rb_db
    summary = run_import(db, rb)
    assert summary.hotcues_applied == 1  # one track had hot cues
    t1 = db.query(models.Track).filter_by(filename=str(files["t1"])).one()
    cues = {c.slot_number: c for c in t1.hotcues}
    assert set(cues) == {1, 2}
    assert cues[1].time_seconds == pytest.approx(1.0)
    assert cues[1].label == "drop"
    assert cues[1].color == PINK  # Color=0 must not be dropped
    assert cues[2].color == YELLOW  # legacy Color=255 + ColorTableIndex


def test_import_maincue_grid_and_dropped_counts(db, rb_db):
    rb, files = rb_db
    summary = run_import(db, rb)
    t1 = db.query(models.Track).filter_by(filename=str(files["t1"])).one()
    assert t1.cue_point_time == pytest.approx(5.0)  # first standalone memory
    assert summary.maincues_applied == 1
    assert summary.dropped_memory_cues == 1  # the 8s memory
    assert summary.dropped_loops == 1

    assert summary.beatgrids_applied == 1
    grid = t1.beatgrid
    assert grid.origin == "imported"
    changes = json.loads(grid.tempo_changes_json)
    assert changes[0]["bpm"] == pytest.approx(128.0)
    assert changes[0]["start_time"] == pytest.approx(0.5, abs=0.01)
    assert t1.bpm == 12800  # projection keeps the dominant BPM


def test_import_tags_and_genre(db, rb_db):
    rb, files = rb_db
    summary = run_import(db, rb)
    assert summary.tag_categories_created == 2  # Situation + Genre
    assert summary.tags_created == 2  # Opener, Closer
    assert summary.tag_assignments_added == 2
    assert summary.genre_tags_created == 2  # Techno, House
    assert summary.genre_assignments_added == 2

    cats = {c.name for c in db.query(models.TagCategory).all()}
    assert cats == {"Situation", "Genre"}  # Energy excluded
    t1 = db.query(models.Track).filter_by(filename=str(files["t1"])).one()
    t1_tags = {tt.tag.name for tt in t1.track_tags}
    assert t1_tags == {"Opener", "Techno"}


def test_import_genre_toggle_off(db, rb_db):
    rb, _files = rb_db
    run_import(db, rb, include_genre=False)
    assert {c.name for c in db.query(models.TagCategory).all()} == {"Situation"}


def test_import_playlists(db, rb_db):
    rb, files = rb_db
    summary = run_import(db, rb)
    assert summary.playlists_created == 2
    assert summary.smart_playlists_snapshotted == 1
    assert summary.smart_playlists_skipped == 1

    names = {p.name for p in db.query(models.Playlist).all()}
    assert names == {"Crates > Party", "Hot"}  # folder flattened; manadj skipped
    party = db.query(models.Playlist).filter_by(name="Crates > Party").one()
    entries = sorted(party.playlist_tracks, key=lambda e: e.position)
    t_by_id = {t.id: t for t in db.query(models.Track).all()}
    # play order preserved (t2 first); the missing-file track is skipped
    assert [t_by_id[e.track_id].filename for e in entries] == [
        str(files["t2"]),
        str(files["t1"]),
    ]


def test_import_enqueues_waveforms_and_analysis_never_stems(db, rb_db):
    rb, _files = rb_db
    run_import(db, rb)
    types = {t.type for t in db.query(Task).all()}
    assert "waveform" in types
    assert "analysis" in types
    assert "stem-split" not in types


def test_reimport_is_idempotent(db, rb_db):
    rb, _files = rb_db
    run_import(db, rb)
    counts = lambda: (  # noqa: E731
        db.query(models.Track).count(),
        db.query(models.HotCue).count(),
        db.query(models.TagCategory).count(),
        db.query(models.Tag).count(),
        db.query(models.TrackTag).count(),
        db.query(models.Playlist).count(),
        db.query(models.PlaylistTrack).count(),
    )
    before = counts()
    second = run_import(db, rb)
    assert counts() == before
    assert second.tracks_imported == 0
    assert second.tracks_already_imported == 2
    assert second.hotcues_applied == 0
    assert second.beatgrids_applied == 0
    assert second.maincues_applied == 0
    assert second.keys_applied == 0
    assert second.tag_categories_created == 0
    assert second.tags_created == 0
    assert second.tag_assignments_added == 0
    assert second.genre_tags_created == 0
    assert second.playlists_created == 0
    assert second.playlists_already_present == 2


def test_reimport_leaves_user_edits_alone(db, rb_db):
    """Fill-blanks: a re-run never changes what the user has since edited."""
    rb, files = rb_db
    run_import(db, rb)
    t1 = db.query(models.Track).filter_by(filename=str(files["t1"])).one()
    t1.key = 7
    t1.key_provenance = "manual"
    t1.cue_point_time = 42.0
    db.commit()
    summary = run_import(db, rb)
    db.refresh(t1)
    assert t1.key == 7 and t1.key_provenance == "manual"
    assert t1.cue_point_time == 42.0
    assert summary.pending_conflicts >= 2  # reported, not applied


# -- the old sync-path key bug (#274: KeyID is a FK, not a Mixxx id) -----------


def test_executor_import_uses_scale_name(db):
    from backend.tracks.executor import import_tracks_from_rekordbox

    rb_track = SimpleNamespace(
        FolderPath="/music/x.wav",
        Title="X",
        BPM=12345,
        KeyID="9999",  # FK junk — must not be interpreted as a key id
        Key=SimpleNamespace(ScaleName="Am"),
        Artist=None,
    )
    imported = import_tracks_from_rekordbox([rb_track], db, dry_run=False)
    assert imported == 1
    track = db.query(models.Track).filter_by(filename="/music/x.wav").one()
    assert track.key == AM_ENGINE_ID
    assert track.key_provenance == "imported"


# -- imported tag colors (#326) -------------------------------------------------


def test_imported_tags_and_categories_get_saturated_colors(db, rb_db):
    from backend.tag_palette import TAG_COLORS

    rb, _files = rb_db
    summary = run_import(db, rb)
    rows = db.query(models.TagCategory).all() + db.query(models.Tag).all()
    assert rows and all(r.color in TAG_COLORS for r in rows)
    assert summary.tag_colors_assigned == len(rows)
    # siblings draw from a shuffled deck: no repeats until the palette cycles
    situation = db.query(models.TagCategory).filter_by(name="Situation").one()
    colors = [t.color for t in situation.tags]
    assert len(set(colors)) == len(colors)


def test_reimport_fills_grey_tags_but_never_overwrites_colors(db, rb_db):
    rb, _files = rb_db
    run_import(db, rb)
    opener = db.query(models.Tag).filter_by(name="Opener").one()
    closer = db.query(models.Tag).filter_by(name="Closer").one()
    opener.color = "#123456"  # user-chosen
    closer.color = None  # grey from a pre-#326 import
    db.commit()
    summary = run_import(db, rb)
    db.refresh(opener)
    db.refresh(closer)
    assert opener.color == "#123456"
    assert closer.color is not None
    assert summary.tag_colors_assigned == 1
