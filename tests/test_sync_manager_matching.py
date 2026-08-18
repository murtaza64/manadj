"""Sync managers' matching + agreement, pinned at the manager interface.

Match (``match_by_key``) and "in sync" (``in_sync``) now live once in
``backend.sync_common.matching`` and the tags/playlists managers consume them
(collapsing the triplicated name-matchers and ``_check_if_synced``). These
tests pin that shared behavior through the managers' own methods, substituting
only at the reader/DB seam (ADR 0002).

Scope note: these do NOT drive a whole-manager write path through an
in-memory Surface — the read/write Surface seam was not delivered (see the
issue's 2026-08-18 rescope). They cover exactly what shipped: the de-triplicated
Match and agreement predicates as the managers call them.
"""

from backend.playlists.matching import match_playlists_by_name
from backend.playlists.models import PlaylistInfo, TrackReference
from backend.playlists.sync_manager import PlaylistSyncManager
from backend.tags.comparison import match_tags_by_name
from backend.tags.models import CategoryInfo, TagInfo, TagStructure
from backend.tags.sync_manager import TagSyncManager


def _tag(name, category):
    return TagInfo(
        name=name, category_name=category, source="x",
        tag_id=1, category_id=1, display_order=None, track_count=0,
    )


def _structure(source, category, names):
    return TagStructure(
        source=source,
        categories=[
            CategoryInfo(
                name=category, source=source, category_id=1,
                tags=[_tag(n, category) for n in names],
            )
        ],
        total_tags=len(names),
    )


def _pl(name, source, paths):
    return PlaylistInfo(
        name=name,
        tracks=[TrackReference(path=p, filename=p.split("/")[-1]) for p in paths],
        source=source, source_id=1, hierarchy_parts=None, last_modified=None,
    )


class TestTagMatchByName:
    def test_manadj_and_rekordbox_match_on_category_and_name(self):
        m = match_tags_by_name(
            {
                "manadj": _structure("manadj", "Genre", ["House", "DnB"]),
                "rekordbox": _structure("rekordbox", "Genre", ["DnB"]),
                "engine": None,
            }
        )
        assert m[("Genre", "House")]["rekordbox"] is None
        assert m[("Genre", "DnB")]["rekordbox"] is not None

    def test_engine_folds_in_by_name_only(self):
        """Engine's flat structure has no categories: it matches any bucket
        sharing its tag name."""
        m = match_tags_by_name(
            {
                "manadj": _structure("manadj", "Genre", ["House"]),
                "engine": _structure("engine", "", ["House"]),
                "rekordbox": None,
            }
        )
        assert m[("Genre", "House")]["engine"] is not None


class TestTagInSync:
    def _tag_info(self, count):
        t = _tag("House", "Genre")
        t.track_count = count
        return t

    def test_manadj_required(self, db):
        mgr = TagSyncManager(db)
        assert mgr._check_if_synced({"manadj": None}) is False

    def test_configured_source_must_carry_the_tag(self, db):
        mgr = TagSyncManager(db)
        mgr.engine_reader = object()  # pretend Engine is configured
        assert mgr._check_if_synced({"manadj": self._tag_info(3), "engine": None}) is False

    def test_in_sync_requires_matching_track_counts(self, db):
        mgr = TagSyncManager(db)
        mgr.engine_reader = object()
        assert mgr._check_if_synced(
            {"manadj": self._tag_info(3), "engine": self._tag_info(4)}
        ) is False
        assert mgr._check_if_synced(
            {"manadj": self._tag_info(3), "engine": self._tag_info(3)}
        ) is True

    def test_unconfigured_source_is_ignored(self, db):
        """No engine/rb reader configured: a lone manadj tag is in sync."""
        mgr = TagSyncManager(db)
        assert mgr._check_if_synced({"manadj": self._tag_info(3)}) is True


class TestPlaylistMatchByName:
    def test_matches_case_sensitively_by_name(self):
        m = match_playlists_by_name(
            {
                "manadj": [_pl("Set 1", "manadj", ["/m/a.mp3"])],
                "engine": [_pl("Set 1", "engine", ["/m/a.mp3"])],
                "rekordbox": [_pl("set 1", "rekordbox", ["/m/a.mp3"])],  # different case
            }
        )
        assert m["Set 1"]["engine"] is not None
        assert m["Set 1"]["rekordbox"] is None  # case-sensitive: no match
        assert "set 1" in m  # the differently-cased one is its own bucket


class TestPlaylistInSync:
    def test_identical_playlists_are_in_sync(self, db):
        mgr = PlaylistSyncManager(db)
        p = _pl("Set 1", "manadj", ["/m/a.mp3", "/m/b.mp3"])
        assert mgr._check_if_synced(
            {"manadj": p, "engine": _pl("Set 1", "engine", ["/m/a.mp3", "/m/b.mp3"]), "rekordbox": None}
        ) is True

    def test_reordered_playlists_diverge(self, db):
        mgr = PlaylistSyncManager(db)
        assert mgr._check_if_synced(
            {
                "manadj": _pl("Set 1", "manadj", ["/m/a.mp3", "/m/b.mp3"]),
                "engine": _pl("Set 1", "engine", ["/m/b.mp3", "/m/a.mp3"]),
                "rekordbox": None,
            }
        ) is False

    def test_single_source_is_in_sync(self, db):
        mgr = PlaylistSyncManager(db)
        assert mgr._check_if_synced(
            {"manadj": _pl("Solo", "manadj", ["/m/a.mp3"]), "engine": None, "rekordbox": None}
        ) is True
