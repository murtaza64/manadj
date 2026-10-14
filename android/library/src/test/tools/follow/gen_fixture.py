"""Follow golden fixture, stage 1 (desktop backend): a deterministic synthetic
Library run through the REAL backend — the device-sync snapshot builder and
crud.get_tracks (desktop Follow's per-reference BPM-gated candidate query).

Run from a checkout of main (repo root):
    uv run python android/library/src/test/tools/follow/gen_fixture.py <out dir>
Writes snapshot.json, candidates.json, cases.json. Stage 2:
export-follow-cases.ts (desktop frontend Follow pipeline) → expected.json.
"""

import json
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path

from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend import crud
from backend.database import apply_sqlite_pragmas
from backend.models import Beatgrid, Cameo, Tag, TagCategory, Take, Track, TrackLink, TrackTag, Transition
from backend.routers.device_sync import build_snapshot

ROOT = Path(__file__).resolve().parents[6]
N_TRACKS = 420
ARTISTS = [
    "Noisia", "Phace", "Noisia & Phace", "Alix Perez", "Alix Perez feat. Eprom", "Eprom", "Skeptical",
    "Skeptical x Alix Perez", "Calibre", "dBridge", "Break", "Break vs Calibre", "Sigur Rós", "Björk",
    "Bjork", "Mefjus", "Mefjus and Kanine", "Kanine", "Halogenix ft. Hyroglifics", "Hyroglifics",
    "Hyroglyfics", "Ivy Lab", "Ivy-Lab", "Om Unit", "Fixate", "Sam Binga", "Lenzman", "DJ Ẽxample",
    "A", "", None,
]
TAG_TREE = {"Genre": ["Neuro", "Liquid", "Halftime", "Jungle", "Minimal"],
            "Vibe": ["Dark", "Rolling", "Bright", "Weird", "Heavy"],
            "Use": ["Warmup", "Peak", "Closer", "Tool", "Vocal"]}
BPM_CENTERS = [174.0, 172.0, 175.0, 170.0, 87.0, 86.0, 140.0, 128.0, 160.0]


def make_engine():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    event.listen(engine, "connect", apply_sqlite_pragmas)
    with engine.connect() as connection:
        cfg = AlembicConfig(str(ROOT / "alembic.ini"))
        cfg.attributes["connection"] = connection
        cfg.attributes["configure_logger"] = False
        alembic_command.upgrade(cfg, "head")
    return engine


def main(out: Path) -> None:
    rng = random.Random(372)
    db = sessionmaker(bind=make_engine())()
    tags = []
    for order, (cat_name, names) in enumerate(TAG_TREE.items()):
        cat = TagCategory(name=cat_name, display_order=order)
        db.add(cat)
        db.flush()
        for i, name in enumerate(names):
            tag = Tag(name=name, category_id=cat.id, display_order=i)
            db.add(tag)
            tags.append(tag)
    db.flush()

    base = datetime(2026, 1, 1)
    tracks = []
    for i in range(N_TRACKS):
        center = rng.choice(BPM_CENTERS)
        bpm = None if rng.random() < 0.05 else round(center * (1 + rng.uniform(-0.09, 0.09)), 2)
        t = Track(
            filename=f"/decoy/follow_{i}.mp3",
            title=f"Decoy {i}",
            artist=rng.choice(ARTISTS),
            key=None if rng.random() < 0.08 else rng.randrange(24),
            bpm=None if bpm is None else int(round(bpm * 100)),
            energy=None if rng.random() < 0.15 else rng.randint(1, 5),
            duration_secs=rng.uniform(180, 420),
            created_at=base + timedelta(minutes=rng.randrange(0, 200_000)),
        )
        db.add(t)
        tracks.append(t)
    db.flush()
    for t in tracks:
        for tag in rng.sample(tags, rng.choice([0, 0, 1, 2, 2, 3, 3, 4, 5, 6])):
            db.add(TrackTag(track_id=t.id, tag_id=tag.id))
        r = rng.random()
        if t.bpm is not None and r < 0.6:
            # Saved grids: mostly agree with the column, some stale (2×, drift) — served bpm
            # (bpm_projected) and the gate column then disagree, as on the real desktop.
            tempo = t.bpm / 100
            if r < 0.06:
                tempo *= 2
            elif r < 0.12:
                tempo *= 1 + rng.uniform(-0.04, 0.04)
            changes = [{"start_time": 0.1, "bpm": round(tempo, 3), "time_signature_num": 4, "bar_position": 1}]
            if r < 0.03:
                changes.append({"start_time": 60.0, "bpm": round(tempo * 1.02, 3), "time_signature_num": 4, "bar_position": 1})
            db.add(Beatgrid(track_id=t.id, tempo_changes_json=json.dumps(changes), origin="analyzed"))
        elif r < 0.65:
            db.add(Beatgrid(track_id=t.id, tempo_changes_json=json.dumps(
                [{"start_time": 0.0, "bpm": 99.0, "time_signature_num": 4, "bar_position": 1}]), origin="generated"))
    ids = [t.id for t in tracks]
    pairs = set()
    for _ in range(60):
        a, b = sorted(rng.sample(ids, 2))
        if (a, b) not in pairs:
            pairs.add((a, b))
            db.add(TrackLink(low_track_id=a, high_track_id=b))
    for n in range(160):
        a, b = rng.sample(ids, 2)
        db.add(Transition(a_track_id=a, b_track_id=b, uuid=f"tr-{n}", position=0, name="t",
                          favorite=rng.random() < 0.3, data_json="{}"))
    for n in range(40):
        a, b = rng.sample(ids, 2)
        db.add(Cameo(host_track_id=a, guest_track_id=b, uuid=f"ca-{n}", position=0, name="c",
                     favorite=rng.random() < 0.3, data_json="{}"))
    for n in range(300):
        a, b = rng.sample(ids[:120], 2)  # concentrated: many pairs reach 2+ Takes
        db.add(Take(uuid=f"take-{n}", a_track_id=a, b_track_id=b, detected_at=base + timedelta(hours=n),
                    window_start_s=0, window_end_s=1, confidence=1, detector_version=1, params_json="{}",
                    events_json="[]", kind="handover"))
    db.commit()

    snapshot = build_snapshot(db)
    by_id = {t["id"]: t for t in snapshot["tracks"]}
    picks = rng.sample(ids, 34)
    no_bpm = next(i for i in ids if by_id[i]["bpm"] is None)
    no_key = next(i for i in ids if by_id[i]["key"] is None)
    linked_ref = next(iter(pairs))[0]
    fav_ref = next(t.a_track_id for t in db.query(Transition).filter_by(favorite=True))
    cases = [{"refs": [r], "thr": 5, "knownOnly": False, "temperature": 0, "seed": 0} for r in picks[:26]]
    cases += [{"refs": [r], "thr": 5, "knownOnly": False, "temperature": 0, "seed": 0} for r in (no_bpm, no_key, linked_ref, fav_ref)]
    cases += [{"refs": picks[26:28], "thr": 5, "knownOnly": False, "temperature": 0, "seed": 0},
              {"refs": picks[28:31], "thr": 5, "knownOnly": False, "temperature": 0, "seed": 0},
              {"refs": [picks[0], picks[1], picks[2], picks[3]], "thr": 5, "knownOnly": False, "temperature": 0, "seed": 0},
              {"refs": [linked_ref, fav_ref], "thr": 5, "knownOnly": False, "temperature": 0, "seed": 0},
              {"refs": [no_bpm, picks[5]], "thr": 5, "knownOnly": False, "temperature": 0, "seed": 0}]
    cases += [{"refs": [r], "thr": 5, "knownOnly": True, "temperature": 0, "seed": 0} for r in (linked_ref, fav_ref, picks[6])]
    cases += [{"refs": [linked_ref, fav_ref], "thr": 5, "knownOnly": True, "temperature": 0, "seed": 0}]
    cases += [{"refs": [r], "thr": t, "knownOnly": False, "temperature": 0, "seed": 0} for r, t in
              ((picks[7], 8), (picks[8], 12), (picks[9], 2), (picks[10], 0))]
    cases += [{"refs": refs, "thr": 5, "knownOnly": False, "temperature": temp, "seed": seed} for refs, temp, seed in (
        ([picks[11]], 0.3, 1), ([picks[11]], 1.0, 1), ([picks[11]], 1.0, 2), ([picks[12]], 0.65, 123456789),
        ([picks[13], picks[14]], 0.5, 4294967295), ([fav_ref, linked_ref], 1.0, 77))]

    candidates = {}
    for case in cases:
        for ref in case["refs"]:
            center = by_id[ref]["bpm"]
            key = f"{ref}:{case['thr']}"
            if key in candidates:
                continue
            if center:  # desktop deriveFollowQuery: params.bpm && reference.bpm
                rows = crud.get_tracks(db, limit=10000, bpm_center=center, bpm_threshold_percent=case["thr"])
            else:
                rows = crud.get_tracks(db, limit=10000)
            items = rows[0] if isinstance(rows, tuple) else rows
            candidates[key] = sorted(t.id for t in items)

    out.mkdir(parents=True, exist_ok=True)
    (out / "snapshot.json").write_text(json.dumps(snapshot, indent=0, sort_keys=True))
    (out / "candidates.json").write_text(json.dumps(candidates, sort_keys=True))
    (out / "cases.json").write_text(json.dumps(cases, indent=1))
    print(f"{len(snapshot['tracks'])} tracks, {len(cases)} cases, {len(candidates)} candidate sets")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
