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

    uv run scripts/slskd/fetch_slskd.py [--dest DIR] [--force]
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
ASSET = f"slskd-{SLSKD_VERSION}-osx-arm64.zip"
URL = f"https://github.com/slskd/slskd/releases/download/{SLSKD_VERSION}/{ASSET}"
SHA256 = "53bd82e26224908abb30780f3e3a3ee58788d17379354b3138c85c6fe02cd5a0"

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DEST = REPO_ROOT / "vendor" / "slskd"
VERSION_MARKER = ".manadj-slskd-version"


def fetch(dest: Path, force: bool = False) -> Path:
    binary = dest / "slskd"
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
    subprocess.run(["xattr", "-dr", "com.apple.quarantine", str(dest)], check=False, capture_output=True)
    marker.write_text(SLSKD_VERSION + "\n")
    print(f"slskd {SLSKD_VERSION} -> {binary}")
    return binary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dest", type=Path, default=DEFAULT_DEST)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    fetch(args.dest.resolve(), force=args.force)


if __name__ == "__main__":
    main()
