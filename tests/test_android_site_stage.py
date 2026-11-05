"""Static staging/CAS tests with decoy bytes; no publication or APK qualification."""
import hashlib
import json

import pytest

from scripts.release import android_site_stage as s
from scripts.release.android_channel_contract import CERT, PACKAGE, sha
from backend.release_notes import identity


@pytest.fixture
def staging(tmp_path):
    root = tmp_path / "site-dist"
    root.mkdir()
    (root / "index.html").write_text("existing site")
    (root / "CNAME").write_text("manadj.murtaza.earth")
    apk = tmp_path / "decoy.apk"
    apk.write_bytes(b"static staging decoy, not an APK")
    digest = hashlib.sha256(apk.read_bytes()).hexdigest()
    info = identity("0.1.0-rc.8", "1" * 40, "synthetic staging test")
    build = {"format": "manadj_android_build/v1", "package": PACKAGE, "version_code": 8,
             "version_name": info["version"], "release_id": info["release_id"],
             "source_revision": "1" * 40, "source_tree_sha256": "2" * 64,
             "notes_sha256": info["notes_sha256"], "build_batch_id": "33333333-3333-4333-8333-333333333333",
             "min_sdk": 26, "target_sdk": 35, "abis": ["arm64-v8a"]}
    receipt = {"format": "manadj_android_sign_receipt/v1", "candidate_sha256": "4" * 64,
               "build": build, "unsigned_apk_sha256": "5" * 64, "apk_sha256": digest,
               "apk_bytes": apk.stat().st_size, "content_entries_sha256": "6" * 64,
               "signer_cert_sha256": CERT, "verification_receipt_sha256": "7" * 64}
    entry = {k: v for k, v in build.items() if k not in ("format", "package", "target_sdk")}
    entry.update(apk_sha256=digest, apk_bytes=apk.stat().st_size, qa_receipt_sha256s=["8" * 64, "9" * 64],
                 apk_url=f"https://manadj.murtaza.earth/android/artifacts/{info['release_id']}/{digest}.apk")
    feed = {"format": "manadj_android_channel/v1", "channel": "stable", "package": PACKAGE,
            "signer_cert_sha256": CERT, "entries": [entry]}
    heads = {"stable": None, "preview": None}
    served = {"format": "manadj_android_artifact_readback/v1", "url": entry["apk_url"],
              "apk_sha256": digest, "apk_bytes": apk.stat().st_size, "status": 200, "redirected": False,
              "sign_receipt_sha256": sha(receipt), "expected_heads": heads}
    return root, apk, feed, receipt, served, heads


def stage_offer(f):
    root, _apk, feed, receipt, served, heads = f
    return s.offer(root, feed, receipt, served, heads, 7)


def test_artifact_then_readback_then_feed_preserves_existing_site(staging):
    root, apk, feed, receipt, _served, _heads = staging
    result = s.artifact(root, apk, feed, receipt)
    assert result["state"] == "local-artifact-staged"
    assert not (root / "android/stable/channel.json").exists()
    assert s.artifact(root, apk, feed, receipt) == result
    staged = stage_offer(staging)
    assert staged["state"] == "local-feed-staged"
    assert json.loads((root / "android/stable/channel.json").read_bytes()) == feed
    assert (root / "index.html").read_text() == "existing site"
    assert (root / "CNAME").read_text() == "manadj.murtaza.earth"
    assert not (root / "android/preview/channel.json").exists()
    with pytest.raises(ValueError, match="Stale channel"):
        stage_offer(staging)


def test_feed_before_artifact_refused(staging):
    with pytest.raises(ValueError, match="Stage immutable artifact"):
        stage_offer(staging)


@pytest.mark.parametrize("key,value", [("status", 404), ("status", 200.0), ("redirected", True),
    ("url", "https://github.com/asset"), ("apk_sha256", "0" * 64), ("apk_bytes", True),
    ("sign_receipt_sha256", "0" * 64), ("expected_heads", {"stable": None})])
def test_offline_malformed_redirected_or_wrong_readback_never_offers(staging, key, value):
    root, apk, feed, receipt, served, _heads = staging
    s.artifact(root, apk, feed, receipt)
    served[key] = value
    with pytest.raises(ValueError):
        stage_offer(staging)
    assert not (root / "android/stable/channel.json").exists()


def test_immutable_collision_and_input_tamper_refused(staging):
    root, apk, feed, receipt, _served, _heads = staging
    apk.write_bytes(b"wrong input")
    with pytest.raises(ValueError, match="Artifact bytes"):
        s.artifact(root, apk, feed, receipt)
    entry = s.bind(feed, receipt)[2]
    path = s.artifact_path(root, entry)
    path.parent.mkdir(parents=True)
    path.write_bytes(b"immutable decoy collision")
    with pytest.raises(ValueError, match="Stage immutable artifact"):
        stage_offer(staging)
    assert path.read_bytes() == b"immutable decoy collision"


def test_both_heads_cas_and_cross_channel_rollback(staging):
    root, apk, feed, receipt, served, heads = staging
    s.artifact(root, apk, feed, receipt)
    preview = {**feed, "channel": "preview"}
    path = root / "android/preview/channel.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(preview))
    before = path.read_bytes()
    with pytest.raises(ValueError, match="Stale channel"):
        stage_offer(staging)
    heads["preview"] = hashlib.sha256(before).hexdigest()
    served["expected_heads"] = heads
    with pytest.raises(ValueError, match="rollback/reuse"):
        stage_offer(staging)
    assert path.read_bytes() == before
    assert not (root / "android/stable/channel.json").exists()


def test_feed_receipt_mismatch_refused(staging):
    root, apk, feed, receipt, _served, _heads = staging
    receipt["build"]["source_tree_sha256"] = "0" * 64
    with pytest.raises(ValueError, match="Feed/signed build"):
        s.artifact(root, apk, feed, receipt)


def test_symlinked_destination_refused_without_touching_outside_decoy(staging, tmp_path):
    root, apk, feed, receipt, _served, _heads = staging
    outside = tmp_path / "outside-decoy"
    outside.mkdir()
    (outside / "keep").write_text("untouched")
    (root / "android").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError, match="Symlink"):
        s.artifact(root, apk, feed, receipt)
    assert list(outside.iterdir()) == [outside / "keep"]


def test_history_cannot_be_truncated(staging):
    root, apk, feed, receipt, served, heads = staging
    s.artifact(root, apk, feed, receipt)
    previous_entry = {**feed["entries"][0], "version_code": 7}
    old = {**feed, "entries": [previous_entry]}
    path = root / "android/stable/channel.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(old))
    before = path.read_bytes()
    heads["stable"] = hashlib.sha256(before).hexdigest()
    served["expected_heads"] = heads
    with pytest.raises(ValueError, match="preserve complete"):
        stage_offer(staging)
    assert path.read_bytes() == before
    feed["entries"].insert(0, previous_entry)
    assert stage_offer(staging)["state"] == "local-feed-staged"
