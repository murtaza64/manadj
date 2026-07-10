"""Experiment E: in-place perf-blob UPDATE on an existing Engine track.

Engine write-path spike (library-sync-button/08). The sync-export
operation: read-modify-write quickCues + beatData on a track Engine
already owns. On the target track:

  - hot cue slot 0 (pad A) set: label "manadj", green, at 60.0s
  - adjusted beatgrid shifted +half a beat (visually obvious in Engine)
  - everything else preserved byte-exact (round-trip-verified encoders)

Usage: uv run scripts/spike_enginedj/exp_e_cue_write.py <track-id>
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from sqlalchemy import text  # noqa: E402

from enginedj.connection import EngineDJDatabase  # noqa: E402
from enginedj.models import PerformanceData  # noqa: E402
from enginedj.performance_blobs import q_uncompress  # noqa: E402

sys.path.insert(0, str(Path(__file__).parent))
from blob_encode import (  # noqa: E402
    encode_beat_data_full,
    encode_quick_cues_full,
    parse_beat_data_full,
    parse_quick_cues_full,
    q_compress,
)

LIBRARY = Path.home() / "Music" / "Engine Library"
MARKER = LIBRARY / ".manadj-test-library"


def require_safe() -> None:
    if not MARKER.exists():
        sys.exit("refusing: live Engine Library is not marked as a test library")
    if subprocess.run(
        ["pgrep", "-f", r"Engine DJ\.app/Contents/MacOS/Engine DJ"],
        capture_output=True,
    ).returncode == 0:
        sys.exit("refusing: Engine DJ is running")


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    tid = int(sys.argv[1])
    require_safe()

    db = EngineDJDatabase(LIBRARY / "Database2")
    with db.session_m() as s:
        pd = s.get(PerformanceData, tid)
        if pd is None or pd.quickCues is None or pd.beatData is None:
            sys.exit(f"track {tid} lacks quickCues/beatData")
        qc = parse_quick_cues_full(q_uncompress(pd.quickCues))
        bd = parse_beat_data_full(q_uncompress(pd.beatData))

    sr = bd["sample_rate"]
    # hot cue: slot 0, 60.0s, green (ARGB ff00c67c-ish -> use palette green 86C64B)
    if qc["slots"][0]["label"]:
        print("slot 0 already set — leaving cues untouched, grid-only write")
    else:
        qc["slots"][0] = {
            "label": "manadj",
            "position": 60.0 * sr,
            "argb": "ff86c64b",
        }

    # shift adjusted grid by half a beat
    g = bd["adjusted_grid"]
    beat_len = (g[-1]["sample_offset"] - g[0]["sample_offset"]) / (
        g[-1]["beat_index"] - g[0]["beat_index"]
    )
    for m in g:
        m["sample_offset"] += beat_len / 2

    with db.session_m_write() as s:
        s.execute(
            text(
                "UPDATE PerformanceData SET quickCues = :qc, beatData = :bd "
                "WHERE trackId = :tid"
            ),
            {
                "qc": q_compress(encode_quick_cues_full(qc)),
                "bd": q_compress(encode_beat_data_full(bd)),
                "tid": tid,
            },
        )
    print(f"track {tid}: wrote hot cue 'manadj' @60.0s (slot A, green) "
          f"and half-beat grid shift (beat_len={beat_len:.1f} samples)")


if __name__ == "__main__":
    main()
