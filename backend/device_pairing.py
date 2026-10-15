"""Zero-typing phone pairing (#374): approve-on-desktop device tokens.

Flow (all over the LAN listener, backend/device_listener.py):

1. The phone POSTs /api/device-pair/request {device_id, device_name}. It gets
   back a request id and a 4-digit match code that it shows to the user.
2. The desktop (Settings → Library → Phone sync, plus an app-wide prompt)
   lists the pending request with the same code. The user approves or denies.
3. The phone polls /api/device-pair/request/{id}. Once approved, it receives
   its per-device token exactly once and stores it. From then on it sends
   `X-Manadj-Device-Token`.

Paired devices live in <data root>/data/paired_devices.json (mode 0600; the
data dir, never the repo checkout — in dev the data root IS the repo), which
stores sha256 hashes of the tokens, never the tokens themselves. Revoking a
device deletes its entry. The typed pairing code (#373) remains as a fallback.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

TOKEN_HEADER = "X-Manadj-Device-Token"
REQUEST_TTL_S = 120.0
MAX_PENDING = 5


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def registry_path() -> Path:
    from .data_root import data_root

    return Path(data_root()) / "data" / "paired_devices.json"


def legacy_registry_path() -> Path:
    """Where #374 first wrote it: the data root itself (= the repo in dev)."""
    from .data_root import data_root

    return Path(data_root()) / "paired_devices.json"


@dataclass
class PairedDevice:
    device_id: str
    name: str
    token_sha256: str
    paired_at: str
    last_seen: str | None = None

    def public(self) -> dict:
        d = asdict(self)
        d.pop("token_sha256")
        return d


class DeviceRegistry:
    """Paired devices, persisted as JSON. Thread-safe; file rewritten atomically."""

    def __init__(self, path_fn=registry_path, legacy_fn=None) -> None:
        self._path_fn = path_fn
        self._legacy_fn = legacy_fn if legacy_fn is not None else (legacy_registry_path if path_fn is registry_path else None)
        self._lock = threading.Lock()

    def _migrate(self, path: Path) -> None:
        """Move a registry left in the legacy location (repo root in dev) into the data dir."""
        legacy = self._legacy_fn() if self._legacy_fn else None
        if legacy is None or not legacy.exists():
            return
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            legacy.replace(path)
            if os.name == "posix":
                path.chmod(0o600)
        else:
            legacy.unlink()

    def _load(self) -> list[PairedDevice]:
        path = self._path_fn()
        self._migrate(path)
        if not path.exists():
            return []
        try:
            return [PairedDevice(**d) for d in json.loads(path.read_text(encoding="utf-8"))]
        except (ValueError, TypeError):
            return []

    def _save(self, devices: list[PairedDevice]) -> None:
        path = self._path_fn()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(json.dumps([asdict(d) for d in devices], indent=1), encoding="utf-8")
        if os.name == "posix":
            tmp.chmod(0o600)
        tmp.replace(path)

    def list(self) -> list[PairedDevice]:
        with self._lock:
            return self._load()

    def add(self, device_id: str, name: str) -> str:
        """Pair (or re-pair) a device; returns its new token."""
        token = secrets.token_urlsafe(32)
        with self._lock:
            devices = [d for d in self._load() if d.device_id != device_id]
            devices.append(PairedDevice(device_id, name, _hash(token), _now_iso()))
            self._save(devices)
        return token

    def revoke(self, device_id: str) -> bool:
        with self._lock:
            devices = self._load()
            kept = [d for d in devices if d.device_id != device_id]
            self._save(kept)
            return len(kept) != len(devices)

    def authenticate(self, token: str) -> PairedDevice | None:
        if not token:
            return None
        digest = _hash(token)
        with self._lock:
            devices = self._load()
            for d in devices:
                if hmac.compare_digest(d.token_sha256, digest):
                    # Coarse last-seen (one write per minute at most).
                    now = _now_iso()
                    if d.last_seen is None or d.last_seen[:16] != now[:16]:
                        d.last_seen = now
                        self._save(devices)
                    return d
        return None


@dataclass
class PairRequest:
    id: str
    device_id: str
    device_name: str
    match_code: str
    client: str
    created: float = field(default_factory=time.monotonic)
    status: str = "pending"  # pending | approved | denied | expired
    token: str | None = None  # handed to the phone once, then cleared

    def public(self) -> dict:
        return {
            "id": self.id,
            "device_id": self.device_id,
            "device_name": self.device_name,
            "match_code": self.match_code,
            "client": self.client,
            "status": self.status,
            "age_s": round(time.monotonic() - self.created),
        }


class PairingRequests:
    """In-memory pending requests (a restart simply drops them)."""

    def __init__(self, registry: DeviceRegistry) -> None:
        self.registry = registry
        self._requests: dict[str, PairRequest] = {}
        self._lock = threading.Lock()

    def _expire(self) -> None:
        now = time.monotonic()
        for r in list(self._requests.values()):
            if now - r.created > REQUEST_TTL_S:
                if r.status == "pending":
                    r.status = "expired"
                if now - r.created > 2 * REQUEST_TTL_S:
                    del self._requests[r.id]

    def create(self, device_id: str, device_name: str, client: str) -> PairRequest | None:
        with self._lock:
            self._expire()
            # One live request per device; a re-request replaces it.
            for r in list(self._requests.values()):
                if r.device_id == device_id and r.status == "pending":
                    del self._requests[r.id]
            if sum(r.status == "pending" for r in self._requests.values()) >= MAX_PENDING:
                return None
            req = PairRequest(
                id=uuid.uuid4().hex,
                device_id=device_id[:64],
                device_name=(device_name.strip() or "Android phone")[:60],
                match_code=f"{secrets.randbelow(10_000):04d}",
                client=client,
            )
            self._requests[req.id] = req
            return req

    def pending(self) -> list[PairRequest]:
        with self._lock:
            self._expire()
            return [r for r in self._requests.values() if r.status == "pending"]

    def poll(self, request_id: str) -> PairRequest | None:
        """The phone's view. The token is returned once, then cleared."""
        with self._lock:
            self._expire()
            r = self._requests.get(request_id)
            if r is None:
                return None
            snapshot = PairRequest(**{**asdict(r)})
            if r.token is not None:
                r.token = None
                del self._requests[r.id]
            return snapshot

    def decide(self, request_id: str, approve: bool) -> PairRequest | None:
        with self._lock:
            self._expire()
            r = self._requests.get(request_id)
            if r is None or r.status != "pending":
                return None
            if approve:
                r.token = self.registry.add(r.device_id, r.device_name)
                r.status = "approved"
            else:
                r.status = "denied"
            return r
