"""Tests for enginedj.ratings — the Energy ↔ Engine star-rating encoding.

Engine stores ratings as 0-100 ints (star = rating/20; 0 = unrated).
manadj's Energy is 1-5. The mapping is the enginedj package's format
knowledge, like the performance-data blob decoders.
"""

import pytest

from enginedj.ratings import energy_to_rating, rating_to_energy


class TestRatingToEnergy:
    def test_exact_star_multiples(self):
        assert rating_to_energy(20) == 1
        assert rating_to_energy(40) == 2
        assert rating_to_energy(60) == 3
        assert rating_to_energy(80) == 4
        assert rating_to_energy(100) == 5

    def test_unrated_is_absent(self):
        assert rating_to_energy(0) is None
        assert rating_to_energy(None) is None

    def test_negative_is_absent(self):
        assert rating_to_energy(-20) is None

    def test_non_multiple_rounds_to_nearest_star(self):
        assert rating_to_energy(50) == 3  # half a star rounds up
        assert rating_to_energy(55) == 3
        assert rating_to_energy(89) == 4
        assert rating_to_energy(95) == 5

    def test_positive_below_half_star_clamps_to_one(self):
        assert rating_to_energy(5) == 1

    def test_above_range_clamps_to_five(self):
        assert rating_to_energy(120) == 5


class TestEnergyToRating:
    def test_energy_maps_to_star_multiples(self):
        assert energy_to_rating(1) == 20
        assert energy_to_rating(2) == 40
        assert energy_to_rating(3) == 60
        assert energy_to_rating(4) == 80
        assert energy_to_rating(5) == 100

    def test_out_of_range_energy_rejected(self):
        with pytest.raises(ValueError):
            energy_to_rating(0)
        with pytest.raises(ValueError):
            energy_to_rating(6)


class TestRoundTrip:
    @pytest.mark.parametrize("energy", [1, 2, 3, 4, 5])
    def test_round_trip(self, energy):
        assert rating_to_energy(energy_to_rating(energy)) == energy
