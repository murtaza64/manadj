"""Grid scoring against the Ground truth corpus (ADR 0024).

Pure-function tests: BPM within tolerance, half/double-time as its own error
class, phase error mod beat vs Engine's grid.
"""

from harness.corpus import GridTruth
from harness.fit import GridFit
from harness.grid_scoring import score_track, summarize_scores


def ok_fit(bpm: float, phase: float = 0.5) -> GridFit:
    return GridFit(bpm=bpm, phase=phase, residual_ms=2.0, bailed=False, evidence={})


BAIL = GridFit(bpm=None, phase=None, residual_ms=None, bailed=True, evidence={"reason": "x"})


def truth_grid(bpm: float, first_beat: float = 0.5) -> GridTruth:
    return GridTruth(tempo_changes=({"start_time": first_beat, "bpm": bpm, "bar_position": 1},))


class TestBpmOutcome:
    def test_correct_within_tolerance(self):
        s = score_track("t", ok_fit(174.04), truth_bpm=174.0, truth_grid=None)
        assert s.outcome == "ok"
        assert abs(s.bpm_error - 0.04) < 1e-9

    def test_wrong_beyond_tolerance(self):
        assert score_track("t", ok_fit(173.0), 174.0, None).outcome == "wrong"

    def test_half_time_is_its_own_class(self):
        assert score_track("t", ok_fit(87.0), 174.0, None).outcome == "half_double"

    def test_double_time_is_its_own_class(self):
        assert score_track("t", ok_fit(174.0), 87.0, None).outcome == "half_double"

    def test_half_double_respects_tolerance(self):
        assert score_track("t", ok_fit(87.02), 174.0, None).outcome == "half_double"
        assert score_track("t", ok_fit(87.5), 174.0, None).outcome == "wrong"

    def test_bail_outcome(self):
        assert score_track("t", BAIL, 174.0, None).outcome == "bail"

    def test_no_truth(self):
        assert score_track("t", ok_fit(174.0), None, None).outcome == "no_truth"


class TestPhaseError:
    def test_exact_phase(self):
        s = score_track("t", ok_fit(174.0, phase=0.5), 174.0, truth_grid(174.0, 0.5))
        assert s.phase_error_ms is not None
        assert s.phase_error_ms < 1e-6

    def test_phase_off_by_whole_beats_is_zero(self):
        period = 60.0 / 174.0
        s = score_track("t", ok_fit(174.0, phase=0.5 + 3 * period), 174.0, truth_grid(174.0, 0.5))
        assert s.phase_error_ms < 1e-6

    def test_phase_off_by_half_beat_is_max(self):
        period = 60.0 / 174.0
        s = score_track(
            "t", ok_fit(174.0, phase=0.5 + period / 2), 174.0, truth_grid(174.0, 0.5)
        )
        assert abs(s.phase_error_ms - period / 2 * 1000) < 1e-6

    def test_circular_distance_takes_short_way(self):
        period = 60.0 / 174.0
        s = score_track(
            "t", ok_fit(174.0, phase=0.5 + 0.9 * period), 174.0, truth_grid(174.0, 0.5)
        )
        assert abs(s.phase_error_ms - 0.1 * period * 1000) < 1e-6

    def test_no_phase_score_on_variable_truth_grid(self):
        grid = GridTruth(
            tempo_changes=(
                {"start_time": 0.5, "bpm": 174.0, "bar_position": 1},
                {"start_time": 60.0, "bpm": 87.0, "bar_position": 1},
            )
        )
        s = score_track("t", ok_fit(174.0), 174.0, grid)
        assert s.phase_error_ms is None

    def test_no_phase_score_when_bpm_wrong(self):
        s = score_track("t", ok_fit(173.0), 174.0, truth_grid(174.0))
        assert s.phase_error_ms is None


class TestSummary:
    def test_summary_counts_and_phase_stats(self):
        period_ms = 60.0 / 174.0 * 1000
        scores = [
            score_track("a", ok_fit(174.0, 0.5), 174.0, truth_grid(174.0, 0.5)),
            score_track("b", ok_fit(174.0, 0.5 + 0.005), 174.0, truth_grid(174.0, 0.5)),
            score_track("c", ok_fit(87.0), 174.0, None),
            score_track("d", BAIL, 174.0, None),
            score_track("e", ok_fit(170.0), 174.0, None),
        ]
        s = summarize_scores(scores)
        assert s["outcomes"] == {"ok": 2, "half_double": 1, "bail": 1, "wrong": 1}
        assert s["bpm_accuracy"] == 2 / 5
        assert s["phase"]["scored"] == 2
        assert s["phase"]["within_10ms"] == 2
        assert 0 < s["phase"]["median_ms"] <= 5.0 < period_ms


class TestAnalyzerSeam:
    def test_analyzer_composes_candidate_and_fit(self):
        from harness.analyzer import GridAnalyzer

        from harness.fit import FitParams

        class StubCandidate:
            name = "stub"
            fit_params = FitParams()

            def ticks(self, audio_path: str) -> list[float]:
                period = 60.0 / 174.0
                return [0.5 + i * period for i in range(200)]

        fit = GridAnalyzer(StubCandidate()).analyze("/whatever.mp3")
        assert not fit.bailed
        assert fit.bpm == 174.0

    def test_summary_includes_bail_rate(self):
        scores = [
            score_track("a", ok_fit(174.0), 174.0, None),
            score_track("b", BAIL, 174.0, None),
        ]
        assert summarize_scores(scores)["bail_rate"] == 0.5

    def test_triplet_confusion_is_wrong_not_half_double(self):
        assert score_track("t", ok_fit(58.0), 174.0, None).outcome == "wrong"
