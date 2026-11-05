"""Offline pinned-custody tests; all archives, APK bytes and outputs are decoys."""
import hashlib
import io
import json
import tarfile
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest

from scripts.release import android_pages_build as p
from tests import test_android_site_stage as stage_tests


@pytest.fixture
def staging(tmp_path):
    return stage_tests.staging.__wrapped__(tmp_path)


def snapshot(tmp_path, files):
    archive = tmp_path / "snapshot.tar"
    with tarfile.open(archive, "w") as tar:
        for name, data in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(data)
            tar.addfile(member, io.BytesIO(data))
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    heads = {name: hashlib.sha256(files[f"android/{name}/channel.json"]).hexdigest()
             if f"android/{name}/channel.json" in files else None for name in ("stable", "preview")}
    pointer = tmp_path / "pointer.json"
    value = {"format": "manadj_android_snapshot/v1", "sha256": digest, "bytes": archive.stat().st_size,
             "heads": heads,
             "url": f"https://github.com/murtaza64/manadj/releases/download/android-snapshot-{digest}/android-snapshot-{digest}.tar"}
    pointer.write_text(json.dumps(value))
    return archive, pointer, value


def files_for(f):
    _root, apk, feed, _receipt, _served, _heads = f
    entry = feed["entries"][0]
    apk_path = f"android/artifacts/{entry['release_id']}/{entry['apk_sha256']}.apk"
    return {apk_path: apk.read_bytes(), "android/stable/channel.json": json.dumps(feed, indent=2).encode() + b"\n"}


def test_unrelated_real_site_build_preserves_all_snapshot_bytes_and_cname(staging, tmp_path):
    files = files_for(staging)
    preview = {**staging[2], "channel": "preview"}
    files["android/preview/channel.json"] = json.dumps(preview).encode()
    archive, pointer, pin = snapshot(tmp_path, files)
    output = tmp_path / "fresh-site"
    result = p.build(pointer, output, archive)
    assert result["snapshot_sha256"] == pin["sha256"]
    assert result["heads"] == pin["heads"]
    for name, data in files.items():
        assert (output / name).read_bytes() == data
    assert (output / "index.html").is_file()
    assert (output / "CNAME").read_bytes() == (p.ROOT / "site/CNAME").read_bytes()
    with pytest.raises(ValueError, match="fresh site output"):
        p.build(pointer, output, archive)


def test_missing_pin_and_corrupt_snapshot_fail_before_site_output(staging, tmp_path):
    output = tmp_path / "not-created"
    with pytest.raises(FileNotFoundError):
        p.build(tmp_path / "missing.json", output)
    archive, pointer, _pin = snapshot(tmp_path, files_for(staging))
    with archive.open("ab") as f:
        f.write(b"corruption")
    with pytest.raises(ValueError, match="snapshot bytes or digest"):
        p.build(pointer, output, archive)
    assert not output.exists()


@pytest.mark.parametrize("url", ["https://example.com/snapshot.tar", "https://github.com/evil/manadj/releases/latest",
    "http://github.com/murtaza64/manadj/snapshot.tar"])
def test_snapshot_source_is_exact_repo_asset_not_arbitrary_url(staging, tmp_path, url):
    _archive, _pointer, value = snapshot(tmp_path, files_for(staging))
    with pytest.raises(ValueError, match="exact repository"):
        p.Snapshot.model_validate({**value, "url": url})


@pytest.mark.parametrize("invalid", ["../outside", "android/stable/../channel.json", "index.html", "android/not-an-apk"])
def test_snapshot_extras_and_traversal_refused(staging, tmp_path, invalid):
    files = files_for(staging)
    files[invalid] = b"decoy"
    archive, _pointer, value = snapshot(tmp_path, files)
    with pytest.raises(ValueError, match="unique regular"):
        p.validate_snapshot(p.Snapshot.model_validate(value), archive, tmp_path / "extract")


def test_incomplete_snapshot_and_mismatched_channel_heads_refuse(staging, tmp_path):
    files = files_for(staging)
    del files[next(name for name in files if name.endswith(".apk"))]
    archive, _pointer, value = snapshot(tmp_path, files)
    with pytest.raises(ValueError, match="omits referenced"):
        p.validate_snapshot(p.Snapshot.model_validate(value), archive, tmp_path / "incomplete")
    value["heads"]["stable"] = "0" * 64
    with pytest.raises(ValueError, match="heads mismatch"):
        p.validate_snapshot(p.Snapshot.model_validate(value), archive, tmp_path / "wrong-head")


def test_snapshot_links_refused(staging, tmp_path):
    archive, _pointer, value = snapshot(tmp_path, files_for(staging))
    with tarfile.open(archive, "w") as tar:
        member = tarfile.TarInfo("android/stable/channel.json")
        member.type = tarfile.SYMTYPE
        member.linkname = "../../decoy"
        tar.addfile(member)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    value.update(sha256=digest, bytes=archive.stat().st_size,
                 url=f"https://github.com/murtaza64/manadj/releases/download/android-snapshot-{digest}/android-snapshot-{digest}.tar")
    with pytest.raises(ValueError, match="unique regular"):
        p.validate_snapshot(p.Snapshot.model_validate(value), archive, tmp_path / "link")


def test_workflow_carries_snapshot_on_every_build_and_shares_serialization():
    workflow = (p.ROOT / ".github/workflows/explainer-site.yml").read_text()
    assert "uv run site/build.py --output" not in workflow
    assert "uv run -m scripts.release.android_pages_build --output .site-dist" in workflow
    assert "group: explainer-site-pages" in workflow and "cancel-in-progress: false" in workflow
    assert workflow.count('test "$GITHUB_SHA" = "$(gh api repos/murtaza64/manadj/commits/main --jq .sha)"') == 2


def test_deterministic_pack_keeps_orphan_artifact_then_exact_offered_bytes(staging, tmp_path):
    root, apk, feed, receipt, served, heads = staging
    staged = stage_tests.s.artifact(root, apk, feed, receipt)
    first, second = tmp_path / "first.tar", tmp_path / "second.tar"
    pin = p.pack(root, first)
    assert pin == p.pack(root, second)
    assert first.read_bytes() == second.read_bytes()
    assert pin["heads"] == {"stable": None, "preview": None}
    with pytest.raises(ValueError, match="overwrite"):
        p.pack(root, first)
    stage_tests.s.offer(root, feed, receipt, served, heads, 7)
    offered = p.pack(root, tmp_path / "offered.tar")
    assert offered["heads"]["stable"] == staged["staged_feed_sha256"]
    assert offered["heads"]["preview"] is None
    assert offered["sha256"] != pin["sha256"]


def test_two_local_promoters_have_one_winner_and_one_stale_head_refusal(staging):
    root, apk, feed, receipt, served, heads = staging
    stage_tests.s.artifact(root, apk, feed, receipt)
    start = Barrier(2)

    def promote():
        start.wait(timeout=5)
        try:
            return stage_tests.s.offer(root, feed, receipt, served, heads, 7)["state"]
        except ValueError as error:
            return str(error)

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda _: promote(), range(2)))
    assert outcomes.count("local-feed-staged") == 1
    assert sum("Stale channel history" in outcome for outcome in outcomes) == 1
