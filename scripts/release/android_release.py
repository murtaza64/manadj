#!/usr/bin/env -S uv run
"""Android release build/verification hooks (#419, #481). See docs/android-release.md.

Stages (each writes an immutable JSON receipt; none builds, signs, installs or publishes):

  stamp            cut the embedded triple for a pinned commit into <out>/manadj-release/:
                   build-info.json + release-notes.json (core #420 schema 1) and android-build.json
                   (manadj_android_build/v1); pass the printed -P flag to gradle so the APK
                   carries them as assets/manadj-release/*.
  verify-unsigned  unsigned release APK vs pinned source: package/version/sdk from gradle at
                   the pin, not debuggable, no signature, 16 KiB aligned, embedded identity.
  verify-signed    signed APK vs its unsigned receipt: expected signer certificate, v2/v3,
                   identical non-signature entries, same package/version.
  channel-entry    one manadj_android_channel/v1 entry (canonical Entry) from a signed, stamped
                   receipt + QA receipt hashes; APK URL is the pinned immutable Pages path.

Offered / installed / applied are distinct: this tool only produces offered entries. Installed
(PackageManager package + versionCode + signer) and applied (running process reads its embedded
build-info release_id) are reported by the app (#419), never inferred here.

Usage:
  uv run scripts/release/android_release.py stamp --rev <commit> --notes-file notes.txt --out DIR
  uv run scripts/release/android_release.py verify-unsigned APK --rev <commit> --out receipt.json
  uv run scripts/release/android_release.py verify-signed APK --unsigned-receipt R --out S
  uv run scripts/release/android_release.py channel-entry --signed-receipt S --qa-receipt-sha256 H [H ...]

Types: scripts/release/android_channel_contract.py (core). Identity: backend.release_notes.identity (#420).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import uuid
import zipfile
from pathlib import Path

from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT), str(ROOT / "scripts" / "release")]
import android_channel_contract as contract  # noqa: E402
from backend.release_notes import identity  # noqa: E402

GRADLE = "android/app/build.gradle.kts"
ASSET_DIR = "manadj-release"
ASSET_FILES = ("build-info.json", "release-notes.json", "android-build.json")
EXPECTED_PACKAGE = contract.PACKAGE
EXCALIBUR_CERT = contract.CERT
DEFAULT_ABIS = ("arm64-v8a", "armeabi-v7a", "x86", "x86_64")
MAX_ASSET_BYTES = 65536  # per embedded file; written as UTF-8 (no \\u expansion) so 32 KiB notes fit
MAX_NOTES_BYTES = 32768
HEX40 = re.compile(r"[0-9a-f]{40}")
HEX64 = re.compile(r"[0-9a-f]{64}")
SIGNATURE_ENTRY = re.compile(r"^META-INF/(MANIFEST\.MF|[^/]+\.(SF|RSA|DSA|EC)|SIG-[^/]+)$", re.I)


class Refused(Exception):
    """A verification failed; message names the check."""


def check(ok: bool, message: str) -> None:
    if not ok:
        raise Refused(message)


# --- shared identity: #420 identity() + core canonical types; no parallel formula ---

def contract_check(model, value, what: str):
    try:
        return model.model_validate(value)
    except ValidationError as error:
        raise Refused(f"{what} violates the canonical contract: {error.errors()[0]['msg']}") from None


def release_identity(version: str, source_revision: str, body: str) -> dict:
    check(bool(HEX40.fullmatch(source_revision)), "source_revision must be a full 40-hex commit")
    check(version.isascii() and bool(version.strip()), "version must be nonblank ASCII")
    check(bool(body.strip()) and len(body.encode("utf-8")) <= MAX_NOTES_BYTES, "notes body must be nonblank and <= 32768 bytes")
    return identity(version, source_revision, body)


def validate_metadata(build: dict, notes: dict) -> None:
    for name, doc in (("build-info.json", build), ("release-notes.json", notes)):
        check(isinstance(doc, dict) and type(doc.get("schema")) is int, f"{name} schema must be the integer 1 (not bool/float)")
    try:
        contract.metadata(build, notes)
    except (ValidationError, ValueError) as error:
        raise Refused(f"build-info/release-notes pair invalid: {str(error).splitlines()[0]}") from None


def android_build(build: dict, fields: dict, tree_sha256: str, batch_id: str, abis: list[str]) -> dict:
    record = {"format": "manadj_android_build/v1", "release_id": build["release_id"], "package": fields["package"],
              "version_code": fields["version_code"], "version_name": fields["version_name"],
              "source_revision": build["source_revision"], "source_tree_sha256": tree_sha256,
              "build_batch_id": batch_id, "notes_sha256": build["notes_sha256"],
              "min_sdk": fields["min_sdk"], "target_sdk": fields["target_sdk"], "abis": sorted(abis)}
    contract_check(contract.AndroidBuild, record, "android-build.json")
    return record


def validate_triple(build: dict, notes: dict, android: dict) -> None:
    validate_metadata(build, notes)
    contract_check(contract.AndroidBuild, android, "android-build.json")
    for key, expected in (("release_id", build["release_id"]), ("source_revision", build["source_revision"]),
                          ("notes_sha256", build["notes_sha256"]), ("version_name", build["version"])):
        check(android[key] == expected, f"android-build.json {key} disagrees with build-info.json")


# --- source ---

def jj(*args: str) -> str:
    return subprocess.run(["jj", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout


def full_commit(rev: str) -> str:
    commit = jj("log", "--no-graph", "-r", rev, "-T", "commit_id").strip()
    check(bool(HEX40.fullmatch(commit)), f"{rev!r} does not resolve to one commit")
    return commit


def gradle_fields(text: str) -> dict:
    def one(key: str, pattern: str) -> str:
        found = re.findall(rf"^\s*{key}\s*=\s*{pattern}\s*$", text, re.M)
        check(len(found) == 1, f"{GRADLE}: expected exactly one {key}")
        return found[0]
    return {"package": one("applicationId", r'"([^"]+)"'),
            "version_code": int(one("versionCode", r"(\d+)")),
            "version_name": one("versionName", r'"([^"]+)"'),
            "min_sdk": int(one("minSdk", r"(\d+)")),
            "target_sdk": int(one("targetSdk", r"(\d+)"))}


def source_manifest(commit: str) -> tuple[str, int]:
    """'<sha256>  <bytes>  <path>' per tracked file (sorted); returns (text, file count)."""
    lines = []
    for path in sorted(jj("file", "list", "-r", commit).splitlines()):
        data = subprocess.run(["jj", "file", "show", "-r", commit, "--", f'root-file:"{path}"'],
                              cwd=ROOT, check=True, capture_output=True).stdout
        lines.append(f"{hashlib.sha256(data).hexdigest()}  {len(data)}  {path}")
    return "\n".join(lines) + "\n", len(lines)


def require_checkout(commit: str) -> None:
    """The build tree must be exactly the pin (APK outputs come from the working copy)."""
    check(not jj("diff", "--from", commit, "--to", "@", "--summary").strip(),
          f"working copy differs from pinned {commit[:12]}; `jj new {commit[:12]}` first")


# --- APK inspection ---

def sdk_tools() -> dict:
    home = Path(os.environ.get("ANDROID_HOME", "/tmp/opencode/manadj-android-sdk"))
    versions = sorted((home / "build-tools").glob("*"), key=lambda p: [int(x) for x in re.findall(r"\d+", p.name)])
    check(bool(versions), f"no build-tools under {home}")
    bt = versions[-1]
    tools = {name: str(bt / name) for name in ("aapt", "apksigner", "zipalign")}
    for path in tools.values():
        check(os.access(path, os.X_OK), f"missing SDK tool {path}")
    return {**tools, "build_tools_version": bt.name}


def run(cmd: list[str]) -> tuple[int, str]:
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr)


def parse_badging(text: str) -> dict:
    pkg = re.search(r"^package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'", text, re.M)
    check(pkg is not None, "aapt badging: no package line")
    sdk = re.search(r"^sdkVersion:'(\d+)'", text, re.M)
    target = re.search(r"^targetSdkVersion:'(\d+)'", text, re.M)
    native = re.search(r"^native-code: (.*)$", text, re.M)
    label = re.search(r"^application-label:'([^']*)'", text, re.M)
    return {"package": pkg[1], "version_code": int(pkg[2]), "version_name": pkg[3],
            "min_sdk": int(sdk[1]) if sdk else None, "target_sdk": int(target[1]) if target else None,
            "abis": re.findall(r"'([^']+)'", native[1]) if native else [],
            "label": label[1] if label else None,
            "debuggable": bool(re.search(r"^application-debuggable", text, re.M))}


def parse_print_certs(text: str) -> dict:
    schemes = {m[1]: m[2] == "true" for m in re.finditer(r"^Verified using (v[\d.]+) scheme[^:]*: (true|false)$", text, re.M)}
    return {"verifies": bool(re.search(r"^Verifies$", text, re.M)),
            "schemes": schemes,
            "signers": int(m[1]) if (m := re.search(r"^Number of signers: (\d+)$", text, re.M)) else 0,
            "certs": re.findall(r"^Signer #\d+ certificate SHA-256 digest: ([0-9a-f]{64})$", text, re.M)}


def zip_entries(apk: Path) -> dict[str, str]:
    """Entry name -> SHA-256 of its decompressed payload. Duplicate names are refused (zip readers disagree on them)."""
    entries: dict[str, str] = {}
    with zipfile.ZipFile(apk) as z:
        for info in z.infolist():
            check(info.filename not in entries, f"duplicate ZIP entry {info.filename!r}")
            digest = hashlib.sha256()
            with z.open(info) as f:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    digest.update(chunk)
            entries[info.filename] = digest.hexdigest()
    return entries


def content_entries(entries: dict[str, str]) -> dict[str, str]:
    return {k: v for k, v in entries.items() if not SIGNATURE_ENTRY.match(k)}


def entries_digest(entries: dict[str, str]) -> str:
    """SHA-256 over sorted '<name>\\0<payload sha256>\\n' lines."""
    return hashlib.sha256("".join(f"{k}\0{v}\n" for k, v in sorted(entries.items())).encode()).hexdigest()


def embedded_metadata(apk: Path) -> tuple[dict, dict, dict] | None:
    """(build-info, release-notes, android-build) from assets/manadj-release/; None = unstamped. Partial = refused."""
    with zipfile.ZipFile(apk) as z:
        names = set(z.namelist())
        paths = [f"assets/{ASSET_DIR}/{name}" for name in ASSET_FILES]
        present = [p in names for p in paths]
        if not any(present):
            return None
        check(all(present), f"APK carries a partial release identity: {[p for p, ok in zip(paths, present) if ok]}")
        for p in paths:
            check(z.getinfo(p).file_size <= MAX_ASSET_BYTES, f"{p} exceeds {MAX_ASSET_BYTES} bytes")
        build, notes, android = (json.loads(z.read(p).decode("utf-8")) for p in paths)
        return build, notes, android


def sha256_file(path: Path) -> str:
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def write_receipt(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("x") as f:  # create-only: never replaces a receipt, even under a race
            f.write(json.dumps(data, indent=2) + "\n")
    except FileExistsError:
        raise Refused(f"refusing to overwrite receipt {path}") from None
    path.chmod(0o444)


# --- stages ---

def stamp(rev: str, notes_file: Path, out: Path, *, batch_id: str | None = None,
          abis: list[str] | tuple[str, ...] = DEFAULT_ABIS, require_checkout_match: bool = True) -> dict:
    """The one triple stamper (core producer delegates here). Notes are the file's exact UTF-8 bytes."""
    commit = full_commit(rev)
    if require_checkout_match:
        require_checkout(commit)
    fields = gradle_fields(jj("file", "show", "-r", commit, GRADLE))
    body = notes_file.read_bytes().decode("utf-8")
    build = release_identity(fields["version_name"], commit, body)
    notes = {"schema": 1, "release_id": build["release_id"], "body": body}
    manifest_text, _ = source_manifest(commit)
    android = android_build(build, fields, hashlib.sha256(manifest_text.encode()).hexdigest(),
                            batch_id or str(uuid.uuid4()), list(abis))
    validate_triple(build, notes, android)
    target = out / ASSET_DIR
    check(not target.exists(), f"refusing to overwrite {target}")
    target.mkdir(parents=True)
    encoded = [(json.dumps(v, ensure_ascii=False) + "\n").encode("utf-8") for v in (build, notes, android)]
    for name, data in zip(ASSET_FILES, encoded):
        check(len(data) <= MAX_ASSET_BYTES, f"{name} would exceed {MAX_ASSET_BYTES} bytes")
    for name, data in zip(ASSET_FILES, encoded):
        (target / name).write_bytes(data)
    return {"build_info": build, "android_build": android, "gradle_flag": f"-Pmanadj.releaseMetadataDir={out.resolve()}"}


def verify_unsigned(apk: Path, rev: str, *, expect_package: str = EXPECTED_PACKAGE,
                    require_metadata: bool = True, require_checkout_match: bool = True) -> dict:
    commit = full_commit(rev)
    if require_checkout_match:
        require_checkout(commit)
    tools = sdk_tools()
    source = gradle_fields(jj("file", "show", "-r", commit, GRADLE))
    code, badging_text = run([tools["aapt"], "dump", "badging", str(apk)])
    check(code == 0, f"aapt badging failed: {badging_text[-300:]}")
    badging = parse_badging(badging_text)
    check(badging["package"] == expect_package, f"package {badging['package']} != {expect_package}")
    check(source["package"] == expect_package, f"source applicationId {source['package']} != {expect_package}")
    for key in ("version_code", "version_name", "min_sdk", "target_sdk"):
        check(badging[key] == source[key], f"{key}: APK {badging[key]} != source {source[key]}")
    check(not badging["debuggable"], "APK is debuggable")
    check(bool(badging["abis"]), "APK has no native ABIs")
    entries = zip_entries(apk)
    sig_files = sorted(k for k in entries if SIGNATURE_ENTRY.match(k))
    check(not sig_files, f"APK already carries signature files {sig_files}")
    sign_code, sign_out = run([tools["apksigner"], "verify", "--verbose", str(apk)])
    check(sign_code != 0, "apksigner verifies an APK that must be unsigned")
    align_code, align_out = run([tools["zipalign"], "-c", "-P", "16", "-v", "4", str(apk)])
    check(align_code == 0, "zipalign -c -P 16 -v 4 failed")
    manifest_text, files = source_manifest(commit)
    tree = hashlib.sha256(manifest_text.encode()).hexdigest()
    embedded = embedded_metadata(apk)
    if embedded is None:
        check(not require_metadata, f"APK lacks assets/{ASSET_DIR}/ release identity (stamp + -Pmanadj.releaseMetadataDir)")
        release, android = None, None
    else:
        release, notes, android = embedded
        validate_triple(release, notes, android)
        check(release["source_revision"] == commit, f"embedded source_revision {release['source_revision'][:12]} != pin {commit[:12]}")
        check(android["source_tree_sha256"] == tree, "embedded source_tree_sha256 != pinned source tree")
        for key in ("package", "version_code", "version_name", "min_sdk", "target_sdk"):
            check(android[key] == badging[key], f"embedded {key} {android[key]} != APK {badging[key]}")
        check(android["abis"] == sorted(badging["abis"]), f"embedded ABIs {android['abis']} != APK {sorted(badging['abis'])}")
    return {
        "schema": "manadj_android_release/v1", "stage": "unsigned",
        "apk_path": str(apk.resolve()), "apk_sha256": sha256_file(apk), "apk_bytes": apk.stat().st_size,
        "content_entries_sha256": entries_digest(content_entries(entries)),
        "source_revision": commit, "source_tree_sha256": tree,
        "source_files": files,
        **{k: badging[k] for k in ("package", "label", "version_code", "version_name", "min_sdk", "target_sdk", "abis")},
        "debuggable": False,
        "release_identity": release, "android_build": android,
        "checks": {"unsigned": f"apksigner verify exit {sign_code}: {sign_out.strip().splitlines()[-1] if sign_out.strip() else ''}",
                   "alignment": "zipalign -c -P 16 -v 4 exit 0", "signature_entries": []},
        "sdk_tools": tools,
    }


def verify_signed(apk: Path, unsigned: dict, *, expect_cert: str = EXCALIBUR_CERT) -> dict:
    check(unsigned.get("schema") == "manadj_android_release/v1" and unsigned.get("stage") == "unsigned",
          "unsigned receipt has the wrong schema/stage")
    tools = sdk_tools()
    code, text = run([tools["apksigner"], "verify", "--print-certs", "--verbose",
                      "--min-sdk-version", str(unsigned["min_sdk"]), str(apk)])
    certs = parse_print_certs(text)
    check(code == 0 and certs["verifies"], "apksigner does not verify the signed APK")
    check(certs["signers"] == 1 and certs["certs"] == [expect_cert], f"signer certs {certs['certs']} != [{expect_cert}]")
    check(certs["schemes"].get("v2") is True or certs["schemes"].get("v3") is True, "neither v2 nor v3 signature verified")
    code, badging_text = run([tools["aapt"], "dump", "badging", str(apk)])
    check(code == 0, "aapt badging failed")
    badging = parse_badging(badging_text)
    for key in ("package", "version_code", "version_name", "min_sdk", "target_sdk", "abis"):
        check(badging[key] == unsigned[key], f"{key}: signed {badging[key]} != unsigned {unsigned[key]}")
    check(not badging["debuggable"], "signed APK is debuggable")
    digest = entries_digest(content_entries(zip_entries(apk)))
    check(digest == unsigned["content_entries_sha256"], "signed APK content entries differ from the unsigned input")
    align_code, _ = run([tools["zipalign"], "-c", "-P", "16", "-v", "4", str(apk)])
    check(align_code == 0, "signed APK fails zipalign -c -P 16 -v 4")
    embedded = embedded_metadata(apk)
    check((embedded[0] if embedded else None) == unsigned["release_identity"]
          and (embedded[2] if embedded else None) == unsigned.get("android_build"), "embedded identity changed by signing")
    return {
        "schema": "manadj_android_release/v1", "stage": "signed",
        "apk_path": str(apk.resolve()), "apk_sha256": sha256_file(apk), "apk_bytes": apk.stat().st_size,
        "unsigned_apk_sha256": unsigned["apk_sha256"], "content_entries_sha256": digest,
        "signer_cert_sha256": expect_cert,
        "schemes": {k: v for k, v in certs["schemes"].items() if v},
        **{k: unsigned[k] for k in ("source_revision", "source_tree_sha256", "package", "label", "version_code",
                                    "version_name", "min_sdk", "target_sdk", "abis", "release_identity", "android_build")},
        "sdk_tools": tools,
    }


def channel_entry(signed: dict, qa_receipt_sha256s: list[str]) -> dict:
    """Canonical contract.Entry; the APK URL is derived, never supplied: same Pages origin, immutable path."""
    check(signed.get("stage") == "signed", "channel entries come from a signed receipt")
    release, android = signed.get("release_identity"), signed.get("android_build")
    check(release is not None and android is not None,
          "unstamped APK cannot be offered: the app could never verify it as applied")
    check(signed["package"] == EXPECTED_PACKAGE and signed["signer_cert_sha256"] == EXCALIBUR_CERT,
          "channel offers only the pinned package/signer")
    entry = {"release_id": release["release_id"], "version_code": signed["version_code"],
             "version_name": signed["version_name"], "min_sdk": signed["min_sdk"], "abis": android["abis"],
             "source_revision": signed["source_revision"], "source_tree_sha256": android["source_tree_sha256"],
             "build_batch_id": android["build_batch_id"], "notes_sha256": release["notes_sha256"],
             "apk_url": f"{contract.FEED_ORIGIN}/android/artifacts/{release['release_id']}/{signed['apk_sha256']}.apk",
             "apk_sha256": signed["apk_sha256"], "apk_bytes": signed["apk_bytes"],
             "qa_receipt_sha256s": sorted(set(qa_receipt_sha256s))}
    contract_check(contract.Entry, entry, "channel entry")
    return entry


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("stamp"); s.add_argument("--rev", required=True); s.add_argument("--notes-file", type=Path, required=True); s.add_argument("--out", type=Path, required=True)
    s.add_argument("--build-batch-id", help="UUID; default: fresh uuid4"); s.add_argument("--abis", nargs="+", default=list(DEFAULT_ABIS))
    s.add_argument("--skip-checkout-check", action="store_true", help="stamp a pin other than the working copy (no build follows)")
    u = sub.add_parser("verify-unsigned"); u.add_argument("apk", type=Path); u.add_argument("--rev", required=True); u.add_argument("--out", type=Path, required=True)
    u.add_argument("--expect-package", default=EXPECTED_PACKAGE)
    u.add_argument("--allow-unstamped", action="store_true", help="legacy APK without embedded identity (reported as null)")
    u.add_argument("--skip-checkout-check", action="store_true", help="re-verify an existing APK; the pin's tree is still digested")
    v = sub.add_parser("verify-signed"); v.add_argument("apk", type=Path); v.add_argument("--unsigned-receipt", type=Path, required=True); v.add_argument("--out", type=Path, required=True)
    v.add_argument("--expect-cert", default=EXCALIBUR_CERT)
    c = sub.add_parser("channel-entry"); c.add_argument("--signed-receipt", type=Path, required=True)
    c.add_argument("--qa-receipt-sha256", nargs="+", required=True, help="SHA-256 of each bound QA receipt (>= 2)")
    a = ap.parse_args()
    try:
        if a.cmd == "stamp":
            result = stamp(a.rev, a.notes_file, a.out, batch_id=a.build_batch_id, abis=a.abis,
                           require_checkout_match=not a.skip_checkout_check)
        elif a.cmd == "verify-unsigned":
            result = verify_unsigned(a.apk, a.rev, expect_package=a.expect_package,
                                     require_metadata=not a.allow_unstamped,
                                     require_checkout_match=not a.skip_checkout_check)
            write_receipt(a.out, result)
        elif a.cmd == "verify-signed":
            result = verify_signed(a.apk, json.loads(a.unsigned_receipt.read_text()), expect_cert=a.expect_cert)
            write_receipt(a.out, result)
        else:
            result = channel_entry(json.loads(a.signed_receipt.read_text()), a.qa_receipt_sha256)
    except Refused as error:
        print(f"REFUSED: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
