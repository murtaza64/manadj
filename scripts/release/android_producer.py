"""Key-free #419 producer. Outputs are local evidence, never publication or apply receipts.

Run with ``uv run -m scripts.release.android_producer --help``. SDK verification is
delegated to the qualified android_release hooks. No network, signer or installer.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from pathlib import Path

from scripts.release import android_release as verifier
from scripts.release.android_channel_contract import (
    ASSET_PREFIX, CERT, FEED_ORIGIN, PACKAGE, AndroidBuild, Candidate, Channel,
    Entry, QAReceipt, SignReceipt, SignRequest, metadata, sha,
)
from backend.release_notes import identity


def require(ok, message):
    if not ok:
        raise ValueError(message)


def read(path):
    return json.loads(Path(path).read_bytes())


def dump(model):
    return model.model_dump() if hasattr(model, "model_dump") else model


def write(path, value):
    # Preserve exact Unicode notes, with exclusive creation even under races.
    path = Path(path)
    raw = json.dumps(dump(value), ensure_ascii=False, allow_nan=False, indent=2) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("x", encoding="utf-8", newline="\n") as output:
            output.write(raw)
    except FileExistsError:
        raise verifier.Refused(f"refusing to overwrite receipt {path}") from None
    path.chmod(0o444)


def stamp(revision, notes_file, out, batch_id, abis):
    """Exact notes bytes, pinned source tree and caller-selected batch BEFORE build."""
    commit = verifier.full_commit(revision)
    verifier.require_checkout(commit)
    source = verifier.gradle_fields(verifier.jj("file", "show", "-r", commit, verifier.GRADLE))
    tree, _ = verifier.source_manifest(commit)
    body = Path(notes_file).read_bytes().decode("utf-8")
    info = identity(source["version_name"], commit, body)
    notes = {"schema": 1, "release_id": info["release_id"], "body": body}
    metadata(info, notes)
    build = AndroidBuild.model_validate({
        "format": "manadj_android_build/v1", **source, "abis": sorted(abis),
        "release_id": info["release_id"], "source_revision": commit,
        "source_tree_sha256": hashlib.sha256(tree.encode()).hexdigest(),
        "build_batch_id": batch_id, "notes_sha256": info["notes_sha256"],
    })
    target = Path(out) / "manadj-release"
    # An exclusive directory owns the entire triple. A failed partial stamp is
    # deliberately not reusable: start with a fresh output directory.
    target.mkdir(parents=True, exist_ok=False)
    for name, value in (("build-info.json", info), ("release-notes.json", notes),
                        ("android-build.json", build)):
        write(target / name, value)
    return build


def embedded(apk):
    # Also rejects duplicate names anywhere in the archive.
    verifier.zip_entries(Path(apk))
    with zipfile.ZipFile(apk) as archive:
        values = []
        for name in ("build-info.json", "release-notes.json", "android-build.json"):
            member = ASSET_PREFIX + name
            # Worst-case JSON escapes are six bytes per UTF-8 body byte.
            # A valid 32768-byte body plus object framing fits within 256 KiB.
            require(archive.getinfo(member).file_size <= 256 * 1024, "Embedded metadata too large")
            values.append(json.loads(archive.read(member)))
    info, notes = metadata(values[0], values[1])
    build = AndroidBuild.model_validate(values[2])
    for key, expected in (("release_id", info.release_id), ("version_name", info.version),
                          ("source_revision", info.source_revision), ("notes_sha256", info.notes_sha256)):
        require(getattr(build, key) == expected, "Embedded Android/schema1 identity mismatch")
    return info, notes, build


def qa_files(paths):
    """Read trusted-local QA records; digest the ACTUAL bytes, not a supplied hash.

    A record has QAReceipt fields except receipt_sha256. No recursive self-hash.
    This checks provenance binding, not the truth of an arbitrary test assertion;
    protected promotion must select trusted runner receipts, never network input.
    """
    receipts = []
    for path in paths:
        raw = Path(path).read_bytes()
        require(len(raw) <= 65536, "QA record too large")
        value = json.loads(raw)
        require("receipt_sha256" not in value, "QA source record cannot supply its own digest")
        receipts.append(QAReceipt.model_validate({**value, "receipt_sha256": hashlib.sha256(raw).hexdigest()}))
    require(len({r.id for r in receipts}) == len(receipts), "Duplicate QA IDs")
    return receipts


def bind_verification(receipt, build, info, stage):
    require(receipt.get("schema") == "manadj_android_release/v1" and receipt.get("stage") == stage,
            "Verifier schema/stage mismatch")
    for key in ("package", "version_code", "version_name", "source_revision", "source_tree_sha256",
                "min_sdk", "target_sdk"):
        require(receipt.get(key) == getattr(build, key), f"Verifier/build mismatch: {key}")
    require(sorted(receipt["abis"]) == build.abis, "Verifier ABI mismatch")
    require(receipt["release_identity"] == dump(info), "Verifier schema1 identity mismatch")


def candidate(apk, revision, channel, qa_paths):
    info, notes, build = embedded(apk)
    # Mandatory checkout pin + SDK/source/archive checks; no legacy bypass flags.
    verified = verifier.verify_unsigned(Path(apk), revision)
    bind_verification(verified, build, info, "unsigned")
    receipts = qa_files(qa_paths)
    require(all(r.scope in ("source", "unsigned") for r in receipts), "Candidate cannot claim signed QA")
    result = Candidate.model_validate({
        "format": "manadj_android_candidate/v1", "channel": channel,
        "build": dump(build), "build_info": dump(info), "release_notes": dump(notes),
        "unsigned_apk_sha256": verified["apk_sha256"], "unsigned_apk_bytes": verified["apk_bytes"],
        "content_entries_sha256": verified["content_entries_sha256"],
        "verification_receipt_sha256": sha(verified), "qa_receipts": [dump(r) for r in receipts],
    })
    return result, verified


def sign_request(candidate_value):
    c = Candidate.model_validate(dump(candidate_value))
    return SignRequest.model_validate({
        "format": "manadj_android_sign_request/v1", "candidate_sha256": sha(dump(c)),
        "build": dump(c.build), "unsigned_apk_sha256": c.unsigned_apk_sha256,
        "unsigned_apk_bytes": c.unsigned_apk_bytes, "content_entries_sha256": c.content_entries_sha256,
        "expected_signer_cert_sha256": CERT,
    })


def check_candidate_bytes(c, unsigned_apk, unsigned_receipt):
    require(sha(unsigned_receipt) == c.verification_receipt_sha256, "Wrong unsigned verifier receipt")
    bind_verification(unsigned_receipt, c.build, c.build_info, "unsigned")
    require(verifier.sha256_file(Path(unsigned_apk)) == c.unsigned_apk_sha256
            and Path(unsigned_apk).stat().st_size == c.unsigned_apk_bytes, "Unsigned bytes changed")
    info, notes, build = embedded(unsigned_apk)
    require((info, notes, build) == (c.build_info, c.release_notes, c.build), "Unsigned embedded triple changed")
    digest = verifier.entries_digest(verifier.content_entries(verifier.zip_entries(Path(unsigned_apk))))
    require(digest == c.content_entries_sha256 == unsigned_receipt["content_entries_sha256"],
            "Unsigned content digest mismatch")
    require(unsigned_receipt["apk_sha256"] == c.unsigned_apk_sha256
            and unsigned_receipt["apk_bytes"] == c.unsigned_apk_bytes, "Unsigned receipt bytes mismatch")


def accept_signed(candidate_value, request_value, unsigned_apk, unsigned_receipt, signed_apk):
    c = Candidate.model_validate(dump(candidate_value))
    request = SignRequest.model_validate(dump(request_value))
    require(request == sign_request(c), "Signing request belongs to another candidate")
    check_candidate_bytes(c, unsigned_apk, unsigned_receipt)
    # Never accept a JSON 'signed' assertion instead of actual SDK verification.
    verified = verifier.verify_signed(Path(signed_apk), unsigned_receipt, expect_cert=CERT)
    bind_verification(verified, c.build, c.build_info, "signed")
    require(embedded(signed_apk) == (c.build_info, c.release_notes, c.build), "Signing changed embedded triple")
    require(verified["unsigned_apk_sha256"] == c.unsigned_apk_sha256
            and verified["content_entries_sha256"] == c.content_entries_sha256,
            "Signing changed content/input")
    result = SignReceipt.model_validate({
        "format": "manadj_android_sign_receipt/v1", "candidate_sha256": sha(dump(c)),
        "build": dump(c.build), "unsigned_apk_sha256": c.unsigned_apk_sha256,
        "apk_sha256": verified["apk_sha256"], "apk_bytes": verified["apk_bytes"],
        "content_entries_sha256": verified["content_entries_sha256"],
        "signer_cert_sha256": verified["signer_cert_sha256"], "verification_receipt_sha256": sha(verified),
    })
    return result, verified


def eligible(candidate_value, request_value, receipt_value, unsigned_apk, unsigned_receipt,
             signed_apk, qa_paths, histories, floor_code):
    """Produce local eligible feed only; histories contain BOTH explicit channel snapshots.

    Null explicitly means no existing feed for that channel. floor_code is the
    trusted package-wide reservation/legacy floor, at least the known code7.
    Network readback, stale-head CAS and publication belong to protected promotion.
    """
    c = Candidate.model_validate(dump(candidate_value))
    accepted, verified = accept_signed(c, request_value, unsigned_apk, unsigned_receipt, signed_apk)
    require(accepted == SignReceipt.model_validate(dump(receipt_value)), "Signed receipt no longer matches bytes")
    receipts = qa_files(qa_paths)
    require({r.receipt_sha256 for r in c.qa_receipts} <= {r.receipt_sha256 for r in receipts},
            "Original candidate QA files missing/changed")
    signed_qa = [r for r in receipts if r.scope == "signed"]
    require(bool(signed_qa), "Signed-artifact QA required")
    for r in receipts:
        require((r.source_revision, r.source_tree_sha256, r.build_batch_id, r.release_id) == (
            c.build.source_revision, c.build.source_tree_sha256, c.build.build_batch_id, c.build.release_id),
            "QA source/tree/batch/release mismatch")
        expected = {"source": None, "unsigned": c.unsigned_apk_sha256, "signed": accepted.apk_sha256}[r.scope]
        require(r.artifact_sha256 == expected, "QA artifact mismatch")
    require(set(histories) == {"stable", "preview"}, "Both channel histories must be explicit")
    require(type(floor_code) is int and floor_code >= 7, "Trusted package-wide floor must include legacy code7")
    old = {}
    maximum = floor_code
    for name, value in histories.items():
        if value is None:
            old[name] = []
            continue
        previous = Channel.model_validate(value)
        require(previous.channel == name, "History channel mismatch")
        old[name] = previous.entries
        maximum = max(maximum, *(e.version_code for e in previous.entries))
    require(c.build.version_code > maximum, "VersionCode rollback/reuse refused across both channels")
    b = dump(c.build)
    fields = {k: b[k] for k in ("release_id", "version_code", "version_name", "min_sdk", "abis",
                                "source_revision", "source_tree_sha256", "build_batch_id", "notes_sha256")}
    entry = Entry.model_validate({
        **fields, "apk_url": f"{FEED_ORIGIN}/android/artifacts/{c.build.release_id}/{accepted.apk_sha256}.apk",
        "apk_sha256": accepted.apk_sha256, "apk_bytes": accepted.apk_bytes,
        "qa_receipt_sha256s": sorted(r.receipt_sha256 for r in receipts),
    })
    channel = Channel.model_validate({
        "format": "manadj_android_channel/v1", "channel": c.channel, "package": PACKAGE,
        "signer_cert_sha256": CERT, "entries": [dump(e) for e in old[c.channel]] + [dump(entry)],
    })
    return channel


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    s = commands.add_parser("stamp")
    for flag in ("rev", "notes-file", "out", "batch-id"):
        s.add_argument("--" + flag, required=True)
    s.add_argument("--abi", action="append", required=True)
    c = commands.add_parser("candidate")
    for flag in ("apk", "rev", "channel", "out", "verification-out"):
        c.add_argument("--" + flag, required=True)
    c.add_argument("--qa", action="append", required=True)
    r = commands.add_parser("request")
    r.add_argument("--candidate", required=True)
    r.add_argument("--out", required=True)
    for name in ("accept-signed", "eligible"):
        p = commands.add_parser(name)
        for flag in ("candidate", "request", "unsigned-apk", "unsigned-receipt", "signed-apk", "out"):
            p.add_argument("--" + flag, required=True)
        if name == "accept-signed":
            p.add_argument("--verification-out", required=True)
        else:
            p.add_argument("--sign-receipt", required=True)
            p.add_argument("--histories", required=True)
            p.add_argument("--floor-code", type=int, required=True)
            p.add_argument("--qa", action="append", required=True)
    a = parser.parse_args()
    if a.command == "stamp":
        stamp(a.rev, a.notes_file, a.out, a.batch_id, a.abi)
    elif a.command == "candidate":
        result, verified = candidate(a.apk, a.rev, a.channel, a.qa)
        write(a.verification_out, verified)
        write(a.out, result)
    elif a.command == "request":
        write(a.out, sign_request(read(a.candidate)))
    else:
        args = (read(a.candidate), read(a.request))
        if a.command == "accept-signed":
            result, verified = accept_signed(*args, a.unsigned_apk, read(a.unsigned_receipt), a.signed_apk)
            write(a.verification_out, verified)
            write(a.out, result)
        else:
            result = eligible(*args, read(a.sign_receipt), a.unsigned_apk, read(a.unsigned_receipt),
                              a.signed_apk, a.qa, read(a.histories), a.floor_code)
            write(a.out, result)


if __name__ == "__main__":
    main()
