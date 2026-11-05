"""Producer wiring over real synthetic ZIP bytes; SDK seam is simulated, not APK QA."""
import copy
import hashlib
import json
import zipfile

import pytest

from backend.release_notes import identity
from scripts.release import android_producer as p
from scripts.release.android_channel_contract import CERT, PACKAGE, sha


@pytest.fixture
def pipeline(tmp_path, monkeypatch):
    source = "1" * 40
    body = "Synthetic producer test; not an offer.\r\n"
    info = identity("0.1.0-rc.8", source, body)
    notes = {"schema": 1, "release_id": info["release_id"], "body": body}
    build = {"format": "manadj_android_build/v1", "package": PACKAGE, "version_code": 8,
             "version_name": info["version"], "source_revision": source, "source_tree_sha256": "2" * 64,
             "build_batch_id": "33333333-3333-4333-8333-333333333333", "release_id": info["release_id"],
             "notes_sha256": info["notes_sha256"], "min_sdk": 26, "target_sdk": 35, "abis": ["arm64-v8a"]}
    unsigned = tmp_path / "unsigned.zip"
    signed = tmp_path / "signed.zip"
    for apk in (unsigned, signed):
        with zipfile.ZipFile(apk, "w") as z:
            for name, value in (("build-info", info), ("release-notes", notes), ("android-build", build)):
                z.writestr(p.ASSET_PREFIX + name + ".json", json.dumps(value))
            z.writestr("classes.dex", b"synthetic not executable")
            if apk == signed:
                z.writestr("META-INF/TEST.SF", b"simulated signature entry; not signed")
    digest = p.verifier.entries_digest(p.verifier.content_entries(p.verifier.zip_entries(unsigned)))
    u = {"schema": "manadj_android_release/v1", "stage": "unsigned", "release_identity": info,
         **{k: build[k] for k in ("package", "version_code", "version_name", "source_revision",
                                  "source_tree_sha256", "min_sdk", "target_sdk", "abis")},
         "apk_sha256": p.verifier.sha256_file(unsigned), "apk_bytes": unsigned.stat().st_size,
         "content_entries_sha256": digest}
    s = {**u, "stage": "signed", "apk_sha256": p.verifier.sha256_file(signed),
         "apk_bytes": signed.stat().st_size, "unsigned_apk_sha256": u["apk_sha256"], "signer_cert_sha256": CERT}
    calls = []

    def verify_unsigned(apk, rev):
        calls.append(("unsigned", apk, rev))
        assert apk == unsigned and rev == source
        return copy.deepcopy(u)

    def verify_signed(apk, receipt, *, expect_cert):
        calls.append(("signed", apk, expect_cert))
        assert apk == signed and receipt == u and expect_cert == CERT
        return copy.deepcopy(s)

    monkeypatch.setattr(p.verifier, "verify_unsigned", verify_unsigned)
    monkeypatch.setattr(p.verifier, "verify_signed", verify_signed)
    qa = []
    for scope in ("source", "unsigned", "signed"):
        path = tmp_path / f"{scope}-qa.json"
        value = {"id": scope, "scope": scope, "result": "pass",
                 **{k: build[k] for k in ("source_revision", "source_tree_sha256", "build_batch_id", "release_id")},
                 "artifact_sha256": {"source": None, "unsigned": u["apk_sha256"], "signed": s["apk_sha256"]}[scope]}
        path.write_text(json.dumps(value))
        qa.append(path)
    c, verified = p.candidate(unsigned, source, "stable", qa[:2])
    request = p.sign_request(c)
    receipt, signed_verified = p.accept_signed(c, request, unsigned, verified, signed)
    return {"c": c, "request": request, "receipt": receipt, "u": u, "s": s,
            "unsigned": unsigned, "signed": signed, "qa": qa, "calls": calls, "build": build,
            "info": info, "notes": notes, "signed_verified": signed_verified}


def eligible(f, **changes):
    args = dict(candidate_value=f["c"], request_value=f["request"], receipt_value=f["receipt"],
                unsigned_apk=f["unsigned"], unsigned_receipt=f["u"], signed_apk=f["signed"],
                qa_paths=f["qa"], histories={"stable": None, "preview": None}, floor_code=7)
    args.update(changes)
    return p.eligible(**args)


def test_full_local_producer_uses_verifier_and_actual_qa_bytes(pipeline):
    f = pipeline
    feed = eligible(f)
    entry = feed.entries[0]
    assert entry.apk_sha256 == f["s"]["apk_sha256"]
    assert entry.build_batch_id == f["build"]["build_batch_id"]
    assert entry.apk_url.endswith(f"/{entry.release_id}/{entry.apk_sha256}.apk")
    assert entry.qa_receipt_sha256s == sorted(hashlib.sha256(path.read_bytes()).hexdigest() for path in f["qa"])
    assert f["calls"][0][0] == "unsigned" and [c[0] for c in f["calls"]].count("signed") == 2
    assert f["request"].candidate_sha256 == sha(f["c"].model_dump())
    assert f["receipt"].verification_receipt_sha256 == sha(f["signed_verified"])
    assert not any(word in feed.model_dump() for word in ("published", "installed", "applied"))


@pytest.mark.parametrize("field,value", [("source_revision", "0" * 40), ("source_tree_sha256", "0" * 64),
    ("version_code", 9), ("version_name", "0.1.0-rc.9"), ("package", "dev.bad"),
    ("min_sdk", 27), ("target_sdk", 36), ("abis", ["x86"]), ("release_identity", None)])
def test_candidate_rejects_stale_source_or_archive(pipeline, field, value):
    f = pipeline
    f["u"][field] = value
    with pytest.raises(ValueError):
        p.candidate(f["unsigned"], f["build"]["source_revision"], "stable", f["qa"][:2])


def test_request_or_verification_receipt_from_another_candidate_refused(pipeline):
    f = pipeline
    request = {**f["request"].model_dump(), "candidate_sha256": "0" * 64}
    with pytest.raises(ValueError, match="another candidate"):
        eligible(f, request_value=request)
    with pytest.raises(ValueError, match="unsigned verifier receipt"):
        eligible(f, unsigned_receipt={**f["u"], "apk_bytes": 1})
    receipt = {**f["receipt"].model_dump(), "apk_sha256": "0" * 64}
    with pytest.raises(ValueError, match="no longer matches"):
        eligible(f, receipt_value=receipt)


def test_changed_unsigned_bytes_fail_before_signer_verification(pipeline):
    f = pipeline
    count = len(f["calls"])
    with f["unsigned"].open("ab") as out:
        out.write(b"changed")
    with pytest.raises(ValueError, match="Unsigned bytes changed"):
        eligible(f)
    assert len(f["calls"]) == count


def test_signed_verifier_failure_never_becomes_receipt(pipeline, monkeypatch):
    def refuse(*args, **kwargs):
        raise p.verifier.Refused("actual signer mismatch")
    monkeypatch.setattr(p.verifier, "verify_signed", refuse)
    with pytest.raises(p.verifier.Refused, match="signer mismatch"):
        eligible(pipeline)


@pytest.mark.parametrize("field,value", [("build_batch_id", "00000000-0000-4000-8000-000000000000"),
    ("artifact_sha256", "0" * 64), ("result", "fail"), ("receipt_sha256", "0" * 64)])
def test_signed_qa_must_be_actual_matching_pass_record(pipeline, field, value):
    path = pipeline["qa"][2]
    path.write_text(json.dumps({**p.read(path), field: value}))
    with pytest.raises(ValueError):
        eligible(pipeline)


def test_candidate_qa_cannot_be_replaced_or_missing(pipeline):
    f = pipeline
    with pytest.raises(ValueError, match="Signed-artifact QA"):
        eligible(f, qa_paths=f["qa"][:2])
    path = f["qa"][0]
    path.write_text(json.dumps(p.read(path), indent=2))
    with pytest.raises(ValueError, match="missing/changed"):
        eligible(f)


def test_no_rollback_reuse_or_implicit_missing_history(pipeline):
    f = pipeline
    first = eligible(f).model_dump()
    with pytest.raises(ValueError, match="rollback/reuse"):
        eligible(f, histories={"stable": first, "preview": None})
    first["channel"] = "preview"
    with pytest.raises(ValueError, match="rollback/reuse"):
        eligible(f, histories={"stable": None, "preview": first})
    for invalid in ({"stable": None}, {"stable": "offline", "preview": None}):
        with pytest.raises(ValueError):
            eligible(f, histories=invalid)
    for floor in (6, 8, True):
        with pytest.raises(ValueError):
            eligible(f, floor_code=floor)


def test_create_only_cli_output_preserves_existing_decoy(pipeline, tmp_path):
    path = tmp_path / "decoy.json"
    p.write(path, pipeline["request"])
    before = path.read_bytes()
    with pytest.raises(p.verifier.Refused):
        p.write(path, {"changed": True})
    assert path.read_bytes() == before


def test_stamp_preserves_exact_notes_and_pins_batch_before_build(pipeline, tmp_path, monkeypatch):
    f = pipeline
    monkeypatch.setattr(p.verifier, "full_commit", lambda rev: f["build"]["source_revision"])
    monkeypatch.setattr(p.verifier, "require_checkout", lambda rev: None)
    monkeypatch.setattr(p.verifier, "jj", lambda *args: "unused")
    monkeypatch.setattr(p.verifier, "gradle_fields", lambda text: {k: f["build"][k] for k in (
        "package", "version_code", "version_name", "min_sdk", "target_sdk")})
    monkeypatch.setattr(p.verifier, "source_manifest", lambda rev: ("pinned manifest\n", 1))
    notes = tmp_path / "notes.txt"
    notes.write_bytes(f["notes"]["body"].encode())
    out = tmp_path / "metadata"
    build = p.stamp("pin", notes, out, f["build"]["build_batch_id"], ["arm64-v8a"])
    assert p.read(out / "manadj-release/release-notes.json")["body"] == f["notes"]["body"]
    assert build.source_tree_sha256 == hashlib.sha256(b"pinned manifest\n").hexdigest()
    assert p.read(out / "manadj-release/build-info.json") == f["info"]
    with pytest.raises(FileExistsError):
        p.stamp("pin", notes, out, f["build"]["build_batch_id"], ["arm64-v8a"])
