#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# ///
"""Fetch the pinned, unmodified slskd release that manadj supervises (#291).

Downloads the osx-arm64 release zip, verifies its sha256, and unpacks it
into DEST (default: <repo>/vendor/slskd). The unpacked directory is the
binary contract: DEST/slskd (executable) + DEST/wwwroot/ (web UI) +
licence files. Dev resolves vendor/slskd/slskd; the packaged app (#280)
runs this script with --dest <App>/Contents/Resources/slskd, which the
backend (Resources/backend/) finds as ../slskd/slskd. MANADJ_SLSKD_BIN
overrides both.

slskd is AGPL-3.0; manadj ships it unmodified as a separate process.
Source: https://github.com/slskd/slskd/tree/<SLSKD_VERSION>

    uv run scripts/slskd/fetch_slskd.py [--dest DIR] [--force] [--rid osx-arm64|win-x64]
"""

import argparse
import hashlib
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

SLSKD_VERSION = "0.26.0"
# Release runtime id -> pinned sha256 (GitHub's published asset digests).
# osx-arm64: the DMG (#280); win-x64: the Windows installer (#317).
SHA256S = {
    "osx-arm64": "53bd82e26224908abb30780f3e3a3ee58788d17379354b3138c85c6fe02cd5a0",
    "win-x64": "942299d8c97da6cc1f6cd82dcd4a3662b97b82fbd1742df4bec165b79357268a",
}
DEFAULT_RID = "osx-arm64"


def asset(rid: str) -> str:
    return f"slskd-{SLSKD_VERSION}-{rid}.zip"


def url(rid: str) -> str:
    return f"https://github.com/slskd/slskd/releases/download/{SLSKD_VERSION}/{asset(rid)}"


def binary_name(rid: str) -> str:
    return "slskd.exe" if rid.startswith("win") else "slskd"

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DEST = REPO_ROOT / "vendor" / "slskd"
VERSION_MARKER = ".manadj-slskd-version"


def fetch(dest: Path, force: bool = False, rid: str = DEFAULT_RID) -> Path:
    if rid not in SHA256S:
        sys.exit(f"unsupported runtime id {rid!r} (pinned: {', '.join(SHA256S)})")
    ASSET, URL, SHA256 = asset(rid), url(rid), SHA256S[rid]
    binary = dest / binary_name(rid)
    marker = dest / VERSION_MARKER
    if not force and binary.exists() and marker.exists() and marker.read_text().strip() == SLSKD_VERSION:
        print(f"slskd {SLSKD_VERSION} already at {binary}")
        return binary

    with tempfile.TemporaryDirectory() as tmp:
        zip_path = Path(tmp) / ASSET
        print(f"downloading {URL}")
        with urllib.request.urlopen(URL) as resp, open(zip_path, "wb") as out:
            shutil.copyfileobj(resp, out)
        digest = hashlib.sha256(zip_path.read_bytes()).hexdigest()
        if digest != SHA256:
            sys.exit(f"sha256 mismatch for {ASSET}: got {digest}, pinned {SHA256}")
        if dest.exists():
            shutil.rmtree(dest)
        dest.mkdir(parents=True)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(dest)

    binary.chmod(binary.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    # Downloaded via urllib there is no quarantine xattr, but a copied-in
    # bundle may carry one; clearing it is harmless when absent.
    if sys.platform == "darwin":
        subprocess.run(["xattr", "-dr", "com.apple.quarantine", str(dest)], check=False, capture_output=True)
    marker.write_text(SLSKD_VERSION + "\n")
    print(f"slskd {SLSKD_VERSION} -> {binary}")
    return binary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dest", type=Path, default=DEFAULT_DEST)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--rid", default=DEFAULT_RID, choices=sorted(SHA256S),
                        help="slskd release runtime id (default: osx-arm64)")
    args = parser.parse_args()
    fetch(args.dest.resolve(), force=args.force, rid=args.rid)


if __name__ == "__main__":
    main()
