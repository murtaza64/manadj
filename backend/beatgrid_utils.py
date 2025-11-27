"""Beat calculation utilities for beatgrid generation."""


def calculate_beats_from_tempo_changes(tempo_changes: list[dict], duration: float) -> tuple[list[float], list[float]]:
    """
    Calculate beat times and downbeat times from tempo changes.

    For initial implementation, only uses first tempo change (constant BPM).

    Args:
        tempo_changes: List of tempo change dicts with start_time, bpm, time_signature_num, bar_position
        duration: Track duration in seconds

    Returns:
        Tuple of (all_beat_times, downbeat_times)
    """
    if not tempo_changes:
        return [], []

    # Use only first tempo change for now
    first_tempo = tempo_changes[0]
    start_time = first_tempo["start_time"]
    bpm = first_tempo["bpm"]
    time_sig_num = first_tempo["time_signature_num"]
    bar_position = first_tempo["bar_position"]

    beat_interval = 60.0 / bpm  # seconds per beat

    beat_times = []
    downbeat_times = []
    current_time = start_time
    current_bar_position = bar_position

    while current_time <= duration:
        beat_times.append(current_time)

        if current_bar_position == 1:
            downbeat_times.append(current_time)

        current_time += beat_interval
        current_bar_position = (current_bar_position % time_sig_num) + 1

    return beat_times, downbeat_times


def generate_beatgrid_from_bpm(bpm: float, duration: float) -> dict:
    """
    Generate beatgrid data from a single BPM value.

    Args:
        bpm: Beats per minute (will be divided by 100 if centiBPM format)
        duration: Track duration in seconds

    Returns:
        Dict with tempo_changes, beat_times, downbeat_times
    """
    # Handle centiBPM format (stored as int * 100)
    if bpm > 500:
        bpm = bpm / 100.0

    tempo_changes = [{
        "start_time": 0.0,
        "bpm": bpm,
        "time_signature_num": 4,
        "time_signature_den": 4,
        "bar_position": 1
    }]

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
) -> list[dict]:
    """
    Shift entire beatgrid by offset_ms milliseconds.

    Only adjusts start_time of first tempo change (for single-tempo grids).
    Clamps to valid range to prevent invalid start times.

    Args:
        tempo_changes: Current tempo changes array
        offset_ms: Offset in milliseconds (positive = later, negative = earlier)
        track_duration: Track duration in seconds

    Returns:
        Updated tempo_changes array
    """
    if not tempo_changes:
        raise ValueError("No beatgrid to nudge")

    offset_s = offset_ms / 1000.0

    new_tempo_changes = []
    for i, tc in enumerate(tempo_changes):
        new_tc = tc.copy()
        if i == 0:
            # Adjust start time with bounds checking
            new_start = tc["start_time"] + offset_s
            # Clamp to valid range (allow slight negative for alignment)
            new_start = max(-0.1, min(track_duration, new_start))
            new_tc["start_time"] = new_start
        new_tempo_changes.append(new_tc)

    return new_tempo_changes
