"""Canonical public contract vectors, not actual APKs/offers or promotion authority."""
import json
import os
from pathlib import Path

import pytest

from backend.release_notes import identity
from scripts.release.android_channel_contract import (
    AndroidBuild, Candidate, Channel, Contract, Entry, PACKAGE, CERT, metadata,
)

ROOT = Path(__file__).parents[1]


def vector():
    # Synthetic public parser vector. No corresponding build/APK is claimed.
    source = "1" * 40
    build = identity("0.1.0-rc.8", source, "Update pipeline parser vector. Not an offered build.\n")
    android = {"format": "manadj_android_build/v1", "release_id": build["release_id"], "package": PACKAGE,
        "version_code": 8, "version_name": build["version"], "source_revision": source,
        "source_tree_sha256": "2" * 64, "build_batch_id": "33333333-3333-4333-8333-333333333333",
        "notes_sha256": build["notes_sha256"], "min_sdk": 26, "target_sdk": 35, "abis": ["arm64-v8a"]}
    apk = "4" * 64
    entry = {key: android[key] for key in ("release_id", "version_code", "version_name", "min_sdk", "abis",
        "source_revision", "source_tree_sha256", "build_batch_id", "notes_sha256")}
    entry.update(apk_url=f"https://manadj.murtaza.earth/android/artifacts/{build['release_id']}/{apk}.apk",
        apk_sha256=apk, apk_bytes=123456, qa_receipt_sha256s=["5" * 64, "6" * 64])
    return build, android, {"format": "manadj_android_channel/v1", "channel": "stable", "package": PACKAGE,
        "signer_cert_sha256": CERT, "entries": [entry]}


def test_canonical_source_files_and_native_vector():
    build, android, channel = vector()
    parsed = Channel.model_validate(channel)
    AndroidBuild.model_validate(android)
    metadata(build, {"schema": 1, "release_id": build["release_id"], "body": "Update pipeline parser vector. Not an offered build.\n"})
    if os.environ.get("MANADJ_WRITE_ANDROID_CONTRACT"):
        schema = Contract.model_json_schema()
        schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
        (ROOT / "scripts/release/android-update-v1.schema.json").write_text(json.dumps(schema, sort_keys=True, indent=2) + "\n")
        (ROOT / "tests/fixtures/android-channel-v1.sample.json").write_text(json.dumps(channel, sort_keys=True, indent=2) + "\n")
    assert json.loads((ROOT / "tests/fixtures/android-channel-v1.sample.json").read_text()) == parsed.model_dump()
    assert json.loads((ROOT / "scripts/release/android-update-v1.schema.json").read_text())["$defs"]["Channel"]["additionalProperties"] is False


@pytest.mark.parametrize("bad", ["https://github.com/murtaza64/manadj/releases/latest/download/app.apk",
    "http://manadj.murtaza.earth/android/a.apk", "https://manadj.murtaza.earth.evil/android/a.apk",
    "https://manadj.murtaza.earth/android/a.apk?x=1", "https://manadj.murtaza.earth:444/android/a.apk"])
def test_artifact_origin_path_and_redirect_topology_are_closed(bad):
    _build, _android, channel = vector()
    channel["entries"][0]["apk_url"] = bad
    with pytest.raises(ValueError):
        Channel.model_validate(channel)


def test_malformed_monotonic_package_cert_and_build_bindings_refuse():
    _build, _android, channel = vector()
    duplicate = {**channel, "entries": [channel["entries"][0], channel["entries"][0]]}
    for invalid in (duplicate, {**channel, "package": "dev.murt.manadj"}, {**channel, "signer_cert_sha256": "0" * 64}):
        with pytest.raises(ValueError):
            Channel.model_validate(invalid)
    entry = channel["entries"][0]
    with pytest.raises(ValueError):
        Entry.model_validate({**entry, "source_revision": "main"})
    with pytest.raises(ValueError):
        Entry.model_validate({**entry, "version_code": True})


def test_candidate_requires_matching_distinct_qa_source_and_unsigned():
    build, android, _channel = vector()
    unsigned = "7" * 64
    qa = [{"id": scope, "scope": scope, "result": "pass", "source_revision": android["source_revision"],
        "source_tree_sha256": android["source_tree_sha256"], "build_batch_id": android["build_batch_id"],
        "release_id": android["release_id"], "artifact_sha256": None if scope == "source" else unsigned,
        "receipt_sha256": ("5" if scope == "source" else "6") * 64} for scope in ("source", "unsigned")]
    candidate = {"format": "manadj_android_candidate/v1", "channel": "stable", "build": android,
        "build_info": build, "release_notes": {"schema": 1, "release_id": build["release_id"],
            "body": "Update pipeline parser vector. Not an offered build.\n"}, "unsigned_apk_sha256": unsigned,
        "unsigned_apk_bytes": 100, "content_entries_sha256": "8" * 64, "verification_receipt_sha256": "9" * 64,
        "qa_receipts": qa}
    Candidate.model_validate(candidate)
    for changed in ({**candidate, "qa_receipts": qa[:1]},
            {**candidate, "qa_receipts": [{**qa[0], "source_revision": "0" * 40}, qa[1]]}):
        with pytest.raises(ValueError):
            Candidate.model_validate(changed)


@pytest.mark.parametrize("value", [True, False, 1.0, "1", None])
@pytest.mark.parametrize("target", ["build", "notes"])
def test_schema_one_is_integer_not_python_equal_literal(value, target):
    build, _android, _channel = vector()
    notes = {"schema": 1, "release_id": build["release_id"],
             "body": "Update pipeline parser vector. Not an offered build.\n"}
    if target == "build":
        build["schema"] = value
    else:
        notes["schema"] = value
    with pytest.raises(ValueError, match="integer 1"):
        metadata(build, notes)
