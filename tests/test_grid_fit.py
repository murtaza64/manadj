"""Constant-tempo fit over beat-tracker ticks (ADR 0020).

Pure-function tests with synthetic tick sequences: perfect, jittered,
half/double-time, variable (must bail), fractional BPM (must not snap),
missing ticks. No audio, no heavy deps.
"""

import random

from harness.fit import FitParams, fit_constant_grid


def make_ticks(
    bpm: float,
    phase: float = 0.5,
    n: int = 400,
    jitter_ms: float = 0.0,
    drop: float = 0.0,
    seed: int = 42,
) -> list[float]:
    rng = random.Random(seed)
    period = 60.0 / bpm
    ticks = []
    for i in range(n):
        if drop and rng.random() < drop:
            continue
        t = phase + i * period
        if jitter_ms:
            t += rng.uniform(-jitter_ms, jitter_ms) / 1000.0
        ticks.append(t)
    return ticks


class TestPerfectTicks:
    def test_recovers_bpm_and_phase(self):
        fit = fit_constant_grid(make_ticks(174.0, phase=0.5))
        assert not fit.bailed
        assert fit.bpm == 174.0
        period = 60.0 / 174.0
        assert abs((fit.phase - 0.5) % period) < 1e-6 or abs(
            ((fit.phase - 0.5) % period) - period
        ) < 1e-6

    def test_residual_near_zero(self):
        fit = fit_constant_grid(make_ticks(128.0))
        assert fit.residual_ms is not None
        assert fit.residual_ms < 0.1


class TestJitteredTicks:
    def test_fits_through_realistic_jitter(self):
        fit = fit_constant_grid(make_ticks(174.0, jitter_ms=8.0))
        assert not fit.bailed
        assert abs(fit.bpm - 174.0) <= 0.05

    def test_survives_dropped_ticks(self):
        fit = fit_constant_grid(make_ticks(174.0, jitter_ms=5.0, drop=0.15))
        assert not fit.bailed
        assert abs(fit.bpm - 174.0) <= 0.05


class TestSnapping:
    def test_near_integer_snaps(self):
        fit = fit_constant_grid(make_ticks(173.98))
        assert fit.bpm == 174.0
        assert fit.evidence["raw_bpm"] != 174.0

    def test_fractional_bpm_not_snapped(self):
        fit = fit_constant_grid(make_ticks(173.6))
        assert not fit.bailed
        assert abs(fit.bpm - 173.6) < 0.02
        assert fit.bpm != 174.0

    def test_snap_disabled_by_params(self):
        fit = fit_constant_grid(make_ticks(173.98), FitParams(snap_bpm=0.0))
        assert abs(fit.bpm - 173.98) < 0.02


class TestMetricalOscillation:
    def test_half_time_sections_support_the_base_grid(self):
        # A DnB tracker flips to half-time in sparse sections; the track is
        # still one Quantized 174 grid. 300 beats at 174, then 100 intervals
        # at 87 (= 200 more base beats), phase-coherent.
        period = 60.0 / 174.0
        base = make_ticks(174.0, phase=0.5, n=300)
        half = [base[-1] + (i + 1) * 2 * period for i in range(100)]
        fit = fit_constant_grid(base + half)
        assert not fit.bailed
        assert fit.bpm == 174.0


class TestBail:
    def test_tempo_change_bails(self):
        # 174 for the first half, 180 for the second — genuinely variable
        first = make_ticks(174.0, n=200)
        second = [first[-1] + (i + 1) * 60.0 / 180.0 for i in range(200)]
        fit = fit_constant_grid(first + second)
        assert fit.bailed
        assert fit.bpm is None
        assert fit.phase is None

    def test_too_few_ticks_bails(self):
        fit = fit_constant_grid(make_ticks(174.0, n=5))
        assert fit.bailed
        assert "few" in fit.evidence["reason"]

    def test_empty_bails(self):
        assert fit_constant_grid([]).bailed

    def test_heavy_jitter_bails(self):
        fit = fit_constant_grid(make_ticks(174.0, jitter_ms=80.0))
        assert fit.bailed


class TestEvidence:
    def test_evidence_carries_diagnostics(self):
        fit = fit_constant_grid(make_ticks(174.0, jitter_ms=5.0))
        assert fit.evidence["n_ticks"] == 400
        assert 0.9 <= fit.evidence["coverage"] <= 1.0
        assert fit.evidence["raw_bpm"] > 0
        assert fit.evidence["longest_region"] > 48


class TestIntroWander:
    def test_wandering_intro_does_not_bias_period_or_phase(self):
        # Regression: a start-anchored refinement was poisoned by intro
        # wander — 0.1% period bias smears phase across a long clean body.
        # Intro: 100 ticks at a slightly different tempo; body: 400 clean
        # ticks at 175. The fit must report the body's grid.
        intro_period = 60.0 / 175.0 * 1.004
        intro = [i * intro_period for i in range(100)]
        body_start = intro[-1] + 60.0 / 175.0
        body = [body_start + i * 60.0 / 175.0 for i in range(400)]
        fit = fit_constant_grid(intro + body)
        assert not fit.bailed
        assert fit.bpm == 175.0
        period = 60.0 / 175.0
        offset = (fit.phase - body_start) % period
        assert min(offset, period - offset) < 0.005
