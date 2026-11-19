# LAN fixture: real composed PhoneSyncServer for phone integration tests

Boots the actual desktop LAN listener (`backend.device_listener.DeviceListener`
serving the real `/api/device-pair/*` + `/api/device-sync/*` routers) on
loopback, backed by a real SQLite database built through the alembic migration
chain and seeded with one synthetic track (generated WAV + MWF waveform blobs).
No real library, no credentials, no external services, no network beyond
127.0.0.1.

## Requirements (macOS / Apple runner host)

- Python 3.13+ (repo requirement; `python3 --version` to check). Any 3.13
  install works: `brew install python@3.13`, or the python.org installer.
- The backend's Python deps installed once, from the repo root:
  `python3 -m pip install -e .` (or `pip install -r requirements.txt` where
  the project pins them). numpy, fastapi, uvicorn, sqlalchemy, alembic are
  the relevant ones; ffmpeg is NOT needed (the fixture synthesizes its blobs
  directly).

## Start

From the repo root:

```
python3 tests/lan_fixture/serve.py --port 0
```

First stdout line is the JSON descriptor for the test bundle:

```json
{"origin": "http://127.0.0.1:51234", "pair_code": "ABCDE-FGHJK",
 "track_id": 1, "audio_rev": "...", "preview_rev": "...",
 "waveform_rev": "...", "snapshot_tracks": 1, "title": "Synthetic LAN Tone"}
```

Capture that line into the test bundle's JSON, then generate the Xcode
project as usual. `track_id` + `*_rev` values let the client verify it
downloaded exactly what the fixture served.

Options: `--data-dir PATH` keeps the seeded data dir (default: temp dir,
deleted on exit). `--seconds N` self-terminates. `--pair-code` overrides the
typed pairing code.

## Pairing

POST `/api/device-pair/request` as usual. A watcher thread inside the fixture
process approves pending requests through the real `PairingRequests`
coordinator (`decide()`), in-process; there is no new unauthenticated HTTP
surface and the desktop's manual approval UI is untouched. Poll
`/api/device-pair/request/{id}` for the token, then send it as
`X-Manadj-Device-Token`. Tokens exist only in the client's hands: the fixture
never writes them to disk, logs or artifacts. The typed pair code
(`X-Manadj-Pair`) also works for smoke checks.

## Shutdown

SIGINT/SIGTERM, closing the launcher's stdin, or `--seconds` elapsing. The
listener is stopped (`DeviceListener.stop()`), the DB engine disposed, and the
temp data dir removed unless `--data-dir` was passed.

## Contract coverage

`tests/lan_fixture/test_serve.py` boots this launcher in CI (ci.yml, Python
3.13) and walks: 401 unauthenticated, pair request, coordinator-approved token
via poll, snapshot with per-track `audio_rev`/`preview_rev`/`waveform_rev`,
verified audio download (`X-Audio-Rev` + WAV bytes), previews pack, MWF1
waveform fetch, and the typed-code path. Physical Wi-Fi reachability and
macOS LAN permissions are a separate manual layer this fixture does not cover.
