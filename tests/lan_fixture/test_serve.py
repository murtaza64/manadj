"""Boot the real composed LAN fixture and walk the phone-sync contract
(#373/#374): pairing request -> coordinator-approved token -> snapshot ->
verified audio download, all over a real loopback socket.

This is the same fixture the Swift/iOS integration harness boots on the Apple
runner; keeping the contract test here means ci.yml verifies the launcher on
every change to the listener, pairing or device-sync code.
"""

import json
import subprocess
import sys
import time
from pathlib import Path

import pytest
import requests

SERVE = Path(__file__).parent / "serve.py"
TOKEN_HEADER = "X-Manadj-Device-Token"


@pytest.fixture
def fixture_server():
    proc = subprocess.Popen(
        [sys.executable, str(SERVE), "--seconds", "60"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        line = proc.stdout.readline().strip()
        assert line, f"fixture printed nothing; stderr tail: {proc.stderr.read()[-500:]}"
        yield json.loads(line)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


def test_pair_snapshot_audio_roundtrip(fixture_server):
    origin = fixture_server["origin"]

    # Unauthenticated surface is pairing-only.
    assert requests.get(f"{origin}/api/device-sync/snapshot", timeout=5).status_code == 401

    # Pairing request -> the fixture's local watcher approves through the
    # real PairingRequests coordinator -> poll returns a token once.
    req = requests.post(
        f"{origin}/api/device-pair/request",
        json={"device_id": "pytest-device-0001", "device_name": "pytest"},
        timeout=5,
    )
    assert req.status_code == 200, req.text
    request_id = req.json()["id"]

    token = None
    for _ in range(100):
        poll = requests.get(f"{origin}/api/device-pair/request/{request_id}", timeout=5)
        assert poll.status_code == 200, poll.text
        body = poll.json()
        if body.get("token"):
            token = body["token"]
            break
        time.sleep(0.1)
    assert token, "pairing never approved"

    headers = {TOKEN_HEADER: token}
    snap = requests.get(f"{origin}/api/device-sync/snapshot", headers=headers, timeout=5)
    assert snap.status_code == 200, snap.text
    tracks = snap.json()["tracks"]
    assert len(tracks) == fixture_server["snapshot_tracks"] == 1
    entry = tracks[0]
    assert entry["id"] == fixture_server["track_id"]
    assert entry["audio_rev"] == fixture_server["audio_rev"]
    assert entry["preview_rev"] == fixture_server["preview_rev"]
    assert entry["waveform_rev"] == fixture_server["waveform_rev"]

    audio = requests.get(
        f"{origin}/api/device-sync/tracks/{entry['id']}/audio", headers=headers, timeout=10
    )
    assert audio.status_code == 200
    assert audio.headers.get("X-Audio-Rev") == fixture_server["audio_rev"]
    assert audio.content[:4] == b"RIFF"  # the synthetic WAV, intact

    # Preview and detail waveform blobs round-trip too.
    prev = requests.post(
        f"{origin}/api/device-sync/previews",
        json={"track_ids": [entry["id"]]},
        headers=headers,
        timeout=5,
    )
    assert prev.status_code == 200 and len(prev.content) > 0
    wf = requests.get(
        f"{origin}/api/device-sync/tracks/{entry['id']}/waveform", headers=headers, timeout=5
    )
    assert wf.status_code == 200 and wf.content[:4] == b"MWF1"


def test_typed_pair_code_still_works(fixture_server):
    # The #373 typed-code path stays intact alongside token auth.
    snap = requests.get(
        f"{fixture_server['origin']}/api/device-sync/snapshot",
        headers={"X-Manadj-Pair": fixture_server["pair_code"]},
        timeout=5,
    )
    assert snap.status_code == 200
