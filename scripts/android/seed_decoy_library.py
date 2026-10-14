#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["requests<3"]
# ///
"""Seed a decoy Library for Android device-sync checks (#372).

Generates synthetic audio (ffmpeg: pulse at the Track's BPM + a tone) and
creates Tracks, Tags, Links, Transitions and Takes through the backend API,
then waits for preview waveforms. Point it at an EMPTY-DB lane app only:

    uv run scripts/android/seed_decoy_library.py http://127.0.0.1:<backend port> <audio dir>
"""

import subprocess
import sys
import time
import uuid
from pathlib import Path

import requests

# (title, artist, bpm, engine key id, energy, tags, tone Hz)
TRACKS = [
    ("Decoy Frontier", "Synth Unit", 174.0, 15, 4, ["Neuro", "Dark"], 220),
    ("Decoy Rolling", "Synth Unit feat. Probe", 172.0, 13, 3, ["Neuro", "Rolling"], 247),
    ("Decoy Halftime", "Test Pattern", 87.0, 17, 2, ["Dark"], 196),
    ("Decoy Liquid", "Calibration & Tone", 174.0, 16, 3, ["Liquid", "Rolling"], 262),
    ("Decoy House", "Grid Check", 124.0, 2, 3, ["House"], 330),
    ("Decoy Sprint", "Signal Path", 176.0, 15, 5, ["Neuro", "Dark", "Rolling"], 294),
    ("Decoy Outlier", "Noise Floor", 140.0, 6, 1, [], 175),
    ("Decoy Dub", "Test Pattern", 170.0, 19, 2, ["Liquid"], 208),
]
TAG_CATEGORIES = {"Genre": ("#ff1744", ["Neuro", "Liquid", "House"]), "Vibe": ("#00e5ff", ["Dark", "Rolling"])}


def make_audio(path: Path, bpm: float, tone: int, seconds: int = 90) -> None:
    beat = 60.0 / bpm
    expr = f"0.7*sin(2*PI*55*t)*exp(-12*mod(t\\,{beat:.6f}))+0.15*sin(2*PI*{tone}*t)*(0.5+0.5*sin(2*PI*t/8))"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"aevalsrc={expr}:s=44100:d={seconds}",
         "-ac", "2", "-c:a", "libmp3lame", "-b:a", "192k", str(path)],
        check=True,
    )


def main(base: str, audio_dir: Path) -> None:
    api = base.rstrip("/") + "/api"
    s = requests.Session()
    if s.get(f"{api}/tracks/", params={"per_page": 1}).json()["library_total"]:
        sys.exit("refusing: library is not empty (use an --empty-db lane app)")
    audio_dir.mkdir(parents=True, exist_ok=True)

    tag_ids: dict[str, int] = {}
    for order, (cat, (color, names)) in enumerate(TAG_CATEGORIES.items()):
        c = s.post(f"{api}/tags/categories", json={"name": cat, "color": color, "display_order": order}).json()
        for i, name in enumerate(names):
            tag_ids[name] = s.post(f"{api}/tags/", json={"name": name, "category_id": c["id"], "display_order": i}).json()["id"]

    ids = []
    for title, artist, bpm, key, energy, tags, tone in TRACKS:
        path = audio_dir / f"{artist} - {title}.mp3"
        make_audio(path, bpm, tone)
        t = s.post(f"{api}/tracks/", json={"filename": str(path), "title": title, "artist": artist,
                                           "duration_secs": 90.0, "codec": "mp3", "filesize_bytes": path.stat().st_size})
        t.raise_for_status()
        tid = t.json()["id"]
        s.patch(f"{api}/tracks/{tid}", json={"bpm": bpm, "key": key, "energy": energy,
                                             "tag_ids": [tag_ids[n] for n in tags]}).raise_for_status()
        ids.append(tid)
        time.sleep(1.1)  # distinct date-added seconds

    a, b, c, d, e, f, g, h = ids
    s.put(f"{api}/track-links/pair/{a}/{d}", json={"linked": True}).raise_for_status()
    for (x, y), fav in {(a, b): True, (a, f): False, (b, a): False}.items():
        s.put(f"{api}/transitions/pair/{x}/{y}", json={"items": [
            {"uuid": str(uuid.uuid4()), "name": "decoy", "favorite": fav, "data": {}}]}).raise_for_status()
    for _ in range(3):
        s.post(f"{api}/takes", json={"uuid": str(uuid.uuid4()), "a_track_id": a, "b_track_id": h,
                                     "window_start_s": 0, "window_end_s": 8, "confidence": 0.9,
                                     "detector_version": 1, "params": {}, "events": []}).raise_for_status()

    for order, (name, color, members) in enumerate([("Warmup", "#00e676", [c, h, d]), ("Peak time", "#ff1744", [f, a, b])]):
        pid = s.post(f"{api}/playlists/", json={"name": name, "color": color, "display_order": order}).json()["id"]
        for tid in members:
            s.post(f"{api}/playlists/{pid}/tracks", json={"track_id": tid}).raise_for_status()

    pending = set(ids)
    deadline = time.time() + 300
    while pending and time.time() < deadline:
        for tid in list(pending):
            if s.get(f"{api}/waveforms/{tid}/preview").status_code == 200:
                pending.discard(tid)
        time.sleep(2)
    print(f"seeded {len(ids)} decoy tracks {ids}; previews missing: {sorted(pending) or 'none'}")


if __name__ == "__main__":
    main(sys.argv[1], Path(sys.argv[2]))
