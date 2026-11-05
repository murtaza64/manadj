"""Build Pages with its COMPLETE pinned Android snapshot; fail closed on no pin.

GitHub Release storage is upstream custody only. Clients still use the pinned
same-origin URLs. This command builds local files, never uploads or deploys.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator

from scripts.release.android_channel_contract import SHA, Channel, Strict
from scripts.release.android_producer import read, require, write
from scripts.release.android_release import sha256_file
from scripts.release.android_site_stage import heads, locked, safe

REPO = "murtaza64/manadj"
ROOT = Path(__file__).resolve().parents[2]
MAX_BYTES = 512 * 1024 * 1024
MAX_EXPANDED = 768 * 1024 * 1024
APK = re.compile(r"android/artifacts/([0-9a-f]{64})/([0-9a-f]{64})\.apk")


class Heads(Strict):
    stable: SHA | None
    preview: SHA | None


class Snapshot(Strict):
    format: Literal["manadj_android_snapshot/v1"]
    sha256: SHA
    bytes: int = Field(ge=1024, le=MAX_BYTES)
    url: str
    heads: Heads

    @property
    def tag(self):
        return "android-snapshot-" + self.sha256

    @property
    def filename(self):
        return self.tag + ".tar"

    @model_validator(mode="after")
    def pinned_source(self):
        require(self.url == f"https://github.com/{REPO}/releases/download/{self.tag}/{self.filename}",
                "Snapshot must use the one exact repository content-addressed asset")
        return self


def download(pin, directory):
    subprocess.run(["gh", "release", "download", pin.tag, "--repo", REPO,
                    "--pattern", pin.filename, "--dir", str(directory)], check=True)
    return Path(directory) / pin.filename


def validate_snapshot(pin, archive, destination):
    """Validate in private staging before changing any caller-owned site output."""
    require(archive.stat().st_size == pin.bytes and sha256_file(archive) == pin.sha256,
            "Missing/corrupt snapshot bytes or digest")
    paths, feeds, actual_heads = set(), {}, {"stable": None, "preview": None}
    total = 0
    with tarfile.open(archive, "r:") as tar:
        for member in tar:
            require(len(paths) < 4096, "Snapshot file count exceeded")
            name = member.name
            match = APK.fullmatch(name)
            channel = {"android/stable/channel.json": "stable", "android/preview/channel.json": "preview"}.get(name)
            require(member.isfile() and (match is not None or channel is not None) and name not in paths,
                    "Snapshot requires unique regular artifact/feed paths; links/traversal/extras refused")
            paths.add(name)
            total += member.size
            require(0 < member.size <= 512 * 1024 * 1024 and total <= MAX_EXPANDED, "Snapshot size exceeded")
            if channel:
                require(member.size <= 1024 * 1024, "Snapshot channel too large")
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with tar.extractfile(member) as source, target.open("xb") as output:
                shutil.copyfileobj(source, output, length=1024 * 1024)
            digest = sha256_file(target)
            if match:
                require(digest == match[2], "Snapshot artifact path/hash mismatch")
            else:
                feed = Channel.model_validate_json(target.read_bytes())
                require(feed.channel == channel, "Snapshot channel/path mismatch")
                feeds[channel] = feed
                actual_heads[channel] = digest
    require(actual_heads == pin.heads.model_dump(), "Snapshot channel heads mismatch")
    for feed in feeds.values():
        for entry in feed.entries:
            apk = destination / "android/artifacts" / entry.release_id / f"{entry.apk_sha256}.apk"
            require(apk.is_file() and apk.stat().st_size == entry.apk_bytes,
                    "Snapshot omits referenced immutable APK or has wrong size")
    return paths


def pack(root, archive):
    """Deterministically pack complete local custody; never upload or change a pointer."""
    archive = safe(archive)
    require(not archive.exists(), "Refusing to overwrite snapshot archive")
    with locked(root) as root, tempfile.TemporaryDirectory(prefix="android-snapshot-") as tmp:
        tmp = Path(tmp)
        _values, current_heads = heads(root)
        android = safe(root / "android")
        packed = tmp / "snapshot.tar"
        with tarfile.open(packed, "w", format=tarfile.USTAR_FORMAT) as tar:
            for path in sorted(android.rglob("*")) if android.exists() else []:
                safe(path)
                if path.is_dir():
                    continue
                require(path.is_file(), "Snapshot custody must contain only regular files")
                member = tarfile.TarInfo(path.relative_to(root).as_posix())
                member.size = path.stat().st_size
                member.mode = 0o444
                with path.open("rb") as source:
                    tar.addfile(member, source)
        digest = sha256_file(packed)
        tag = "android-snapshot-" + digest
        pin = Snapshot.model_validate({
            "format": "manadj_android_snapshot/v1", "sha256": digest, "bytes": packed.stat().st_size,
            "url": f"https://github.com/{REPO}/releases/download/{tag}/{tag}.tar", "heads": current_heads,
        })
        validate_snapshot(pin, packed, tmp / "validate")
        with packed.open("rb") as source, archive.open("xb") as output:
            shutil.copyfileobj(source, output, length=1024 * 1024)
        return pin.model_dump()


def build(pointer, output, snapshot=None):
    pin = Snapshot.model_validate(read(pointer))  # Missing pin is deliberately fatal.
    output = safe(output)
    require(not output.exists(), "Use a fresh site output; never replace an existing Android snapshot")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="android-pages-", dir=output.parent) as tmp:
        tmp = Path(tmp)
        archive = Path(snapshot) if snapshot is not None else download(pin, tmp)
        overlay = tmp / "overlay"
        overlay.mkdir()
        paths = validate_snapshot(pin, archive, overlay)
        staged = tmp / "site"
        subprocess.run(["uv", "run", str(ROOT / "site/build.py"), "--output", str(staged)],
                       cwd=ROOT, check=True)
        if (overlay / "android").exists():
            shutil.copytree(overlay / "android", staged / "android")
        # Both validation and site rendering completed before making output visible.
        staged.rename(output)
    return {"format": "manadj_android_pages_build/v1", "state": "local-site-built",
            "snapshot_sha256": pin.sha256, "heads": pin.heads.model_dump(), "android_files": len(paths)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pack-site", type=Path, help="Pack complete site Android custody instead of building")
    parser.add_argument("--pointer-out", type=Path, help="Create-only generated pointer for protected review; never commits it")
    parser.add_argument("--pointer", type=Path, default=ROOT / "site/android-snapshot.json")
    parser.add_argument("--snapshot", type=Path, help="Offline exact archive; SHA/size still mandatory")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.pack_site:
        require(args.pointer_out is not None, "--pointer-out required with --pack-site")
        result = pack(args.pack_site, args.output)
        write(args.pointer_out, result)
    else:
        result = build(args.pointer, args.output, args.snapshot)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
