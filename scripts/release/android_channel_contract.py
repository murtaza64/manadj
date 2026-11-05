"""Canonical #419 contracts. No signer, network, publish or install side effects."""
from __future__ import annotations

import hashlib
import json
import re
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.release_notes import identity

PACKAGE = "dev.murt.manadj.excalibur"
CERT = "18f8fe820d6abd112be1fa5c99e3c69f77cbb5c834242899135c9b528af7417c"
FEED_ORIGIN = "https://manadj.murtaza.earth"
ASSET_PREFIX = "assets/manadj-release/"
SHA = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
SOURCE = Annotated[str, Field(pattern=r"^[0-9a-f]{40}$")]
BATCH = Annotated[str, Field(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")]
VERSION = Annotated[str, Field(pattern=r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$")]
CODE = Annotated[int, Field(ge=1, le=2100000000)]
SIZE = Annotated[int, Field(ge=1, le=512 * 1024 * 1024)]
ABI = Literal["arm64-v8a", "armeabi-v7a", "x86_64", "x86"]
CHANNEL = Literal["stable", "preview"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()


def sha(value):
    return hashlib.sha256(canonical(value)).hexdigest()


class BuildInfo(Strict):
    schema: Literal[1]
    version: VERSION
    source_revision: SOURCE
    notes_sha256: SHA
    release_id: SHA


class Notes(Strict):
    schema: Literal[1]
    release_id: SHA
    body: str

    @model_validator(mode="after")
    def bounded(self):
        if not self.body.strip() or len(self.body.encode("utf-8")) > 32768:
            raise ValueError("Authored notes must be nonblank and <=32768 UTF-8 bytes")
        return self


def metadata(build, notes):
    build = BuildInfo.model_validate(build)
    notes = Notes.model_validate(notes)
    if build.model_dump() != identity(build.version, build.source_revision, notes.body) or notes.release_id != build.release_id:
        raise ValueError("Exact #420 identity/notes mismatch")
    return build, notes


class AndroidBuild(Strict):
    format: Literal["manadj_android_build/v1"]
    release_id: SHA
    package: Literal[PACKAGE]
    version_code: CODE
    version_name: VERSION
    source_revision: SOURCE
    source_tree_sha256: SHA
    build_batch_id: BATCH
    notes_sha256: SHA
    min_sdk: Annotated[int, Field(ge=26, le=100)]
    target_sdk: Annotated[int, Field(ge=26, le=100)]
    abis: list[ABI] = Field(min_length=1, max_length=4)

    @model_validator(mode="after")
    def sdk_abi(self):
        if self.target_sdk < self.min_sdk or self.abis != sorted(set(self.abis)):
            raise ValueError("Ordered unique ABIs and coherent SDK bounds required")
        return self


class QAReceipt(Strict):
    id: Annotated[str, Field(min_length=1, max_length=256)]
    scope: Literal["source", "unsigned", "signed"]
    result: Literal["pass"]
    source_revision: SOURCE
    source_tree_sha256: SHA
    build_batch_id: BATCH
    release_id: SHA
    artifact_sha256: SHA | None
    receipt_sha256: SHA


class Candidate(Strict):
    format: Literal["manadj_android_candidate/v1"]
    channel: CHANNEL
    build: AndroidBuild
    build_info: BuildInfo
    release_notes: Notes
    unsigned_apk_sha256: SHA
    unsigned_apk_bytes: SIZE
    content_entries_sha256: SHA
    verification_receipt_sha256: SHA
    qa_receipts: list[QAReceipt] = Field(min_length=2, max_length=64)

    @model_validator(mode="after")
    def coherent(self):
        metadata(self.build_info.model_dump(), self.release_notes.model_dump())
        for key, expected in (("release_id", self.build_info.release_id), ("source_revision", self.build_info.source_revision),
                ("notes_sha256", self.build_info.notes_sha256), ("version_name", self.build_info.version)):
            if getattr(self.build, key) != expected:
                raise ValueError("Candidate embedded/source identity disagrees")
        scopes = set()
        for receipt in self.qa_receipts:
            if (receipt.source_revision, receipt.source_tree_sha256, receipt.build_batch_id, receipt.release_id) != (
                    self.build.source_revision, self.build.source_tree_sha256, self.build.build_batch_id, self.build.release_id):
                raise ValueError("QA receipt belongs to another source/build/batch")
            if receipt.scope == "source" and receipt.artifact_sha256 is not None or receipt.scope == "unsigned" and receipt.artifact_sha256 != self.unsigned_apk_sha256:
                raise ValueError("QA artifact binding disagrees")
            scopes.add(receipt.scope)
        if not {"source", "unsigned"} <= scopes or len({item.id for item in self.qa_receipts}) != len(self.qa_receipts):
            raise ValueError("Distinct source and unsigned QA evidence required")
        return self


class SignRequest(Strict):
    format: Literal["manadj_android_sign_request/v1"]
    candidate_sha256: SHA
    build: AndroidBuild
    unsigned_apk_sha256: SHA
    unsigned_apk_bytes: SIZE
    content_entries_sha256: SHA
    expected_signer_cert_sha256: Literal[CERT]


class SignReceipt(Strict):
    format: Literal["manadj_android_sign_receipt/v1"]
    candidate_sha256: SHA
    build: AndroidBuild
    unsigned_apk_sha256: SHA
    apk_sha256: SHA
    apk_bytes: SIZE
    content_entries_sha256: SHA
    signer_cert_sha256: Literal[CERT]
    verification_receipt_sha256: SHA


class Entry(Strict):
    # Retain existing native entry names; provenance adds no applied claim.
    release_id: SHA
    version_code: CODE
    version_name: VERSION
    min_sdk: Annotated[int, Field(ge=26, le=100)]
    abis: list[ABI] = Field(min_length=1, max_length=4)
    source_revision: SOURCE
    source_tree_sha256: SHA
    build_batch_id: BATCH
    notes_sha256: SHA
    apk_url: str
    apk_sha256: SHA
    apk_bytes: SIZE
    qa_receipt_sha256s: list[SHA] = Field(min_length=2, max_length=64)

    @model_validator(mode="after")
    def immutable_url(self):
        parsed = urlsplit(self.apk_url)
        if (parsed.scheme != "https" or parsed.username or parsed.password or parsed.query or parsed.fragment
                or parsed.port not in (None, 443) or "%" in parsed.path or "/../" in parsed.path):
            raise ValueError("Pinned immutable HTTPS APK URL required")
        local = parsed.netloc == "manadj.murtaza.earth" and parsed.path == f"/android/artifacts/{self.release_id}/{self.apk_sha256}.apk"
        if not local:
            raise ValueError("APK URL must use the pinned Pages immutable asset path; redirects/GitHub latest refused")
        if self.abis != sorted(set(self.abis)):
            raise ValueError("Ordered unique ABIs required")
        if self.qa_receipt_sha256s != sorted(set(self.qa_receipt_sha256s)):
            raise ValueError("Ordered unique QA receipt hashes required")
        return self


class Channel(Strict):
    format: Literal["manadj_android_channel/v1"]
    channel: CHANNEL
    package: Literal[PACKAGE]
    signer_cert_sha256: Literal[CERT]
    entries: list[Entry] = Field(min_length=1, max_length=128)

    @model_validator(mode="after")
    def monotonic(self):
        codes = [entry.version_code for entry in self.entries]
        if codes != sorted(set(codes)):
            raise ValueError("Ordered unique monotonic version codes required")
        return self


class Contract(Strict):
    document: Candidate | SignRequest | SignReceipt | Channel | AndroidBuild
