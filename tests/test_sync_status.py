"""Tests for backend.sync_status — the unified sync view aggregator.

Tested through its single interface (compute_sync_status) with fake
SurfaceReaders and the real in-memory DB, per ADR-0002/0004 and the PRD
(.scratch/unified-sync-view/PRD.md). Fakes sit only at the SurfaceReader seam.
"""


from backend.sync_status import (
    SurfaceTrackRef,
    TrackFields,
    compute_sync_status,
)


class FakeSurfaceReader:
    """Fake at the SurfaceReader seam: canned refs, declared field support."""

    def __init__(self, refs: list[SurfaceTrackRef], fields: frozenset[str]) -> None:
        self._refs = refs
        self.fields = fields

    def list_tracks(self) -> list[SurfaceTrackRef]:
        return self._refs


ENGINE_FIELDS = frozenset({"title", "artist", "key", "bpm", "tags"})
REKORDBOX_FIELDS = frozenset({"title", "artist", "key", "energy", "tags"})
DISK_FIELDS = frozenset({"title", "artist", "key", "bpm"})


def ref(path: str, **fields) -> SurfaceTrackRef:
    return SurfaceTrackRef(path=path, fields=TrackFields(**fields))


def surfaces(engine=None, rekordbox=None, disk=None):
    return {
        "engine": FakeSurfaceReader(engine or [], ENGINE_FIELDS),
        "rekordbox": FakeSurfaceReader(rekordbox or [], REKORDBOX_FIELDS),
        "disk": FakeSurfaceReader(disk or [], DISK_FIELDS),
    }


def row_for(result, title=None, path=None):
    hits = [r for r in result.rows if (title and r.title == title) or (path and r.path == path)]
    assert len(hits) == 1, f"expected 1 row, got {len(hits)}"
    return hits[0]


class TestPresenceAndRollup:
    def test_in_sync_track(self, db, make_track):
        t = make_track(filename="/m/a.mp3", title="A", artist="X")
        s = surfaces(
            engine=[ref("/m/a.mp3", title="A", artist="X")],
            rekordbox=[ref("/m/a.mp3", title="A", artist="X")],
            disk=[ref("/m/a.mp3", title="A", artist="X")],
        )
        result = compute_sync_status(db, s)
        row = row_for(result, title="A")
        assert row.track_id == t.id
        assert row.status == "in-sync"
        assert row.presence == {"disk": True, "library": True, "engine": True, "rekordbox": True}

    def test_missing_downstream(self, db, make_track):
        make_track(filename="/m/b.mp3", title="B", artist=None)
        result = compute_sync_status(db, surfaces(disk=[ref("/m/b.mp3", title="B")]))
        row = row_for(result, title="B")
        assert row.status == "missing-downstream"
        assert row.presence["engine"] is False
        assert row.presence["rekordbox"] is False

    def test_not_in_library_merges_across_external_surfaces(self, db):
        """A track on Engine AND Rekordbox but not in manadj is ONE row."""
        s = surfaces(
            engine=[ref("/m/c.mp3", title="C")],
            rekordbox=[ref("/other/dir/c.mp3", title="C")],  # filename-tier match
        )
        result = compute_sync_status(db, s)
        row = row_for(result, path="/m/c.mp3")
        assert row.status == "not-in-library"
        assert row.presence["engine"] is True
        assert row.presence["rekordbox"] is True
        assert row.presence["library"] is False

    def test_disk_only_file_is_unimported(self, db):
        result = compute_sync_status(db, surfaces(disk=[ref("/m/new.flac", title="New")]))
        row = row_for(result, path="/m/new.flac")
        assert row.status == "unimported"

    def test_match_uses_filename_fallback(self, db, make_track):
        make_track(filename="/library/d.mp3", title="D")
        result = compute_sync_status(db, surfaces(engine=[ref("/usb/music/d.mp3", title="D")]))
        assert row_for(result, title="D").presence["engine"] is True

    def test_counts(self, db, make_track):
        make_track(filename="/m/a.mp3", title="A")  # missing downstream
        s = surfaces(engine=[ref("/m/z.mp3", title="Z")])  # not in library
        result = compute_sync_status(db, s)
        assert result.counts["missing-downstream"] == 1
        assert result.counts["not-in-library"] == 1
        assert result.counts["in-sync"] == 0


class TestDivergence:
    def test_canonical_example_title_diverges_on_one_surface(self, db, make_track):
        """PRD: title agrees on Disk+Rekordbox, diverges on Engine."""
        make_track(filename="/m/hot.mp3", title="Mans Not Hot (Full DNB Mix)", artist="Big Shaq")
        s = surfaces(
            disk=[ref("/m/hot.mp3", title="Mans Not Hot (Full DNB Mix)", artist="Big Shaq")],
            rekordbox=[ref("/m/hot.mp3", title="Mans Not Hot (Full DNB Mix)", artist="Big Shaq")],
            engine=[ref("/m/hot.mp3", title="mans not hot dnb FINAL v2", artist="Big Shaq")],
        )
        result = compute_sync_status(db, s)
        row = row_for(result, path="/m/hot.mp3")
        assert row.status == "diverged"
        d = row.diverged[0]
        assert d.field == "title"
        assert d.library_value == "Mans Not Hot (Full DNB Mix)"
        assert d.surface_values == {"engine": "mans not hot dnb FINAL v2"}
        # agreeing surfaces are NOT listed as diverged
        assert "disk" not in d.surface_values
        assert "rekordbox" not in d.surface_values

    def test_key_compared_canonically_not_stringly(self, db, make_track):
        """Key 1 == 'Am' == '8A' — notation differences are not divergences."""
        make_track(filename="/m/k.mp3", title="K", key=1)
        result = compute_sync_status(
            db, surfaces(engine=[ref("/m/k.mp3", title="K", key=1)])
        )
        row = row_for(result, title="K")
        assert all(d.field != "key" for d in row.diverged)

    def test_bpm_tolerance(self, db, make_track):
        """174.0 vs 174.00 (float noise) is not a divergence."""
        make_track(filename="/m/t.mp3", title="T", bpm=17400)
        result = compute_sync_status(
            db, surfaces(engine=[ref("/m/t.mp3", title="T", bpm=174.004)])
        )
        row = row_for(result, title="T")
        assert all(d.field != "bpm" for d in row.diverged)

    def test_field_not_carried_by_surface_never_diverges(self, db, make_track):
        """Disk doesn't carry energy; its absence there is not a divergence."""
        make_track(filename="/m/e.mp3", title="E", energy=4)
        result = compute_sync_status(
            db, surfaces(disk=[ref("/m/e.mp3", title="E")])
        )
        row = row_for(result, title="E")
        assert all(d.field != "energy" for d in row.diverged)

    def test_importable_from_respects_capabilities(self, db, make_track):
        make_track(filename="/m/i.mp3", title="I", key=None)
        result = compute_sync_status(
            db, surfaces(engine=[ref("/m/i.mp3", title="I", key=7)])
        )
        row = row_for(result, title="I")
        d = next(x for x in row.diverged if x.field == "key")
        assert "engine" in d.importable_from


class TestTagAssignments:
    def _track_with_tags(self, db, make_track, names):
        from backend.models import Tag, TagCategory, TrackTag

        track = make_track(filename="/m/tags.mp3", title="Tagged")
        cat = TagCategory(name="Genre")
        db.add(cat)
        db.commit()
        for name in names:
            tag = Tag(name=name, category_id=cat.id)
            db.add(tag)
            db.commit()
            db.add(TrackTag(track_id=track.id, tag_id=tag.id))
        db.commit()
        return track

    def test_tag_diff(self, db, make_track):
        self._track_with_tags(db, make_track, ["DnB", "Jump Up"])
        s = surfaces(rekordbox=[ref("/m/tags.mp3", title="Tagged", tags=["DnB", "Wave"])])
        result = compute_sync_status(db, s)
        row = row_for(result, title="Tagged")
        d = next(x for x in row.diverged if x.field == "tags")
        assert d.library_value == ["DnB", "Jump Up"]
        assert d.surface_values == {"rekordbox": ["DnB", "Wave"]}

    def test_matching_tags_do_not_diverge_regardless_of_order(self, db, make_track):
        self._track_with_tags(db, make_track, ["DnB", "Jump Up"])
        s = surfaces(rekordbox=[ref("/m/tags.mp3", title="Tagged", tags=["Jump Up", "DnB"])])
        result = compute_sync_status(db, s)
        row = row_for(result, title="Tagged")
        assert all(d.field != "tags" for d in row.diverged)

    def test_unprocessed_flag(self, db, make_track):
        make_track(filename="/m/u.mp3", title="U")  # no tags
        result = compute_sync_status(db, surfaces())
        assert row_for(result, title="U").unprocessed is True

    def test_tagged_track_not_unprocessed(self, db, make_track):
        self._track_with_tags(db, make_track, ["DnB"])
        result = compute_sync_status(db, surfaces())
        assert row_for(result, title="Tagged").unprocessed is False


class TestNoOverwriteRule:
    def test_empty_library_value_flags_no_overwrite(self, db, make_track):
        """PRD/CONTEXT.md Export rule: empty Library value never overwrites a
        Surface's value — the divergence carries a warning and Export must
        skip the field."""
        make_track(filename="/m/n.mp3", title="N", key=None)
        result = compute_sync_status(
            db, surfaces(engine=[ref("/m/n.mp3", title="N", key=11)])
        )
        row = row_for(result, title="N")
        d = next(x for x in row.diverged if x.field == "key")
        assert d.library_value is None
        assert d.no_overwrite is True
        assert row.warnings  # human-readable warning present

    def test_populated_library_value_has_no_warning(self, db, make_track):
        make_track(filename="/m/p.mp3", title="P", key=3)
        result = compute_sync_status(
            db, surfaces(engine=[ref("/m/p.mp3", title="P", key=11)])
        )
        d = next(x for x in row_for(result, title="P").diverged if x.field == "key")
        assert d.no_overwrite is False


class TestPathlessRefs:
    def test_pathless_surface_refs_are_ignored(self, db):
        result = compute_sync_status(db, surfaces(engine=[ref(None, title="ghost")]))
        assert result.rows == []
