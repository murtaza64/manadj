"""Variable-grid beat expansion walks all segments (ADR 0027 §4).

`calculate_beats_from_tempo_changes` used only the first tempo change — on
a multi-tempo grid (Engine import) every beat after the second tempo change
was wrong with linearly growing error, and client-side Quantize snapped to
phantom beats. Constant grids must stay byte-identical (regression).
"""

from backend.beatgrid_utils import (
    _downbeat_times,
    calculate_beats_from_tempo_changes,
)


def tc(
    start_time: float,
    bpm: float,
    bar_position: int = 1,
    time_signature_num: int = 4,
) -> dict:
    return {
        "start_time": start_time,
        "bpm": bpm,
        "time_signature_num": time_signature_num,
        "time_signature_den": 4,
        "bar_position": bar_position,
    }


class TestConstantGridRegression:
    """Single-segment outputs byte-identical to the old expansion."""

    def test_128bpm_grid_exact_floats(self):
        # 60/128 = 0.46875 is exactly representable: accumulation == multiplication
        beats, downbeats = calculate_beats_from_tempo_changes([tc(0.0, 128.0)], 10.0)
        assert beats == [k * 0.46875 for k in range(22)]  # last ≤ 10.0
        assert downbeats == [k * 0.46875 for k in range(0, 22, 4)]

    def test_offset_start_and_mid_bar_position(self):
        # First beat at 0.5 on bar position 3: first downbeat lands 2 beats in
        beats, downbeats = calculate_beats_from_tempo_changes(
            [tc(0.5, 120.0, bar_position=3)], 4.0
        )
        assert beats == [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]
        assert downbeats == [1.5, 3.5]

    def test_empty_tempo_changes(self):
        assert calculate_beats_from_tempo_changes([], 10.0) == ([], [])


class TestVariableGridExpansion:
    two_tempo = [tc(0.0, 120.0), tc(60.0, 150.0)]

    def test_beat_spacing_correct_in_both_sections(self):
        beats, _ = calculate_beats_from_tempo_changes(self.two_tempo, 120.0)
        before = [b for b in beats if b < 60.0]
        after = [b for b in beats if b >= 60.0]
        assert before == [k * 0.5 for k in range(120)]  # 120 BPM → 0.5s
        assert after[0] == 60.0
        assert abs(after[1] - after[0] - 0.4) < 1e-9  # 150 BPM → 0.4s
        assert abs(after[-1] - after[-2] - 0.4) < 1e-9
        # the old first-segment-only expansion put a beat at 60.25; not any more
        assert all(abs(b - 60.25) > 1e-6 for b in beats)

    def test_boundary_beat_placed_once(self):
        beats, _ = calculate_beats_from_tempo_changes(self.two_tempo, 120.0)
        assert beats.count(60.0) == 1
        assert len(beats) == len(set(beats))

    def test_downbeats_subset_of_beats_bit_identically(self):
        beats, downbeats = calculate_beats_from_tempo_changes(self.two_tempo, 120.0)
        beat_set = set(beats)
        assert all(d in beat_set for d in downbeats)  # exact float equality

    def test_bar_phase_continuous_across_boundary(self):
        # Segment 1 holds 120 beats (0..59.5) = 30 exact bars, so t=60 opens
        # a bar; both segments declare bar_position 1 → downbeats every 4
        # beats straight through.
        beats, downbeats = calculate_beats_from_tempo_changes(self.two_tempo, 63.0)
        assert 60.0 in downbeats
        # last downbeat before the boundary is at 58.0 (0.5s beats, bars of 2s)
        assert 58.0 in downbeats
        # next after 60.0 is 60.0 + 4×0.4 = 61.6
        assert any(abs(d - 61.6) < 1e-9 for d in downbeats)

    def test_segment_declared_bar_position_wins(self):
        # The second segment declares bar_position 3: t=90 is NOT a downbeat;
        # the downbeat falls 2 beats later.
        grid = [tc(0.0, 120.0), tc(90.0, 150.0, bar_position=3)]
        beats, downbeats = calculate_beats_from_tempo_changes(grid, 93.0)
        assert 90.0 in beats
        assert 90.0 not in downbeats
        assert any(abs(d - 90.8) < 1e-9 for d in downbeats)  # 90 + 2×0.4


class TestDownbeatDerivationsAgree:
    """_downbeat_times (re-anchor path) and the expansion must produce
    identical floats for shared downbeats — waveform downbeat matching
    relies on exact equality until issue 08's epsilon lands."""

    def test_variable_grid_downbeats_match_expansion(self):
        grid = [tc(0.0, 120.0), tc(60.0, 150.0)]
        _, expansion_downbeats = calculate_beats_from_tempo_changes(grid, 100.0)
        reanchor_downbeats = _downbeat_times(grid, until=100.0)
        shared = [d for d in reanchor_downbeats if d <= expansion_downbeats[-1]]
        assert shared == expansion_downbeats
