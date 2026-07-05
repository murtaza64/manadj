"""MIREX-weighted key scoring (ADR 0020).

Pure-function tests. Error classes: exact, fifth (adjacent on the circle,
same mode), relative (same Camelot number, other mode), parallel (same
tonic, other mode), other. Headline metric: mixable rate
(exact + fifth + relative).
"""

from backend.key import Key
from harness.key_scoring import MIREX_WEIGHTS, classify, summarize_key_scores


def k(s: str) -> Key:
    key = Key.from_musical(s)
    assert key is not None
    return key


class TestClassify:
    def test_exact(self):
        assert classify(k("Am"), k("Am")) == "exact"
        assert classify(k("C"), k("C")) == "exact"

    def test_exact_across_enharmonics(self):
        assert classify(k("C# Major"), k("Db Major")) == "exact"

    def test_fifth_up_and_down_same_mode(self):
        assert classify(k("G"), k("C")) == "fifth"  # 2d vs 1d
        assert classify(k("F"), k("C")) == "fifth"  # 12d vs 1d
        assert classify(k("Em"), k("Am")) == "fifth"
        assert classify(k("Dm"), k("Am")) == "fifth"

    def test_fifth_wraps_around_the_circle(self):
        assert classify(k("C"), k("F")) == "fifth"  # 1d vs 12d

    def test_relative(self):
        assert classify(k("Am"), k("C")) == "relative"
        assert classify(k("C"), k("Am")) == "relative"

    def test_parallel(self):
        assert classify(k("Cm"), k("C")) == "parallel"
        assert classify(k("C"), k("Cm")) == "parallel"
        assert classify(k("Am"), k("A")) == "parallel"

    def test_other(self):
        assert classify(k("F#m"), k("C")) == "other"
        assert classify(k("D"), k("C")) == "other"  # two fifths away
        assert classify(k("Ebm"), k("Am")) == "other"

    def test_fifth_across_modes_is_not_fifth(self):
        # 2m vs 1d: adjacent number but different mode — not the fifth class
        assert classify(k("Em"), k("C")) not in ("fifth", "exact", "relative")


class TestSummary:
    def test_breakdown_weighted_score_and_mixable(self):
        pairs = [
            (k("Am"), k("Am")),  # exact
            (k("Am"), k("Am")),  # exact
            (k("Em"), k("Am")),  # fifth
            (k("C"), k("Am")),   # relative
            (k("A"), k("Am")),   # parallel
            (k("Eb"), k("Am")),  # other
        ]
        s = summarize_key_scores([classify(est, truth) for est, truth in pairs])
        assert s["classes"] == {
            "exact": 2,
            "fifth": 1,
            "relative": 1,
            "parallel": 1,
            "other": 1,
        }
        assert s["n"] == 6
        assert s["mixable_rate"] == 4 / 6
        expected = (2 * 1.0 + 0.5 + 0.3 + 0.2 + 0.0) / 6
        assert abs(s["weighted_score"] - expected) < 1e-9

    def test_weights_are_mirex(self):
        assert MIREX_WEIGHTS == {
            "exact": 1.0,
            "fifth": 0.5,
            "relative": 0.3,
            "parallel": 0.2,
            "other": 0.0,
        }

    def test_empty(self):
        s = summarize_key_scores([])
        assert s["n"] == 0
        assert s["mixable_rate"] is None
        assert s["weighted_score"] is None


class TestRunnerOutcomes:
    def test_undetected_and_error_count_against_denominator(self):
        s = summarize_key_scores(["exact", "undetected", "error", "exact"])
        assert s["n"] == 4
        assert s["mixable_rate"] == 0.5
        assert s["weighted_score"] == 0.5
        assert s["classes"]["undetected"] == 1
