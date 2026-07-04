"""Tests for the Engine tag export's energy step — Library Energy written to
Engine DJ as star ratings.

Per ADR 0004: the Engine side is a schema-real in-memory SQLite built from the
enginedj package's own SQLAlchemy models (no m.db fixtures). Rating writes are
simple column updates on matched tracks — none of the corruption-prone playlist
machinery is involved, and these tests seed no tag categories so the playlist
path stays cold.
"""

from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.tags.engine_writer import EngineTagWriter
from enginedj.base import Base as EngineBase
from enginedj.models.track import Track as EDJTrack


class InMemoryEngineDB:
    """EngineDJDatabase stand-in: same session_m/session_m_write surface over
    a schema-real in-memory database."""

    def __init__(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            poolclass=StaticPool,
            connect_args={"check_same_thread": False},
        )
        EngineBase.metadata.create_all(self.engine)
        self._sessions = sessionmaker(bind=self.engine)

    @contextmanager
    def session_m(self):
        session = self._sessions()
        try:
            yield session
        finally:
            session.close()

    @contextmanager
    def session_m_write(self):
        session = self._sessions()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()


def make_edj_track(edb: InMemoryEngineDB, path: str, rating: int | None = None) -> None:
    with edb.session_m_write() as s:
        s.add(EDJTrack(path=path, filename=path.rsplit("/", 1)[-1], rating=rating))


def edj_rating(edb: InMemoryEngineDB, path: str) -> int | None:
    with edb.session_m() as s:
        return s.query(EDJTrack).filter_by(path=path).one().rating


def run_export(db, edb, **kwargs):
    return EngineTagWriter(db, edb).sync_tag_structure(dry_run=False, **kwargs)


class TestEnergyRatingExport:
    def test_energy_written_as_star_rating(self, db, make_track):
        make_track(filename="/m/a.mp3", energy=4)
        edb = InMemoryEngineDB()
        make_edj_track(edb, "/m/a.mp3", rating=0)
        stats = run_export(db, edb)
        assert edj_rating(edb, "/m/a.mp3") == 80
        assert stats.tracks_rated == 1

    def test_runs_without_any_tag_categories(self, db, make_track):
        """The energy step must not be gated on tag structure existing."""
        make_track(filename="/m/b.mp3", energy=1)
        edb = InMemoryEngineDB()
        make_edj_track(edb, "/m/b.mp3")
        run_export(db, edb)
        assert edj_rating(edb, "/m/b.mp3") == 20

    def test_empty_library_energy_never_overwrites(self, db, make_track):
        make_track(filename="/m/c.mp3", energy=None)
        edb = InMemoryEngineDB()
        make_edj_track(edb, "/m/c.mp3", rating=60)
        stats = run_export(db, edb)
        assert edj_rating(edb, "/m/c.mp3") == 60
        assert stats.tracks_rated == 0

    def test_reexport_is_idempotent(self, db, make_track):
        make_track(filename="/m/d.mp3", energy=5)
        edb = InMemoryEngineDB()
        make_edj_track(edb, "/m/d.mp3")
        first = run_export(db, edb)
        second = run_export(db, edb)
        assert first.tracks_rated == 1
        assert second.tracks_rated == 0  # already at 100: nothing to write
        assert edj_rating(edb, "/m/d.mp3") == 100

    def test_dry_run_writes_nothing(self, db, make_track):
        make_track(filename="/m/e.mp3", energy=3)
        edb = InMemoryEngineDB()
        make_edj_track(edb, "/m/e.mp3", rating=0)
        stats = EngineTagWriter(db, edb).sync_tag_structure(dry_run=True)
        assert edj_rating(edb, "/m/e.mp3") == 0
        assert stats.tracks_rated == 1  # reported, not written

    def test_include_energy_false_skips_the_step(self, db, make_track):
        make_track(filename="/m/f.mp3", energy=3)
        edb = InMemoryEngineDB()
        make_edj_track(edb, "/m/f.mp3", rating=0)
        stats = run_export(db, edb, include_energy=False)
        assert edj_rating(edb, "/m/f.mp3") == 0
        assert stats.tracks_rated == 0

    def test_archived_track_leaves_export(self, db, make_track):
        """CONTEXT.md: an Archived Track leaves Export."""
        from datetime import datetime, timezone

        track = make_track(filename="/m/g.mp3", energy=5)
        track.archived_at = datetime.now(timezone.utc)
        db.commit()
        edb = InMemoryEngineDB()
        make_edj_track(edb, "/m/g.mp3", rating=0)
        stats = run_export(db, edb)
        assert edj_rating(edb, "/m/g.mp3") == 0
        assert stats.tracks_rated == 0

    def test_unmatched_track_counted(self, db, make_track):
        make_track(filename="/m/only-in-library.mp3", energy=2)
        edb = InMemoryEngineDB()
        stats = run_export(db, edb)
        assert stats.tracks_unmatched == 1
        assert stats.tracks_rated == 0

    def test_export_brings_diverged_row_in_sync(self, db, make_track):
        """Issue 02 AC: after an export, a previously energy-diverged Engine
        row compares in sync — closed through the real surface reader over
        the same schema-real database the writer wrote."""
        from backend.sync_status import compute_sync_status
        from backend.sync_status.adapters import EngineSurfaceReader

        make_track(filename="/m/rt.mp3", title="RT", energy=4)
        edb = InMemoryEngineDB()
        make_edj_track(edb, "/m/rt.mp3")

        def energy_diverged() -> bool:
            result = compute_sync_status(db, {"engine": EngineSurfaceReader(edb)})
            row = next(r for r in result.rows if r.title == "RT")
            return any(d.field == "energy" for d in row.diverged)

        assert energy_diverged()
        run_export(db, edb)
        assert not energy_diverged()
