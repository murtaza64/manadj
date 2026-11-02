"""Opt-in immutable Session exchange; never opens paths supplied by an artifact.

All filesystem operations are relative to no-follow directory descriptors, including
each component of the configured absolute root. The bounded tree has at most 256
artifacts; a tick processes 8, round-robin. No deletion or automatic republication.
"""
import itertools
import json
import os
import re
import stat
from contextlib import contextmanager
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy import select

from ..peer_inventory.contracts import MAX_EXPORT, canonical
from .contracts import Bundle, Chunk, ExportBody, Manifest, digest
from .models import FolderConfig, FolderPublication, FolderReceipt, SyncSession, SyncSource
from .service import PeerSync, SyncError

MARKER = ".manadj-peer-folder.json"
FORMAT = {"format": "manadj-peer-folder", "version": 1}
UUID_PATTERN = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
ARTIFACT = re.compile(rf"({UUID_PATTERN})_({UUID_PATTERN})_([0-9a-f]{{64}})")
def directory_flags():
    # Windows can start the application with transport disabled. Never emulate
    # no-follow by silently omitting unsupported security flags.
    if (os.name != "posix" or not hasattr(os, "O_DIRECTORY") or not hasattr(os, "O_NOFOLLOW")
            or any(operation not in os.supports_dir_fd for operation in (os.open, os.mkdir, os.link, os.unlink))
            or os.scandir not in os.supports_fd):
        raise SyncError(422, "folder_transport_unsupported_platform")
    return os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


@contextmanager
def root_fd(root):
    flags = directory_flags()
    path = Path(root)
    if not path.is_absolute() or ".." in path.parts:
        raise SyncError(422, "absolute_no_traversal_root_required")
    fd = os.open(path.anchor, flags)
    try:
        for part in path.parts[1:]:
            child = os.open(part, flags, dir_fd=fd)
            os.close(fd)
            fd = child
        yield fd
    finally:
        os.close(fd)


def read_json(fd, name, limit=MAX_EXPORT):
    directory_flags()
    file_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    with os.fdopen(file_fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise SyncError(422, "bounded_regular_artifact_required")
        data = stream.read(limit + 1)
        if len(data) > limit:
            raise SyncError(422, "artifact_too_large")
    def unique(items):
        value = {}
        for key, item in items:
            if key in value:
                raise ValueError("duplicate artifact key")
            value[key] = item
        return value
    return json.loads(data, object_pairs_hook=unique)


def immutable_json(fd, name, value):
    """Crash-safe, no overwrite: link a flushed same-directory temporary file.

    link() is the no-replace atomic publication operation (rename overwrites).
    A crash before the DB cursor is harmless: existing canonical content wins.
    """
    directory_flags()
    try:
        existing = read_json(fd, name)
    except FileNotFoundError:
        pass
    else:
        if canonical(existing) != canonical(value):
            raise SyncError(409, "immutable_folder_conflict")
        return
    temp = ".stage-" + uuid4().hex
    file_fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
    try:
        with os.fdopen(file_fd, "wb") as stream:
            stream.write(canonical(value))
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temp, name, src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
        except FileExistsError:
            if canonical(read_json(fd, name)) != canonical(value):
                raise SyncError(409, "immutable_folder_conflict")
        os.fsync(fd)
    finally:
        os.unlink(temp, dir_fd=fd)


def names(fd, limit=256):
    with os.scandir(fd) as entries:
        result = [entry.name for entry in itertools.islice(entries, limit + 1)]
    if len(result) > limit:
        raise SyncError(422, "folder_entry_limit")
    return sorted(result)


def marker(fd):
    value = read_json(fd, MARKER, 1024)
    if (not isinstance(value, dict) or set(value) != {*FORMAT, "token"}
            or any(type(value.get(k)) is not type(v) or value[k] != v for k, v in FORMAT.items())
            or not isinstance(value["token"], str) or not re.fullmatch(r"[0-9a-f]{32}", value["token"])):
        raise SyncError(422, "invalid_folder_ownership_marker")
    return value["token"]


class FolderTransport:
    def __init__(self, session_factory):
        self.sessions = session_factory

    def configure(self, body):
        with self.sessions() as db:
            PeerSync(db).identity()
            config = db.get(FolderConfig, 1)
            if config is not None and config.root != body.root:
                raise SyncError(409, "transport_root_is_pinned")
            if not body.enabled and config is not None:
                config.enabled, config.state = 0, "disabled"
                db.commit()
                return self.status()
            try:
                with root_fd(body.root) as fd:
                    if not names(fd):
                        immutable_json(fd, MARKER, {**FORMAT, "token": uuid4().hex})
                    token = marker(fd)
                    if config is not None and config.token != token:
                        raise SyncError(409, "folder_ownership_changed")
            except OSError:
                raise SyncError(422, "existing_no_symlink_owned_folder_required") from None
            if config is None:
                config = FolderConfig(id=1, root=body.root, token=token)
                db.add(config)
            config.enabled, config.state = int(body.enabled), "pending" if body.enabled else "disabled"
            db.commit()
        return self.status()

    def select(self, sid):
        # Freezes the existing strict issued evidence, including exact asset hashes.
        with self.sessions() as db:
            PeerSync(db).export(sid, ExportBody(reference_basis="explicit-current-row-bindings", fingerprint_assets=True))
        with self.sessions() as db:
            PeerSync(db)._lock()
            if db.get(FolderPublication, str(sid)) is None:
                if len(list(db.scalars(select(FolderPublication.session_uuid).limit(255)))) >= 255:
                    raise SyncError(422, "transport_selection_limit")
                db.add(FolderPublication(session_uuid=str(sid)))
            db.commit()
        return self.status()

    def status(self):
        with self.sessions() as db:
            config = db.get(FolderConfig, 1)
            return {"state": config.state if config else "unconfigured", "enabled": bool(config and config.enabled),
                    "root": config.root if config else None,
                    "publications": [{"session_uuid": row.session_uuid, "state": row.state, "published": bool(row.published)}
                                     for row in db.scalars(select(FolderPublication).order_by(FolderPublication.session_uuid))],
                    "receipts": [{"artifact": row.artifact, "state": row.state, "received": bool(row.received),
                                  "readiness": row.readiness}
                                 for row in db.scalars(select(FolderReceipt).order_by(FolderReceipt.artifact))]}

    def _config_state(self, state):
        with self.sessions() as db:
            db.get(FolderConfig, 1).state = state
            db.commit()

    def _publication(self, sid, state, published=None):
        with self.sessions() as db:
            row = db.get(FolderPublication, sid)
            row.state = state
            if published is not None:
                row.published = published
            db.commit()

    def _receipt(self, key, state, received=None, readiness=None):
        with self.sessions() as db:
            row = db.get(FolderReceipt, key)
            if row is None:
                row = FolderReceipt(artifact=key)
                db.add(row)
            row.state, row.readiness = state, readiness
            if received is not None:
                row.received = received
            db.commit()

    def _publish(self, root, sid, published, local, accepted):
        with self.sessions() as db:
            source = db.get(SyncSession, sid)
            key = f"{local}_{sid}_{source.manifest_sha256}"
            manifest = Manifest.model_validate_json(source.manifest_json)
            chunks = PeerSync(db)._chunks(sid)
        try:
            fd = os.open(key, directory_flags(), dir_fd=root)
        except FileNotFoundError:
            if published:
                self._publication(sid, "file_missing")
                return
            if len(names(root)) >= 256:
                raise SyncError(422, "folder_entry_limit")
            os.mkdir(key, mode=0o700, dir_fd=root)
            os.fsync(root)
            fd = os.open(key, directory_flags(), dir_fd=root)
        try:
            expected = manifest.model_dump(mode="json")
            complete = self._complete(local, sid, source.manifest_sha256, manifest.chunk_sha256)
            if published:
                try:
                    self._read_bundle(fd, key)
                except FileNotFoundError:
                    self._publication(sid, "file_missing")
                    return
            else:
                immutable_json(fd, "manifest.json", expected)
                for seq, events in chunks.items():
                    immutable_json(fd, f"{seq}-{manifest.chunk_sha256[seq]}.json", {"seq": seq, "events": events})
                immutable_json(fd, "complete.json", complete)
                self._publication(sid, "published_waiting_ack", 1)
            acknowledged = False
            for receiver in accepted:
                try:
                    ack = read_json(fd, f"ack-{receiver}.json", 2048)
                except FileNotFoundError:
                    continue
                if canonical(ack) == canonical(self._ack(local, sid, source.manifest_sha256, receiver)):
                    acknowledged = True
            self._publication(sid, "acknowledged" if acknowledged else "published_waiting_ack")
        finally:
            os.close(fd)

    @staticmethod
    def _complete(origin, sid, hashed, chunks):
        return {"format": "manadj-peer-complete", "version": 1, "origin": origin, "session": sid,
                "manifest": hashed, "chunks": chunks}

    @staticmethod
    def _ack(origin, sid, hashed, receiver):
        return {"format": "manadj-peer-ack", "version": 1, "origin": origin, "session": sid,
                "manifest": hashed, "receiver": receiver}

    def _read_bundle(self, fd, key):
        origin, sid, hashed = ARTIFACT.fullmatch(key).groups()
        manifest = Manifest.model_validate_json(canonical(read_json(fd, "manifest.json", 1024 * 1024)))
        if (str(manifest.origin_replica_id), str(manifest.session_uuid), digest(manifest.model_dump(mode="json"))) != (origin, sid, hashed):
            raise SyncError(409, "artifact_identity_conflict")
        complete = read_json(fd, "complete.json", 512 * 1024)
        if canonical(complete) != canonical(self._complete(origin, sid, hashed, manifest.chunk_sha256)):
            raise SyncError(409, "artifact_complete_conflict")
        chunks, size = [], 0
        for seq, hashed_chunk in enumerate(manifest.chunk_sha256):
            chunk = Chunk.model_validate(read_json(fd, f"{seq}-{hashed_chunk}.json"))
            size += len(canonical(chunk.model_dump(mode="json")))
            if chunk.seq != seq or size > MAX_EXPORT:
                raise SyncError(422, "artifact_bounds")
            chunks.append(chunk)
        return Bundle(format="manadj-peer-session", version=1, digest_algorithm="sha256-rfc8785-jcs-v1",
                      manifest=manifest, chunks=chunks)

    def _receive(self, root, key, local, accepted):
        origin, sid, hashed = ARTIFACT.fullmatch(key).groups()
        if origin == local:
            return  # Never forward or echo this replica's own immutable outbox.
        if origin not in accepted:
            self._receipt(key, "unknown_source")
            return
        fd = os.open(key, directory_flags(), dir_fd=root)
        try:
            bundle = self._read_bundle(fd, key)
            with self.sessions() as db:
                PeerSync(db).receive(bundle)
            self._receipt(key, "received", received=1)
            # Receipt is durable BEFORE ack. Restart retries the same bytes, not a new outbox.
            immutable_json(fd, f"ack-{local}.json", self._ack(origin, sid, hashed, local))
            with self.sessions() as db:
                detail = PeerSync(db).detail(sid)
            readiness = detail["state"]
            if detail["dependencies_ready"]:
                with self.sessions() as db:
                    PeerSync(db).materialize(UUID(sid))
                readiness = "materialized"
            self._receipt(key, "acknowledged", received=1, readiness=readiness)
        finally:
            os.close(fd)

    def run_once(self):
        with self.sessions() as db:
            config = db.get(FolderConfig, 1)
            if config is None or not config.enabled:
                return self.status()  # Disabled does not stat/open the configured root.
            root, token, cursor = config.root, config.token, config.cursor
            local = PeerSync(db).identity()["replica_id"]
            accepted = set(db.scalars(select(SyncSource.replica_id).limit(257)))
            if len(accepted) > 256:
                config.state = "accepted_source_limit"
                db.commit()
                return self.status()
            publications = [(p.session_uuid, p.published) for p in db.scalars(
                select(FolderPublication).order_by(FolderPublication.session_uuid).limit(255))]
        try:
            with root_fd(root) as fd:
                if marker(fd) != token:
                    raise SyncError(409, "folder_ownership_changed")
                entries = names(fd)
                # Both directions share the durable round-robin cursor, including outboxes.
                pub_keys = {}
                with self.sessions() as db:
                    for sid, published in publications:
                        source = db.get(SyncSession, sid)
                        pub_keys[f"{local}_{sid}_{source.manifest_sha256}"] = (sid, published)
                keys = sorted(set(k for k in entries if ARTIFACT.fullmatch(k)) | pub_keys.keys())
                cycle = [k for k in keys if k > cursor] + [k for k in keys if k <= cursor]
                for key in cycle[:8]:
                    try:
                        if key in pub_keys:
                            self._publish(fd, *pub_keys[key], local, accepted)
                        else:
                            self._receive(fd, key, local, accepted)
                    except (OSError, ValueError, TypeError, KeyError, RecursionError, SyncError) as error:
                        state = ("partial" if isinstance(error, FileNotFoundError) else
                                 error.code if isinstance(error, SyncError) else "invalid_or_unavailable_artifact")
                        if key in pub_keys:
                            self._publication(pub_keys[key][0], state)
                        else:
                            self._receipt(key, state)
                    with self.sessions() as db:
                        db.get(FolderConfig, 1).cursor = key
                        db.commit()
                self._config_state("ready")
        except (OSError, ValueError, TypeError, KeyError, SyncError) as error:
            self._config_state(error.code if isinstance(error, SyncError) else "offline")
        return self.status()
