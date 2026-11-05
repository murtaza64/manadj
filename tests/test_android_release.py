"""Android release hooks (scripts/release/android_release.py, #419): identity, parsing, entry comparison."""

import importlib.util
import json
import zipfile
import zlib
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent
_spec = importlib.util.spec_from_file_location("android_release", ROOT / "scripts" / "release" / "android_release.py")
assert _spec and _spec.loader
ar = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ar)

REV = "6dca1c7265e3aafdc95d4c2cdb687d360c81346d"
BODY = "Session fixes.\nSecond line é"

BADGING = """package: name='dev.murt.manadj.excalibur' versionCode='7' versionName='0.1.0-rc.7' platformBuildVersionName='15'
sdkVersion:'26'
targetSdkVersion:'35'
application-label:'manaDJ Excalibur'
application: label='manaDJ Excalibur' icon='res/BW.xml'
native-code: 'arm64-v8a' 'armeabi-v7a' 'x86' 'x86_64'
"""

CERTS = """Verifies
Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): true
Verified using v3.1 scheme (APK Signature Scheme v3.1): false
Number of signers: 1
Signer #1 certificate DN: CN=manaDJ Android Release, OU=Personal, O=Murtaza
Signer #1 certificate SHA-256 digest: 18f8fe820d6abd112be1fa5c99e3c69f77cbb5c834242899135c9b528af7417c
"""


def test_identity_is_core_420_identity():
    from backend.release_notes import identity
    got = ar.release_identity("0.1.0-rc.8", REV, BODY)
    assert got == identity("0.1.0-rc.8", REV, BODY)
    assert got["release_id"] == "2fad79f44ef9ff33923d7bcdfe956dcac8ff320167462848a6574c80323837d5"
    assert list(sorted(got)) == ["notes_sha256", "release_id", "schema", "source_revision", "version"]


@pytest.mark.parametrize("version,rev,body", [
    ("0.1.0", REV[:12], BODY), ("", REV, BODY), ("0.1.0", REV, "  "), ("0.1.0", REV, "x" * 32769)])
def test_identity_refuses_invalid_inputs(version, rev, body):
    with pytest.raises(ar.Refused):
        ar.release_identity(version, rev, body)


def test_validate_metadata_rejects_tampered_notes_and_extra_fields():
    build = ar.release_identity("0.1.0", REV, BODY)
    notes = {"schema": 1, "release_id": build["release_id"], "body": BODY}
    ar.validate_metadata(build, notes)
    with pytest.raises(ar.Refused):
        ar.validate_metadata(build, {**notes, "body": BODY + "!"})
    with pytest.raises(ar.Refused):
        ar.validate_metadata({**build, "package": "x"}, notes)


def test_gradle_fields_read_committed_app_identity():
    fields = ar.gradle_fields((ROOT / ar.GRADLE).read_text())
    assert fields["package"] == ar.EXPECTED_PACKAGE
    assert fields["min_sdk"] == 26 and fields["version_code"] >= 7


def test_gradle_fields_refuse_ambiguous_assignment():
    with pytest.raises(ar.Refused):
        ar.gradle_fields('applicationId = "a"\napplicationId = "b"\nversionCode = 1\nversionName = "x"\nminSdk = 1\ntargetSdk = 1\n')


def test_parse_badging_and_certs():
    b = ar.parse_badging(BADGING)
    assert (b["package"], b["version_code"], b["min_sdk"], b["target_sdk"]) == (ar.EXPECTED_PACKAGE, 7, 26, 35)
    assert b["abis"] == ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"] and not b["debuggable"]
    assert ar.parse_badging(BADGING + "application-debuggable\n")["debuggable"]
    c = ar.parse_print_certs(CERTS)
    assert c["verifies"] and c["signers"] == 1 and c["certs"] == [ar.EXCALIBUR_CERT]
    assert c["schemes"]["v2"] and not c["schemes"]["v1"]


def _zip(path: Path, entries: dict[str, bytes]) -> Path:
    with zipfile.ZipFile(path, "w") as z:
        for name, data in entries.items():
            z.writestr(name, data)
    return path


def test_signature_entries_do_not_change_content_digest_but_payload_does(tmp_path):
    base = {"classes.dex": b"dex", "META-INF/androidx/LICENSE.txt": b"l", "lib/x86/a.so": b"so"}
    unsigned = _zip(tmp_path / "u.apk", base)
    signed = _zip(tmp_path / "s.apk", {**base, "META-INF/MANIFEST.MF": b"m", "META-INF/MANADJ-R.SF": b"s",
                                       "META-INF/MANADJ-R.RSA": b"r"})
    tampered = _zip(tmp_path / "t.apk", {**base, "classes.dex": b"evil"})
    digest = lambda p: ar.entries_digest(ar.content_entries(ar.zip_entries(p)))  # noqa: E731
    assert digest(unsigned) == digest(signed)
    assert digest(unsigned) != digest(tampered)
    assert "META-INF/androidx/LICENSE.txt" in ar.content_entries(ar.zip_entries(signed))


BATCH = "6f1c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f"
FIELDS = {"package": ar.EXPECTED_PACKAGE, "version_code": 8, "version_name": "0.1.0-rc.8", "min_sdk": 26, "target_sdk": 35}


def _triple():
    build = ar.release_identity("0.1.0-rc.8", REV, BODY)
    notes = {"schema": 1, "release_id": build["release_id"], "body": BODY}
    android = ar.android_build(build, FIELDS, "c" * 64, BATCH, ["x86_64", "arm64-v8a", "x86", "armeabi-v7a"])
    return build, notes, android


def test_android_build_is_canonical_and_bound_to_build_info():
    build, notes, android = _triple()
    assert android["abis"] == ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]
    ar.contract.AndroidBuild.model_validate(android)
    ar.validate_triple(build, notes, android)
    for bad in ({"release_id": "d" * 64}, {"version_name": "0.1.0-rc.9"}, {"source_revision": "e" * 40},
                {"notes_sha256": "f" * 64}):
        with pytest.raises(ar.Refused):
            ar.validate_triple(build, notes, {**android, **bad})
    with pytest.raises(ar.Refused):
        ar.validate_triple(build, notes, {**android, "extra": 1})
    with pytest.raises(ar.Refused):
        ar.android_build(build, FIELDS, "c" * 64, "not-a-uuid", ["x86"])
    with pytest.raises(ar.Refused):
        ar.android_build(build, {**FIELDS, "package": "dev.murt.manadj"}, "c" * 64, BATCH, ["x86"])


def test_embedded_metadata_requires_all_three_files(tmp_path):
    build, notes, android = _triple()
    files = {f"assets/manadj-release/{n}": json.dumps(v).encode()
             for n, v in zip(ar.ASSET_FILES, (build, notes, android))}
    assert ar.embedded_metadata(_zip(tmp_path / "a.apk", files)) == (build, notes, android)
    assert ar.embedded_metadata(_zip(tmp_path / "b.apk", {"classes.dex": b""})) is None
    partial = dict(list(files.items())[:2])
    with pytest.raises(ar.Refused):
        ar.embedded_metadata(_zip(tmp_path / "c.apk", partial))


def test_channel_entry_is_canonical_entry_with_pinned_url():
    build, _, android = _triple()
    signed = {"stage": "signed", "package": ar.EXPECTED_PACKAGE, "version_code": 8, "version_name": "0.1.0-rc.8",
              "min_sdk": 26, "abis": android["abis"], "apk_sha256": "a" * 64, "apk_bytes": 1,
              "signer_cert_sha256": ar.EXCALIBUR_CERT, "source_revision": REV,
              "release_identity": build, "android_build": android}
    entry = ar.channel_entry(signed, ["2" * 64, "1" * 64, "2" * 64])
    assert entry["apk_url"] == f"https://manadj.murtaza.earth/android/artifacts/{build['release_id']}/{'a' * 64}.apk"
    assert entry["qa_receipt_sha256s"] == ["1" * 64, "2" * 64]
    assert entry["build_batch_id"] == BATCH and entry["source_tree_sha256"] == "c" * 64
    ar.contract.Channel.model_validate({"format": "manadj_android_channel/v1", "channel": "stable",
                                        "package": ar.EXPECTED_PACKAGE, "signer_cert_sha256": ar.EXCALIBUR_CERT,
                                        "entries": [entry]})
    fixture = json.loads((ROOT / "tests/fixtures/android-channel-v1.sample.json").read_text())
    assert set(entry) == set(fixture["entries"][0])
    for bad in ({"stage": "unsigned"}, {"release_identity": None}, {"android_build": None},
                {"signer_cert_sha256": "b" * 64}, {"package": "dev.murt.manadj"}):
        with pytest.raises(ar.Refused):
            ar.channel_entry({**signed, **bad}, ["1" * 64, "2" * 64])
    with pytest.raises(ar.Refused):  # contract: >= 2 QA receipts
        ar.channel_entry(signed, ["1" * 64])


def test_write_receipt_is_immutable(tmp_path):
    path = tmp_path / "r.json"
    ar.write_receipt(path, {"a": 1})
    with pytest.raises(ar.Refused):
        ar.write_receipt(path, {"a": 2})


def _crc_twin(data: bytes) -> bytes:
    """Different bytes, same length and CRC32: solve the last 4 bytes over GF(2) (CRC32 is affine)."""
    n, target = len(data), zlib.crc32(data)
    base = bytearray(data); base[0] ^= 1  # differ from data
    zero = zlib.crc32(bytes(n))
    def crc_lin(buf):  # linear part
        return zlib.crc32(bytes(buf)) ^ zero
    cols = []
    for bit in range(32):
        e = bytearray(n); e[n - 4 + bit // 8] = 1 << (bit % 8)
        cols.append(crc_lin(e))
    want = target ^ zlib.crc32(bytes(base[:n - 4]) + bytes(4))
    # Gaussian elimination: find bits x with XOR of cols[x] == want.
    rows = [(cols[i], 1 << i) for i in range(32)]
    basis = {}
    for v, m in rows:
        for b in range(31, -1, -1):
            if not (v >> b) & 1:
                continue
            if b in basis:
                v ^= basis[b][0]; m ^= basis[b][1]
            else:
                basis[b] = (v, m); break
    mask = 0
    for b in range(31, -1, -1):
        if (want >> b) & 1:
            want ^= basis[b][0]; mask ^= basis[b][1]
    assert want == 0
    out = bytes(base[:n - 4]) + mask.to_bytes(4, "little")
    assert out != data and len(out) == n and zlib.crc32(out) == target
    return out


def test_digest_binds_payload_bytes_not_crc(tmp_path):
    dex = b"dex payload " * 20
    twin = _crc_twin(dex)
    a = _zip(tmp_path / "a.apk", {"classes.dex": dex})
    b = _zip(tmp_path / "b.apk", {"classes.dex": twin})
    digest = lambda p: ar.entries_digest(ar.content_entries(ar.zip_entries(p)))  # noqa: E731
    assert digest(a) != digest(b)


def test_duplicate_zip_entries_are_refused(tmp_path):
    path = tmp_path / "dup.apk"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("classes.dex", b"one")
        with pytest.warns(UserWarning):
            z.writestr("classes.dex", b"two")
    with pytest.raises(ar.Refused):
        ar.zip_entries(path)


def test_schema_must_be_integer_one_not_bool_or_float():
    build, notes, _ = _triple()
    for bad in (True, 1.0):
        with pytest.raises(ar.Refused):
            ar.validate_metadata({**build, "schema": bad}, notes)
        with pytest.raises(ar.Refused):
            ar.validate_metadata(build, {**notes, "schema": bad})


def test_max_utf8_notes_stamp_round_trips_under_asset_cap(tmp_path, monkeypatch):
    body = "é" * 16383 + "x"  # 32767 UTF-8 bytes; ensure_ascii would write ~98 KB
    assert len(body.encode()) == 32767
    notes_file = tmp_path / "notes.txt"; notes_file.write_text(body, encoding="utf-8")
    monkeypatch.setattr(ar, "full_commit", lambda rev: REV)
    monkeypatch.setattr(ar, "jj", lambda *a: "".join(f"{k} = {v!r}\n".replace("'", '"') for k, v in
                                                     [("applicationId", ar.EXPECTED_PACKAGE), ("versionName", "0.1.0-rc.8")])
                        + "versionCode = 8\nminSdk = 26\ntargetSdk = 35\n")
    monkeypatch.setattr(ar, "source_manifest", lambda commit: ("x\n", 1))
    ar.stamp("x", notes_file, tmp_path / "out", batch_id=BATCH, require_checkout_match=False)
    files = {f"assets/manadj-release/{n}": (tmp_path / "out/manadj-release" / n).read_bytes() for n in ar.ASSET_FILES}
    assert max(len(v) for v in files.values()) <= ar.MAX_ASSET_BYTES
    build, notes, android = ar.embedded_metadata(_zip(tmp_path / "a.apk", files))
    ar.validate_triple(build, notes, android)
    assert notes["body"] == body


def test_oversized_embedded_asset_is_refused_before_parse(tmp_path):
    build, notes, android = _triple()
    files = {f"assets/manadj-release/{n}": json.dumps(v).encode() for n, v in zip(ar.ASSET_FILES, (build, notes, android))}
    files["assets/manadj-release/release-notes.json"] = b" " * (ar.MAX_ASSET_BYTES + 1)
    with pytest.raises(ar.Refused):
        ar.embedded_metadata(_zip(tmp_path / "big.apk", files))


def test_stamp_keeps_exact_notes_bytes(tmp_path, monkeypatch):
    body = "  Notes with edges.\n\n"
    notes_file = tmp_path / "notes.txt"; notes_file.write_bytes(body.encode())
    monkeypatch.setattr(ar, "full_commit", lambda rev: REV)
    monkeypatch.setattr(ar, "jj", lambda *a: 'applicationId = "dev.murt.manadj.excalibur"\nversionName = "0.1.0-rc.8"\n'
                        "versionCode = 8\nminSdk = 26\ntargetSdk = 35\n")
    monkeypatch.setattr(ar, "source_manifest", lambda commit: ("x\n", 1))
    result = ar.stamp("x", notes_file, tmp_path / "out", batch_id=BATCH, require_checkout_match=False)
    notes = json.loads((tmp_path / "out/manadj-release/release-notes.json").read_bytes())
    assert notes["body"] == body
    assert result["build_info"]["notes_sha256"] == __import__("hashlib").sha256(body.encode()).hexdigest()
