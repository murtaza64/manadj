"""Build the Ground truth corpus (issue 01, ADR 0020).

Offline, read-only: gathers Engine DJ and Rekordbox key/BPM (plus Engine's
beatgrid as phase truth) for every active manadj Track, tiers them by
agreement, and writes the corpus artifact + disputed review queue.

Usage:
    uv run -m harness.build_corpus [--engine-db PATH] [--rekordbox-db PATH]
                                   [--overrides PATH] [--out PATH] [--no-rb]
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path

from backend.key import Key
from harness.corpus import (
    CorpusEntry,
    Override,
    SourceValues,
    build_entry,
    disputed_queue,
    parse_overrides,
    summarize,
)

DEFAULT_OUT = Path("data/corpus.json")
DEFAULT_DISPUTED = Path("data/corpus_disputed.md")
DEFAULT_OVERRIDES = Path(".scratch/native-analysis-accuracy/overrides.toml")


@dataclass(frozen=True)
class _EngineTruth:
    values: SourceValues
    grid_tempo_changes: list[dict] | None


def _load_engine(engine_db_path: str):
    """Index of filename-matchable Engine truth: key, analyzed BPM, grid."""
    from sqlalchemy.orm import joinedload

    from backend.sync_common.matching import TrackIndex
    from backend.sync_performance.engine_source import performance_fields_from_blobs
    from enginedj.connection import EngineDJDatabase
    from enginedj.models.track import Track as EDJTrack
    from enginedj.sync import edj_path

    @dataclass(frozen=True)
    class Row:
        path: str
        truth: _EngineTruth

    rows: list[Row] = []
    db = EngineDJDatabase(Path(engine_db_path))
    with db.session_m() as session:
        tracks = session.query(EDJTrack).options(joinedload(EDJTrack.performance_data)).all()
        for t in tracks:
            path = edj_path(t)
            if not path:
                continue
            grid = None
            perf = t.performance_data
            if perf is not None and perf.beatData is not None:
                fields = performance_fields_from_blobs(perf.beatData, None)
                if fields is not None and fields.beatgrid is not None:
                    grid = [asdict(tc) for tc in fields.beatgrid.tempo_changes]
            rows.append(
                Row(
                    path=path,
                    truth=_EngineTruth(
                        values=SourceValues(
                            key=Key.from_engine_id(t.key) if t.key is not None else None,
                            # bpmAnalyzed is Engine's accurate value; the rounded
                            # `bpm` column is NOT truth-grade — absent means absent.
                            bpm=t.bpmAnalyzed or None,
                        ),
                        grid_tempo_changes=grid,
                    ),
                )
            )
    index = TrackIndex.build(rows, lambda r: r.path)
    return lambda filename: (m.truth if (m := index.match(filename)) else None)


def _load_rekordbox(rekordbox_db_path: str | None):
    """Index of filename-matchable Rekordbox truth: key, BPM (centiBPM/100)."""
    from backend.sync_common.matching import TrackIndex
    from rekordbox.connection import get_rekordbox_db

    @dataclass(frozen=True)
    class Row:
        path: str
        values: SourceValues

    rb_db = get_rekordbox_db(rekordbox_db_path)
    rows: list[Row] = []
    for c in rb_db.get_content():
        path = c.FolderPath
        if not path:
            continue
        scale_name = c.Key.ScaleName if c.Key is not None else None
        rows.append(
            Row(
                path=path,
                values=SourceValues(
                    key=Key.from_rekordbox(scale_name) if scale_name else None,
                    bpm=(c.BPM / 100.0) if c.BPM else None,  # centiBPM
                ),
            )
        )
    index = TrackIndex.build(rows, lambda r: r.path)
    return lambda filename: (m.values if (m := index.match(filename)) else None)


def _load_manadj_filenames() -> list[str]:
    from backend.database import SessionLocal
    from backend.models import Track

    db = SessionLocal()
    try:
        tracks = db.query(Track).filter(Track.archived_at.is_(None)).all()
        return [t.filename for t in tracks if t.filename]
    finally:
        db.close()


def build_corpus(
    engine_db_path: str,
    rekordbox_db_path: str | None,
    overrides: dict[str, Override],
    use_rb: bool = True,
) -> list[CorpusEntry]:
    engine_for = _load_engine(engine_db_path)
    rb_for = _load_rekordbox(rekordbox_db_path) if use_rb else (lambda _f: None)

    entries: list[CorpusEntry] = []
    for filename in _load_manadj_filenames():
        engine_truth = engine_for(filename)
        entries.append(
            build_entry(
                filename=filename,
                engine=engine_truth.values if engine_truth else None,
                rb=rb_for(filename),
                grid_tempo_changes=engine_truth.grid_tempo_changes if engine_truth else None,
                override=overrides.get(filename),
            )
        )
    return entries


def write_artifacts(entries: list[CorpusEntry], out: Path, disputed_out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {"entries": [e.to_dict() for e in entries], "summary": summarize(entries)},
            indent=2,
        )
    )
    rows = disputed_queue(entries)
    lines = [
        "# Disputed review queue",
        "",
        "Engine vs Rekordbox disagreements. Verify by ear, then record the",
        "verdict in the overrides file to promote to gold.",
        "",
        "| Track (full path, as the overrides file wants it) "
        "| Key (Engine) | Key (RB) | BPM (Engine) | BPM (RB) |",
        "|---|---|---|---|---|",
    ]
    for e in rows:
        lines.append(
            f"| {e.filename} "
            f"| {e.key.engine.openkey if e.key.engine else ''} "
            f"| {e.key.rb.openkey if e.key.rb else ''} "
            f"| {e.bpm.engine if e.bpm.engine is not None else ''} "
            f"| {e.bpm.rb if e.bpm.rb is not None else ''} |"
        )
    disputed_out.write_text("\n".join(lines) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine-db", default=None, help="Engine Database2 dir (default: config)")
    parser.add_argument("--rekordbox-db", default=None, help="Rekordbox dir (default: config)")
    parser.add_argument("--overrides", type=Path, default=DEFAULT_OVERRIDES)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--disputed-out", type=Path, default=DEFAULT_DISPUTED)
    parser.add_argument("--no-rb", action="store_true", help="Skip Rekordbox (Engine-only tiers)")
    args = parser.parse_args()

    engine_db_path = args.engine_db
    if engine_db_path is None:
        from backend.config import get_config

        engine_db_path = get_config().database.engine_dj_path
    if not engine_db_path:
        raise SystemExit("No Engine DB path (config database.engine_dj_path or --engine-db)")

    overrides = (
        parse_overrides(args.overrides.read_text()) if args.overrides.exists() else {}
    )

    entries = build_corpus(
        engine_db_path=engine_db_path,
        rekordbox_db_path=args.rekordbox_db,
        overrides=overrides,
        use_rb=not args.no_rb,
    )
    write_artifacts(entries, args.out, args.disputed_out)

    summary = summarize(entries)
    print(f"Corpus: {len(entries)} tracks -> {args.out}")
    for field in ("key", "bpm"):
        counts = ", ".join(f"{tier}={n}" for tier, n in sorted(summary[field].items()))
        print(f"  {field}: {counts}")
    n_grid = sum(1 for e in entries if e.grid is not None)
    n_const = sum(1 for e in entries if e.grid is not None and e.grid.constant)
    print(f"  grid (phase truth, Engine-only): {n_grid} ({n_const} constant)")
    n_disputed = len(disputed_queue(entries))
    print(f"  disputed review queue: {n_disputed} tracks -> {args.disputed_out}")
    if overrides:
        print(f"  overrides applied: {len(overrides)}")


if __name__ == "__main__":
    main()
