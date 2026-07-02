"""Tests for backend.key.Key — the canonical Key module.

These tests encode the module's real interface: notation accessors are
*properties* (`.musical`, `.engine_id`, ...), not methods. Three production
call sites invoked nonexistent `.to_musical()` / `.to_engine()` methods and
were silently broken; anything resembling those must fail loudly here.
"""

import pytest

from backend.key import Key

ALL_ENGINE_IDS = range(24)


class TestConstruction:
    def test_from_engine_id_valid(self):
        key = Key.from_engine_id(0)
        assert key is not None
        assert key.engine_id == 0
        assert key.musical == "C"

    @pytest.mark.parametrize("bad", [-1, 24, 99])
    def test_from_engine_id_out_of_range(self, bad):
        assert Key.from_engine_id(bad) is None

    def test_from_engine_id_none(self):
        assert Key.from_engine_id(None) is None

    def test_from_musical(self):
        assert Key.from_musical("Am").engine_id == 1
        assert Key.from_musical("F#m").engine_id == 7

    def test_from_musical_accepts_openkey_strings(self):
        assert Key.from_musical("1d") == Key.from_musical("C")

    def test_from_musical_accepts_camelot_strings(self):
        assert Key.from_musical("8A") == Key.from_musical("Am")

    def test_from_musical_accepts_long_form(self):
        assert Key.from_musical("F Minor") == Key.from_musical("Fm")

    def test_from_musical_invalid(self):
        assert Key.from_musical("H#") is None
        assert Key.from_musical("") is None
        assert Key.from_musical(None) is None

    def test_from_openkey(self):
        assert Key.from_openkey("1m").engine_id == 1
        assert Key.from_openkey("nope") is None

    def test_from_camelot(self):
        assert Key.from_camelot("8B").engine_id == 0
        assert Key.from_camelot("13A") is None

    def test_from_mixxx_id(self):
        assert Key.from_mixxx_id(1).engine_id == 0
        assert Key.from_mixxx_id(0) is None
        assert Key.from_mixxx_id(25) is None


class TestNotationProperties:
    """The interface is properties. There are no to_*() methods."""

    @pytest.mark.parametrize("engine_id", ALL_ENGINE_IDS)
    def test_all_notations_defined_for_every_key(self, engine_id):
        key = Key.from_engine_id(engine_id)
        assert key.musical
        assert key.camelot
        assert key.openkey
        assert key.mixxx_id in range(1, 25)
        assert key.rekordbox == key.musical

    def test_known_mappings(self):
        key = Key.from_engine_id(1)  # Am
        assert (key.musical, key.camelot, key.openkey, key.mixxx_id) == ("Am", "8A", "1m", 22)

    def test_methods_do_not_exist(self):
        """Regression guard: the bugs called Key(...).to_musical()/to_engine()."""
        key = Key.from_engine_id(0)
        assert not hasattr(key, "to_musical")
        assert not hasattr(key, "to_engine")


class TestRoundTrips:
    @pytest.mark.parametrize("engine_id", ALL_ENGINE_IDS)
    def test_musical_round_trip(self, engine_id):
        key = Key.from_engine_id(engine_id)
        assert Key.from_musical(key.musical).engine_id == engine_id

    @pytest.mark.parametrize("engine_id", ALL_ENGINE_IDS)
    def test_openkey_round_trip(self, engine_id):
        key = Key.from_engine_id(engine_id)
        assert Key.from_openkey(key.openkey).engine_id == engine_id

    @pytest.mark.parametrize("engine_id", ALL_ENGINE_IDS)
    def test_camelot_round_trip(self, engine_id):
        key = Key.from_engine_id(engine_id)
        assert Key.from_camelot(key.camelot).engine_id == engine_id

    @pytest.mark.parametrize("engine_id", ALL_ENGINE_IDS)
    def test_mixxx_round_trip(self, engine_id):
        key = Key.from_engine_id(engine_id)
        assert Key.from_mixxx_id(key.mixxx_id).engine_id == engine_id


class TestEnharmonics:
    @pytest.mark.parametrize(
        "a,b",
        [("Gb", "F#"), ("C#", "Db"), ("Gbm", "F#m"), ("Dbm", "C#m"), ("G# Minor", "G#m")],
    )
    def test_enharmonic_equivalents(self, a, b):
        assert Key.from_musical(a) == Key.from_musical(b)


class TestEquality:
    def test_equal_and_hashable(self):
        assert Key.from_engine_id(5) == Key.from_engine_id(5)
        assert Key.from_engine_id(5) != Key.from_engine_id(6)
        assert len({Key.from_engine_id(5), Key.from_engine_id(5)}) == 1

    def test_not_equal_to_non_key(self):
        assert Key.from_engine_id(5) != 5
