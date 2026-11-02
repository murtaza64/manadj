#!/usr/bin/env -S uv run
"""Disposable desktop A -> B paired-device fixture for Android host tests; no real data."""
import argparse
import json
import math
import os
from pathlib import Path
import socket
import struct
import sys
import tempfile
import wave


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-source", type=Path, required=True)
    parser.add_argument("--scratch-parent", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()
    # Only new disposable roots under an explicitly provided scratch parent.
    with tempfile.TemporaryDirectory(prefix="peer-android443-", dir=args.scratch_parent) as tmp:
        root = Path(tmp)
        sys.dont_write_bytecode = True
        sys.path.insert(0, str(args.backend_source.resolve()))
        os.environ["MANADJ_DATA_DIR"] = str(root / "data")
        os.environ["MANADJ_DB_URL"] = f"sqlite:///{root / 'unused.db'}"
        from tests import test_peer_session_exchange as exchange
        from tests.test_peer_device_adapter import device
        from backend.models import Track
        import uvicorn

        fixture = exchange.instance.__wrapped__(root)
        make = next(fixture)
        try:
            a, b, ai, bi, sid = exchange.setup_pair(make)
            for peer in (a, b):
                with wave.open(str(peer.root / "generated.wav"), "wb") as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(8000)
                    wav.writeframes(b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * 440 * n / 8000))) for n in range(16000)))
            peer = device(b)
            def item():
                result = peer.get("/api/device-sync/peer-sessions")
                assert result.status_code == 200, result.text
                return result.json()["items"][0]
            first = exchange.export(a, sid, seqs=[0])
            logical = first["manifest"]["tracks"][0]["logical_track_id"]
            exchange.post(b, "imports", first)
            states = [item()["state"]]
            b = make("b")  # durable partial intake survives new engine/application
            peer = device(b)
            exchange.post(b, "imports", exchange.export(a, sid, seqs=[1]))
            states.append(item()["state"])
            exchange.bind(b, 9, logical)
            states.append(item()["state"])
            exchange.post(b, f"sessions/{sid}/materialize")
            states.append(item()["state"])
            assert exchange.post(b, "imports", first)["duplicate"]
            b = make("b")
            peer = device(b)
            app = peer.app
            saved = (b.root / "generated.wav").read_bytes()

            @app.post("/fixture/missing")
            def missing():
                (b.root / "generated.wav").unlink(missing_ok=True)
                return {"decoy_only": True}

            @app.post("/fixture/rebind")
            def rebind():
                (b.root / "generated.wav").write_bytes(saved)
                with b.sessions() as db:
                    db.delete(db.get(Track, 9))
                    db.commit()
                exchange.seed(b, 9)
                (b.root / "generated.wav").write_bytes(saved)
                exchange.bind(b, 9, logical)
                assert item()["state"] == "stale_binding"
                exchange.post(b, f"sessions/{sid}/materialize")
                return {"decoy_only": True, "item": item()}

            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                receipt = {"url": f"http://127.0.0.1:{sock.getsockname()[1]}", "session_uuid": sid,
                           "origin": ai["replica_id"], "receiver": bi["replica_id"], "source_track": 1,
                           "receiver_track": 9, "unrelated_receiver_track": 1, "states": states,
                           "item": item(), "pair_code": "test-code", "scratch_root": str(root)}
                args.receipt.write_text(json.dumps(receipt, indent=2))
                uvicorn.Server(uvicorn.Config(app, log_level="warning")).run(sockets=[sock])
        finally:
            fixture.close()


if __name__ == "__main__":
    main()
