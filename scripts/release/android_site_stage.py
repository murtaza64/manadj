"""Local same-origin Pages overlay; no network, signing, deploy or publication claims.

artifact stages immutable bytes first. A protected operator publishes that full
site, reads the HTTPS artifact back, then supplies the readback to offer. offer
does local both-channel CAS and atomic feed replacement. Remote publication/CAS
must be serialized separately by the protected operator. See the #419 PRD.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import os
from pathlib import Path
import tempfile

from scripts.release.android_channel_contract import Channel, SignReceipt, canonical, sha
from scripts.release.android_producer import read, require, write
from scripts.release.android_release import sha256_file


def safe(path):
    path = Path(path).absolute()
    require(not any(p.is_symlink() for p in (path, *path.parents)), "Symlink staging path refused")
    return path


@contextmanager
def locked(root):
    root = safe(root)
    require(root.is_dir(), "Build the existing site first; staging root must exist")
    lock = safe(root.parent / f".{root.name}.android-stage.lock")
    with lock.open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield root


def bind(feed_value, receipt_value):
    feed = Channel.model_validate(feed_value)
    receipt = SignReceipt.model_validate(receipt_value)
    entry = feed.entries[-1]
    build = receipt.build
    for key in ("release_id", "version_code", "version_name", "min_sdk", "abis", "source_revision",
                "source_tree_sha256", "build_batch_id", "notes_sha256"):
        require(getattr(entry, key) == getattr(build, key), f"Feed/signed build mismatch: {key}")
    require(entry.apk_sha256 == receipt.apk_sha256 and entry.apk_bytes == receipt.apk_bytes,
            "Feed/signed bytes mismatch")
    return feed, receipt, entry


def artifact_path(root, entry):
    return safe(root / "android" / "artifacts" / entry.release_id / f"{entry.apk_sha256}.apk")


def atomic_bytes(path, data):
    path = safe(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".android-stage-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp, path)
    finally:
        Path(temp).unlink(missing_ok=True)


def artifact(root, apk, feed_value, receipt_value):
    feed, receipt, entry = bind(feed_value, receipt_value)
    apk = safe(apk)
    require(apk.stat().st_size == entry.apk_bytes and sha256_file(apk) == entry.apk_sha256,
            "Artifact bytes do not match the verified eligible release")
    with locked(root) as root:
        destination = artifact_path(root, entry)
        if destination.exists():
            require(destination.stat().st_size == entry.apk_bytes and sha256_file(destination) == entry.apk_sha256,
                    "Immutable artifact collision")
        else:
            # Snapshot bounded input before writing and rehash to close input mutation.
            data = apk.read_bytes()
            require(len(data) == entry.apk_bytes and hashlib.sha256(data).hexdigest() == entry.apk_sha256,
                    "Artifact changed while copying")
            atomic_bytes(destination, data)
        return {"format": "manadj_android_artifact_staged/v1", "state": "local-artifact-staged",
                "url": entry.apk_url, "apk_sha256": entry.apk_sha256, "apk_bytes": entry.apk_bytes,
                "sign_receipt_sha256": sha(receipt.model_dump()), "channel_sha256": sha(feed.model_dump()),
                "staged_feed_sha256": hashlib.sha256(canonical(feed.model_dump()) + b"\n").hexdigest(),
                "staged_feed_bytes": len(canonical(feed.model_dump()) + b"\n")}


def heads(root):
    values, digests = {}, {}
    for channel in ("stable", "preview"):
        path = safe(root / "android" / channel / "channel.json")
        if path.exists():
            raw = path.read_bytes()
            value = Channel.model_validate_json(raw)
            require(value.channel == channel, "Existing history channel mismatch")
            values[channel] = value
            digests[channel] = hashlib.sha256(raw).hexdigest()
        else:
            values[channel] = None
            digests[channel] = None
    return values, digests


def offer(root, feed_value, receipt_value, served, expected_heads, floor_code):
    feed, receipt, entry = bind(feed_value, receipt_value)
    require(set(expected_heads) == {"stable", "preview"}, "Both expected channel heads required")
    require(type(floor_code) is int and floor_code >= 7, "Trusted package-wide floor must include code7")
    # This receipt is selected by a TRUSTED LOCAL operator after actual HTTPS
    # readback, never supplied by a public client. JSON alone proves no network IO.
    require(set(served) == {"format", "url", "apk_sha256", "apk_bytes", "status", "redirected",
                            "sign_receipt_sha256", "expected_heads"}, "Wrong artifact readback shape")
    require(served["format"] == "manadj_android_artifact_readback/v1"
            and type(served["status"]) is int and served["status"] == 200
            and served["redirected"] is False, "Successful no-redirect artifact readback required")
    require(served["url"] == entry.apk_url and served["apk_sha256"] == entry.apk_sha256
            and type(served["apk_bytes"]) is int and served["apk_bytes"] == entry.apk_bytes
            and served["sign_receipt_sha256"] == sha(receipt.model_dump())
            and served["expected_heads"] == expected_heads, "Artifact readback binding mismatch")
    with locked(root) as root:
        previous, actual = heads(root)
        require(actual == expected_heads, "Stale channel history: compare-and-swap refused")
        maximum = max([floor_code] + [e.version_code for old in previous.values() if old for e in old.entries])
        require(entry.version_code > maximum, "Cross-channel version rollback/reuse refused")
        old_entries = previous[feed.channel].entries if previous[feed.channel] else []
        require(feed.entries[:-1] == old_entries, "Feed must preserve complete existing channel history")
        staged = artifact_path(root, entry)
        require(staged.is_file() and staged.stat().st_size == entry.apk_bytes
                and sha256_file(staged) == entry.apk_sha256, "Stage immutable artifact before feed")
        path = safe(root / "android" / feed.channel / "channel.json")
        raw = canonical(feed.model_dump()) + b"\n"
        atomic_bytes(path, raw)
        return {"format": "manadj_android_offer_staged/v1", "state": "local-feed-staged",
                "channel": feed.channel, "channel_sha256": hashlib.sha256(raw).hexdigest(),
                "previous_heads": actual, "artifact_readback_sha256": sha(served),
                "release_id": entry.release_id, "apk_sha256": entry.apk_sha256}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("artifact", "offer"))
    for flag in ("site-root", "feed", "sign-receipt", "out"):
        parser.add_argument("--" + flag, required=True)
    parser.add_argument("--apk")
    parser.add_argument("--feed-bytes-out", help="Create-only exact canonical+newline feed bytes for the protected plan")
    parser.add_argument("--served-artifact")
    parser.add_argument("--expected-heads")
    parser.add_argument("--floor-code", type=int)
    args = parser.parse_args()
    feed, receipt = read(args.feed), read(args.sign_receipt)
    if args.command == "artifact":
        require(args.apk is not None, "--apk required")
        result = artifact(args.site_root, args.apk, feed, receipt)
        if args.feed_bytes_out:
            with safe(args.feed_bytes_out).open("xb") as output:
                output.write(canonical(Channel.model_validate(feed).model_dump()) + b"\n")
    else:
        require(args.served_artifact and args.expected_heads and args.floor_code is not None,
                "--served-artifact, --expected-heads and --floor-code required")
        result = offer(args.site_root, feed, receipt, read(args.served_artifact), read(args.expected_heads), args.floor_code)
    write(args.out, result)


if __name__ == "__main__":
    main()
