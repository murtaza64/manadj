"""Beat calculation utilities for beatgrid generation."""


def calculate_beats_from_tempo_changes(tempo_changes: list[dict], duration: float) -> tuple[list[float], list[float]]:
    """
    Calculate beat times and downbeat times from tempo changes.

    Walks every segment (ADR 0027 §4): within each tempo change, beats run
    at that segment's interval from its start_time; each segment's declared
    bar_position sets the bar phase at its start beat, so downbeats stay
    consistent with stored data. The boundary beat is placed once — it
    belongs to the segment it starts; an accumulated beat landing within
    half an interval of the boundary is absorbed into it.

    Single-segment grids follow the exact accumulation of the original
    constant-BPM expansion (byte-identical outputs — the waveform renderer
    matches downbeats to beats by exact float equality).

    Args:
        tempo_changes: List of tempo change dicts with start_time, bpm, time_signature_num, bar_position
        duration: Track duration in seconds

    Returns:
        Tuple of (all_beat_times, downbeat_times)
    """
    if not tempo_changes:
        return [], []

    beat_times: list[float] = []
    downbeat_times: list[float] = []

    for i, tc in enumerate(tempo_changes):
        beat_interval = 60.0 / tc["bpm"]  # seconds per beat
        time_sig_num = tc["time_signature_num"]
        next_start = (
            tempo_changes[i + 1]["start_time"] if i + 1 < len(tempo_changes) else None
        )

        current_time = tc["start_time"]
        current_bar_position = tc["bar_position"]

        while current_time <= duration:
            if next_start is not None and current_time >= next_start - beat_interval / 2:
                break  # the boundary beat belongs to the next segment
            beat_times.append(current_time)

            if current_bar_position == 1:
                downbeat_times.append(current_time)

            current_time += beat_interval
            current_bar_position = (current_bar_position % time_sig_num) + 1

    return beat_times, downbeat_times


def constant_tempo_changes(
    bpm: float,
    time_signature_num: int = 4,
    time_signature_den: int = 4,
) -> list[dict]:
    """Single-tempo grid starting at t=0 with a downbeat on the first beat."""
    return [{
        "start_time": 0.0,
        "bpm": bpm,
        "time_signature_num": time_signature_num,
        "time_signature_den": time_signature_den,
        "bar_position": 1
    }]


def generate_beatgrid_from_bpm(bpm: float, duration: float) -> dict:
    """
    Generate beatgrid data from a single BPM value.

    Args:
        bpm: Beats per minute (float BPM — callers convert from centiBPM)
        duration: Track duration in seconds

    Returns:
        Dict with tempo_changes, beat_times, downbeat_times
    """
    tempo_changes = constant_tempo_changes(bpm)

    beat_times, downbeat_times = calculate_beats_from_tempo_changes(tempo_changes, duration)

    return {
        "tempo_changes": tempo_changes,
        "beat_times": beat_times,
        "downbeat_times": downbeat_times
    }


def set_downbeat_at_time(
    user_downbeat_time: float,
    bpm: float,
    time_signature_num: int = 4,
    time_signature_den: int = 4
) -> list[dict]:
    """
    Calculate new tempo_changes array with downbeat at specified time.

    Grid extends backward to t=0 (or as close as possible) with proper
    bar_position wrapping. First beat may start on non-downbeat.

    Args:
        user_downbeat_time: Time in seconds where user wants downbeat
        bpm: Beats per minute
        time_signature_num: Beats per bar (default 4 for 4/4)
        time_signature_den: Note value for beat (default 4 for quarter notes)

    Returns:
        List with single tempo change dict starting at calculated first beat
    """
    beat_interval = 60.0 / bpm

    # Count beats backward from user_downbeat_time to find first beat
    num_beats_back = int(user_downbeat_time / beat_interval)
    first_beat_time = user_downbeat_time - (num_beats_back * beat_interval)

    # Calculate bar position for first beat
    # User wants their beat to be position 1, count backward with wrapping
    beats_within_bar = num_beats_back % time_signature_num
    if beats_within_bar == 0:
        first_bar_position = 1  # Also a downbeat
    else:
        first_bar_position = time_signature_num - beats_within_bar + 1

    return [{
        "start_time": first_beat_time,
        "bpm": bpm,
        "time_signature_num": time_signature_num,
        "time_signature_den": time_signature_den,
        "bar_position": first_bar_position
    }]


def nudge_beatgrid(
    tempo_changes: list[dict],
    offset_ms: float,
    track_duration: float
) -> tuple[list[dict], float]:
    """
    Shift the entire beatgrid by offset_ms milliseconds (rigid shift: every
    tempo change moves by the same amount, so variable grids keep their
    internal structure). Clamps so the first tempo change stays in a valid
    range; the applied offset (post-clamp, in seconds) is returned so callers
    can shift the anchor by exactly the same amount.

    Args:
        tempo_changes: Current tempo changes array
        offset_ms: Offset in milliseconds (positive = later, negative = earlier)
        track_duration: Track duration in seconds

    Returns:
        Tuple of (updated tempo_changes array, applied offset in seconds)
    """
    if not tempo_changes:
        raise ValueError("No beatgrid to nudge")

    offset_s = offset_ms / 1000.0

    # Clamp against the first tempo change (allow slight negative for alignment)
    first_start = tempo_changes[0]["start_time"]
    new_first_start = max(-0.1, min(track_duration, first_start + offset_s))
    applied_offset_s = new_first_start - first_start

    new_tempo_changes = [
        {**tc, "start_time": tc["start_time"] + applied_offset_s}
        for tc in tempo_changes
    ]
    return new_tempo_changes, applied_offset_s


def _downbeat_times(tempo_changes: list[dict], until: float) -> list[float]:
    """Downbeat times up to `until`.

    Derived FROM the beat expansion (ADR 0027 §4): one derivation, so the
    re-anchor path and the display path produce identical floats for shared
    downbeats by construction.
    """
    return calculate_beats_from_tempo_changes(tempo_changes, until)[1]


def first_downbeat_time(tempo_changes: list[dict]) -> float:
    """First downbeat of the grid (fallback re-tempo anchor per ADR 0016)."""
    tc = tempo_changes[0]
    interval = 60.0 / tc["bpm"]
    t = tc["start_time"]
    pos = tc["bar_position"]
    while pos != 1:
        t += interval
        pos = (pos % tc["time_signature_num"]) + 1
    return t


def re_anchor_tempo_changes(tempo_changes: list[dict], mark_time: float) -> list[dict]:
    """Re-anchor a grid on a marked downbeat by rigid shift (ADR 0016).

    Shifts every tempo change by the same delta so the downbeat nearest the
    mark lands exactly on it. Tempo changes are preserved — this replaces the
    old silent flatten-to-constant on variable grids.
    """
    if not tempo_changes:
        raise ValueError("No beatgrid to re-anchor")

    # Search far enough past the mark to see the next downbeat in any segment
    max_bar_seconds = max(
        tc["time_signature_num"] * 60.0 / tc["bpm"] for tc in tempo_changes
    )
    downbeats = _downbeat_times(tempo_changes, until=mark_time + max_bar_seconds)
    if not downbeats:
        raise ValueError("Grid has no downbeats to re-anchor")

    nearest = min(downbeats, key=lambda t: abs(t - mark_time))
    shift = mark_time - nearest
    return [{**tc, "start_time": tc["start_time"] + shift} for tc in tempo_changes]


def dominant_bpm(tempo_changes: list[dict], duration: float | None = None) -> float:
    """The grid's dominant tempo: the BPM occupying the most track time.

    BPM is a projection of the Beatgrid (ADR 0016) — this is the projection.
    For a constant grid it's simply the tempo. For a variable grid, segments
    are weighted by length; without a duration the last segment's length is
    unknown, so we fall back to the first tempo change's BPM.
    """
    if not tempo_changes:
        raise ValueError("No tempo changes")
    if len(tempo_changes) == 1:
        return tempo_changes[0]["bpm"]
    if duration is None:
        return tempo_changes[0]["bpm"]

    weights: dict[float, float] = {}
    for i, tc in enumerate(tempo_changes):
        seg_end = tempo_changes[i + 1]["start_time"] if i + 1 < len(tempo_changes) else duration
        weights[tc["bpm"]] = weights.get(tc["bpm"], 0.0) + max(0.0, seg_end - tc["start_time"])
    return max(weights, key=lambda bpm: weights[bpm])
