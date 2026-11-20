#!/usr/bin/env python3
"""Real-composed LAN fixture for phone-sync integration tests (#373/#374).

Boots the ACTUAL desktop LAN listener (backend.device_listener.DeviceListener
serving the real device-pair + device-sync routers) on 127.0.0.1, backed by a
real SQLite database built through the alembic migration chain and seeded with
one synthetic track (generated WAV + MWF waveform blobs). No real library,
no credentials, no external services, no network beyond loopback.

Pairing approval goes through the real PairingRequests coordinator, approved
by a local test-only watcher thread in THIS process (no unauthenticated
product endpoint; the manual desktop approval UI is untouched). Pairing
tokens are returned to the connecting client only, never written to disk or
artifacts by this launcher.

Stdout protocol: one JSON line once serving, e.g.
  {"origin": "http://127.0.0.1:51234", "pair_code": "ABCDE-FGHJK",
   "track_id": 1, "audio_rev": "...", "previews_rev": "...",
   "waveform_rev": "...", "snapshot_tracks": 1}
Shutdown: SIGINT/SIGTERM, stdin EOF, or --seconds elapsing; the listener is
stopped and the temp data dir removed (unless --data-dir was given).

Requires the backend deps (fastapi/uvicorn/sqlalchemy/alembic/numpy/requests
are NOT needed by the client: only this host side runs Python).
"""

import argparse
import json
import math
import os
import shutil
import signal
import socket
import struct
import sys
import tempfile
import threading
import time
import wave
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--live", action="store_true", help="publish synthetic test anchors, no real playback")
    p.add_argument("--port", type=int, default=0, help="loopback port (0 = pick a free one)")
    p.add_argument("--data-dir", type=Path, default=None,
                   help="keep this data dir instead of a deleted temp dir")
    p.add_argument("--seconds", type=float, default=0,
                   help="exit after N seconds (0 = wait for signal/stdin EOF)")
    p.add_argument("--pair-code", default="ABCDE-FGHJK",
                   help="typed pairing code the listener also accepts")
    return p.parse_args()


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _write_synthetic_wav(path: Path, seconds: float = 2.0, freq: float = 440.0,
                         rate: int = 44100) -> None:
    """Stdlib-only 16-bit mono tone; no ffmpeg or audio deps needed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    n = int(seconds * rate)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = bytearray()
        for i in range(n):
            # Soft-attack tone so peaks are not all identical.
            env = min(1.0, i / (0.05 * rate)) * 0.8
            sample = int(env * 32767 * math.sin(2 * math.pi * freq * i / rate))
            frames += struct.pack("<h", sample)
        w.writeframes(bytes(frames))


def _build_engine(db_file: Path):
    """File-backed SQLite with the full schema via alembic upgrade head."""
    from alembic import command as alembic_command
    from alembic.config import Config as AlembicConfig
    from sqlalchemy import create_engine, event
    from sqlalchemy.pool import StaticPool

    from backend.database import apply_sqlite_pragmas

    engine = create_engine(
        f"sqlite:///{db_file}",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    event.listen(engine, "connect", apply_sqlite_pragmas)
    with engine.connect() as connection:
        cfg = AlembicConfig(str(REPO_ROOT / "alembic.ini"))
        cfg.attributes["connection"] = connection
        cfg.attributes["configure_logger"] = False
        alembic_command.upgrade(cfg, "head")
    return engine


def _seed(engine, wav_path: Path) -> int:
    """Insert one synthetic track with real-format MWF waveform blobs."""
    import numpy as np
    from sqlalchemy.orm import sessionmaker

    from backend import waveform_data
    from backend.models import Track, Waveform

    rate = waveform_data.SAMPLE_RATE
    duration = 2.0
    n_peaks = int(duration * rate / waveform_data.PEAK_HOP)
    n_frames = int(duration * rate / waveform_data.BAND_HOP)
    # Smooth deterministic peaks/bands; content is synthetic but the MWF1
    # container is byte-identical in format to analyzer output.
    x = np.linspace(0, 1, max(n_peaks, 1), dtype=np.float32)
    peaks = (0.2 + 0.6 * np.abs(np.sin(8 * np.pi * x))).astype(np.float32)
    bands = np.stack(
        [peaks[: n_frames] * (1.0 - b / waveform_data.N_BANDS)
         for b in range(waveform_data.N_BANDS)],
        axis=1,
    ).astype(np.float32) if n_frames >= 1 else np.zeros((1, waveform_data.N_BANDS), np.float32)
    blob = waveform_data.build_blob(peaks, bands, duration)
    preview = waveform_data.build_preview_blob(blob)

    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    with Session() as db:
        track = Track(
            filename=str(wav_path),
            title="Synthetic LAN Tone",
            artist="manaDJ fixture",
        )
        db.add(track)
        db.commit()
        db.refresh(track)
        db.add(Waveform(
            track_id=track.id,
            sample_rate=rate,
            duration=duration,
            samples_per_peak=waveform_data.PEAK_HOP,
            data_blob=blob,
            preview_blob=preview,
        ))
        db.commit()
        return track.id


def _describe(engine, track_id: int, wav_path: Path) -> dict:
    """Report exactly what the real snapshot builder exposes for this track."""
    from sqlalchemy.orm import sessionmaker

    from backend.routers import device_sync

    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    with Session() as db:
        snap = device_sync.build_snapshot(db)
        entry = next(t for t in snap["tracks"] if t["id"] == track_id)
        return {
            "track_id": track_id,
            "audio_rev": entry.get("audio_rev"),
            "preview_rev": entry.get("preview_rev"),
            "waveform_rev": entry.get("waveform_rev"),
            "snapshot_tracks": len(snap["tracks"]),
            "title": entry.get("title"),
        }


def main() -> int:
    args = _parse_args()

    own_tmp = args.data_dir is None
    data_dir = args.data_dir or Path(tempfile.mkdtemp(prefix="manadj-lan-fixture-"))
    data_dir.mkdir(parents=True, exist_ok=True)

    # Point all app state at the fixture dir BEFORE importing backend modules
    # that resolve paths at import time.
    os.environ["MANADJ_DATA_DIR"] = str(data_dir)
    os.environ["MANADJ_DB_URL"] = f"sqlite:///{data_dir / 'fixture.sqlite'}"
    sys.path.insert(0, str(REPO_ROOT))

    from backend.device_listener import DeviceListener
    from backend.device_pairing import DeviceRegistry, PairingRequests

    wav_path = data_dir / "tracks" / "synthetic_tone.wav"
    _write_synthetic_wav(wav_path)
    engine = _build_engine(data_dir / "fixture.sqlite")
    track_id = _seed(engine, wav_path)

    registry = DeviceRegistry()
    pairing = PairingRequests(registry)
    listener = DeviceListener(host="127.0.0.1", advertise=False)
    port = args.port or _free_port()

    stop_event = threading.Event()

    def auto_approve() -> None:
        """Test-only local approval: decides through the real coordinator,
        in-process. The product's unauthenticated surface is unchanged."""
        seen: set[str] = set()
        while not stop_event.is_set():
            for req in pairing.pending():
                if req.id not in seen:
                    seen.add(req.id)
                    pairing.decide(req.id, True)
            time.sleep(0.05)

    listener.start(port, lambda: args.pair_code, pairing)
    if not listener.running:
        raise RuntimeError(listener.error or "Synthetic LAN listener did not start")
    watcher = threading.Thread(target=auto_approve, daemon=True)
    watcher.start()

    def synthetic_live() -> None:
        # Test-only generated anchor source, not desktop audio engine proof.
        from uuid import uuid4
        from sqlalchemy.orm import sessionmaker
        from backend.local_live import LiveAnchor, publish
        session = sessionmaker(bind=engine)
        stream = str(uuid4()); seq = 0
        while not stop_event.is_set():
            phase = time.monotonic() % 10
            # A deliberate four-second test-source silence proves native stale pause.
            if phase >= 6:
                stop_event.wait(.1)
                continue
            row = dict(track_id=track_id, position=.25 + (phase % .5), playing=phase < 3,
                pitch=0, bend=0, fader=.6, trim=.5, low=.5, mid=.5, high=.5,
                filter=0, key_lock=False, unsupported=[])
            empty = dict(row, track_id=None, playing=False)
            with session() as db:
                publish(LiveAnchor.model_validate(dict(stream_id=stream, seq=seq,
                    decks=[row, empty, empty, empty], unsupported=[])), db)
            seq += 1
            stop_event.wait(.1)
    if args.live:
        threading.Thread(target=synthetic_live, daemon=True).start()


    info = {
        "origin": f"http://127.0.0.1:{port}",
        "pair_code": args.pair_code,
        **_describe(engine, track_id, wav_path),
    }
    print(json.dumps(info), flush=True)

    def quit_now(*_a) -> None:
        stop_event.set()

    signal.signal(signal.SIGINT, quit_now)
    signal.signal(signal.SIGTERM, quit_now)

    def watch_stdin() -> None:
        sys.stdin.read()
        stop_event.set()

    threading.Thread(target=watch_stdin, daemon=True).start()

    waited = 0.0
    while not stop_event.is_set():
        if args.seconds and waited >= args.seconds:
            break
        time.sleep(0.1)
        waited += 0.1

    listener.stop()
    engine.dispose()
    if own_tmp:
        shutil.rmtree(data_dir, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
