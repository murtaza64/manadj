"""Tiering logic for the Ground truth corpus (ADR 0024).

Pure-function tests with synthesized value pairs — no DBs, no real Engine
blobs (ADR 0004), no heavy deps.
"""

import pytest

from backend.key import Key
from harness.corpus import (
    BPM_AGREEMENT,
    CorpusEntry,
    Override,
    SourceValues,
    build_entry,
    disputed_queue,
    parse_overrides,
    summarize,
)


def key(s: str) -> Key:
    k = Key.from_musical(s)
    assert k is not None
    return k


def entry(
    engine: SourceValues | None = None,
    rb: SourceValues | None = None,
    grid: list[dict] | None = None,
    override: Override | None = None,
) -> CorpusEntry:
    return build_entry(
        filename="/music/track.mp3",
        engine=engine,
        rb=rb,
        grid_tempo_changes=grid,
        override=override,
    )


class TestKeyTiering:
    def test_gold_when_engine_and_rb_agree(self):
        e = entry(
            engine=SourceValues(key=key("A Minor"), bpm=None),
            rb=SourceValues(key=key("Am"), bpm=None),
        )
        assert e.key.tier == "gold"
        assert e.key.truth == key("A Minor")

    def test_gold_across_enharmonic_notations(self):
        # Engine key ID vs Rekordbox ScaleName spelling of the same key
        e = entry(
            engine=SourceValues(key=Key.from_engine_id(key("Db Major").engine_id), bpm=None),
            rb=SourceValues(key=key("C# Major"), bpm=None),
        )
        assert e.key.tier == "gold"

    def test_disputed_on_disagreement(self):
        e = entry(
            engine=SourceValues(key=key("A Minor"), bpm=None),
            rb=SourceValues(key=key("E Minor"), bpm=None),
        )
        assert e.key.tier == "disputed"
        assert e.key.truth is None

    def test_engine_only(self):
        e = entry(engine=SourceValues(key=key("A Minor"), bpm=None), rb=None)
        assert e.key.tier == "engine_only"
        assert e.key.truth == key("A Minor")

    def test_engine_only_when_rb_track_lacks_key(self):
        e = entry(
            engine=SourceValues(key=key("A Minor"), bpm=None),
            rb=SourceValues(key=None, bpm=128.0),
        )
        assert e.key.tier == "engine_only"

    def test_rb_only(self):
        e = entry(rb=SourceValues(key=key("A Minor"), bpm=None))
        assert e.key.tier == "rb_only"
        assert e.key.truth == key("A Minor")

    def test_missing(self):
        e = entry()
        assert e.key.tier == "missing"
        assert e.key.truth is None


class TestBpmTiering:
    def test_gold_within_tolerance(self):
        e = entry(
            engine=SourceValues(key=None, bpm=174.0),
            rb=SourceValues(key=None, bpm=174.0 + BPM_AGREEMENT),
        )
        assert e.bpm.tier == "gold"
        assert e.bpm.truth == 174.0  # Engine is primary

    def test_disputed_beyond_tolerance(self):
        e = entry(
            engine=SourceValues(key=None, bpm=174.0),
            rb=SourceValues(key=None, bpm=174.2),
        )
        assert e.bpm.tier == "disputed"
        assert e.bpm.truth is None

    def test_half_time_disagreement_is_disputed(self):
        e = entry(
            engine=SourceValues(key=None, bpm=87.0),
            rb=SourceValues(key=None, bpm=174.0),
        )
        assert e.bpm.tier == "disputed"

    def test_engine_only_and_missing(self):
        assert entry(engine=SourceValues(key=None, bpm=140.0)).bpm.tier == "engine_only"
        assert entry().bpm.tier == "missing"


class TestOverrides:
    def test_override_promotes_disputed_key_to_gold(self):
        e = entry(
            engine=SourceValues(key=key("A Minor"), bpm=None),
            rb=SourceValues(key=key("E Minor"), bpm=None),
            override=Override(key=key("E Minor"), bpm=None),
        )
        assert e.key.tier == "gold"
        assert e.key.truth == key("E Minor")
        assert e.key.verified is True

    def test_override_promotes_disputed_bpm_to_gold(self):
        e = entry(
            engine=SourceValues(key=None, bpm=87.0),
            rb=SourceValues(key=None, bpm=174.0),
            override=Override(key=None, bpm=174.0),
        )
        assert e.bpm.tier == "gold"
        assert e.bpm.truth == 174.0

    def test_override_wins_even_over_agreeing_sources(self):
        # Hand verification outranks Engine+RB consensus (edited > imported).
        e = entry(
            engine=SourceValues(key=None, bpm=174.0),
            rb=SourceValues(key=None, bpm=174.0),
            override=Override(key=None, bpm=172.0),
        )
        assert e.bpm.truth == 172.0
        assert e.bpm.tier == "gold"

    def test_partial_override_leaves_other_field_alone(self):
        e = entry(
            engine=SourceValues(key=key("A Minor"), bpm=87.0),
            rb=SourceValues(key=key("E Minor"), bpm=174.0),
            override=Override(key=key("E Minor"), bpm=None),
        )
        assert e.key.tier == "gold"
        assert e.bpm.tier == "disputed"


class TestParseOverrides:
    def test_parses_key_and_bpm_any_notation(self):
        text = '''
["/music/a.mp3"]
key = "8A"
bpm = 174.0

["/music/b.mp3"]
key = "F Minor"
'''
        overrides = parse_overrides(text)
        assert overrides["/music/a.mp3"].key == key("8A")
        assert overrides["/music/a.mp3"].bpm == 174.0
        assert overrides["/music/b.mp3"].bpm is None

    def test_rejects_unparseable_key(self):
        with pytest.raises(ValueError, match="not-a-key"):
            parse_overrides('["/music/a.mp3"]\nkey = "not-a-key"\n')


class TestGridTruth:
    def test_constant_grid(self):
        e = entry(grid=[{"start_time": 0.11, "bpm": 174.0}])
        assert e.grid is not None
        assert e.grid.constant is True

    def test_variable_grid(self):
        e = entry(
            grid=[
                {"start_time": 0.11, "bpm": 174.0},
                {"start_time": 60.0, "bpm": 87.0},
            ]
        )
        assert e.grid is not None
        assert e.grid.constant is False

    def test_no_grid(self):
        assert entry().grid is None


class TestReporting:
    def make_entries(self):
        return [
            entry(  # gold key + gold bpm
                engine=SourceValues(key=key("A Minor"), bpm=174.0),
                rb=SourceValues(key=key("Am"), bpm=174.0),
            ),
            entry(  # disputed both
                engine=SourceValues(key=key("A Minor"), bpm=87.0),
                rb=SourceValues(key=key("E Minor"), bpm=174.0),
            ),
            entry(engine=SourceValues(key=key("C Major"), bpm=128.0)),  # engine_only
        ]

    def test_summarize_counts(self):
        s = summarize(self.make_entries())
        assert s["key"]["gold"] == 1
        assert s["key"]["disputed"] == 1
        assert s["key"]["engine_only"] == 1
        assert s["bpm"]["gold"] == 1
        assert s["bpm"]["disputed"] == 1

    def test_disputed_queue_lists_both_sides(self):
        rows = disputed_queue(self.make_entries())
        assert len(rows) == 1
        (row,) = rows
        assert row.filename == "/music/track.mp3"
        assert row.key.engine == key("A Minor")
        assert row.key.rb == key("E Minor")
        assert row.bpm.engine == 87.0
        assert row.bpm.rb == 174.0

    def test_disputed_queue_includes_single_field_disputes(self):
        rows = disputed_queue(
            [
                entry(
                    engine=SourceValues(key=key("A Minor"), bpm=174.0),
                    rb=SourceValues(key=key("A Minor"), bpm=175.0),
                )
            ]
        )
        assert len(rows) == 1


class TestSerialization:
    def test_round_trip(self):
        e = entry(
            engine=SourceValues(key=key("A Minor"), bpm=174.0),
            rb=SourceValues(key=key("Am"), bpm=174.0),
            grid=[{"start_time": 0.11, "bpm": 174.0}],
        )
        d = e.to_dict()
        assert d["filename"] == "/music/track.mp3"
        assert d["key"]["tier"] == "gold"
        assert d["key"]["truth"] == key("A Minor").openkey
        assert d["bpm"]["truth"] == 174.0
        assert d["grid"]["constant"] is True

        e2 = CorpusEntry.from_dict(d)
        assert e2 == e
