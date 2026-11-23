"""Read-only, bounded cloud DTO preparation. No network, discovery or DB writes.

The managed shell supplies this app's actual SQLite path. There is no arbitrary
path parameter on the HTTP boundary, no offline-export artifact, no gzip and no
fallback to another library. Unknown/oversized values fail the whole preparation.
"""
from __future__ import annotations
import json
import math
from pathlib import Path
import re
import sqlite3
import time
from uuid import UUID

SCHEMA = "manadj-library-snapshot/v1"
MAX_PART = 250_000  # Reserve headroom for Python/JS numeric serialization differences.
MAX_TOTAL = 63 * 1024 * 1024
MAX_PARTS = 256
FIELDS = json.loads((Path(__file__).resolve().parent.parent / "cloud/library/fields.json").read_text())
SAFE_INTEGER = 9007199254740991
OMISSIONS = [
    "Audio, voice recordings and stems are excluded.",
    "Paths, filenames, file hashes, settings, secrets and device/account state are excluded.",
    "Peer/group sessions, their Takes and their promoted routines/transitions are excluded.",
    "Waveform/harmony blobs and saved automation/event bodies outside selected history are excluded.",
]
class PreparationError(ValueError):
    pass

def fail(code):
    raise PreparationError(code)

def _canonical_uuid(value):
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        return None

def group_denied_sessions(db, existing):
    """Verified signed-evidence group denial, equivalent to the app's selector
    (peer_sync/group_history.received_operations) over the same durable rows.

    Returns (claimed session uuids to exclude, verified own-issued count).
    Own-issued operations verified against pinned member keys and the local
    group authority stay local; every other claim from signed bodies and
    possession proofs denies exactly its session. Unreadable evidence fails the
    whole preparation - it never counts as local, never as empty.

    Signed-evidence verification needs the app's crypto stack, which the
    minimal dep-free check environment does not install. Empty evidence
    short-circuits before those imports; non-empty evidence without the
    stack fails the whole preparation, never a local classification."""
    op_rows = poss_rows = 0
    if "device_group_operations" in existing:
        op_rows = db.execute('SELECT COUNT(*) FROM "device_group_operations"').fetchone()[0]
    if "device_group_possessions" in existing:
        poss_rows = db.execute('SELECT COUNT(*) FROM "device_group_possessions"').fetchone()[0]
    if not op_rows and not poss_rows:
        return set(), 0
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
        from .peer_sync.group_contracts import DOMAIN, Delivery, Operation, Page, Signed, decode, unpack
        from .peer_sync.service import validate_complete
    except ImportError:
        fail("cloud_group_evidence_unreadable")
    groups, members, replica = {}, {}, None
    if "device_groups" in existing:
        for row in db.execute('SELECT group_id,device_id,private_seed_b64 FROM "device_groups"'):
            groups[row[0]] = (row[1], row[2])
    if "device_group_members" in existing:
        for row in db.execute('SELECT group_id,device_id,public_key_b64,revoked FROM "device_group_members"'):
            members[(row[0], row[1])] = (row[2], row[3])
    if "peer_sync_local" in existing:
        row = db.execute('SELECT replica_id FROM "peer_sync_local" WHERE id=1').fetchone()
        replica = row[0] if row else None
    claimed, own_verified, own_count = set(), set(), 0

    def verified(row, parsed):
        """Full verified_operation equivalent; None on any failure."""
        try:
            group = groups.get(row[0])
            if group is None or parsed is None or replica is None or replica != group[0]:
                return None
            local_member = members.get((row[0], group[0]))
            if local_member is None or decode(local_member[0]) != \
                    Ed25519PrivateKey.from_private_bytes(decode(group[1])).public_key().public_bytes_raw():
                return None
            operation, raw, hashed = unpack(Signed(body_b64=row[5], signature_b64=row[6]), Operation)
            if str(operation.group_id) != row[0]:
                return None
            origin_member = members.get((row[0], str(operation.origin_device_id)))
            if origin_member is None or origin_member[1]:
                return None
            Ed25519PublicKey.from_public_bytes(decode(origin_member[0])).verify(decode(row[6]), DOMAIN + raw)
            manifest = operation.bundle.manifest
            if (hashed != row[4] or str(operation.operation_id) != row[1]
                    or str(manifest.session_uuid) != row[3]
                    or str(operation.origin_device_id) != row[2]
                    or manifest.origin_replica_id != operation.origin_device_id
                    or not validate_complete(manifest, {c.seq: c.events for c in operation.bundle.chunks})):
                return None
            return operation
        except Exception:  # Verification denial is fail-safe; parsing stays separate.
            return None

    if "device_group_operations" in existing:
        for row in db.execute('SELECT group_id,operation_id,origin_device_id,session_uuid,sha256,body_b64,signature_b64'
                              ' FROM "device_group_operations" ORDER BY group_id,operation_id'):
            parsed = None
            try:
                parsed = unpack(Signed(body_b64=row[5], signature_b64=row[6]), Operation)[0]
            except Exception:
                pass
            operation = verified(row, parsed)
            if operation is not None and str(operation.origin_device_id) == groups[row[0]][0]:
                own_count += 1
                own_verified.add((str(operation.group_id), str(operation.operation_id),
                    str(operation.bundle.manifest.session_uuid), str(operation.origin_device_id), row[4]))
                continue
            identities = set()
            canonical = _canonical_uuid(row[3])
            if canonical:
                identities.add(canonical)
            if parsed is not None:
                identities.add(str(parsed.bundle.manifest.session_uuid))
            if not identities:
                fail("cloud_group_evidence_unreadable")
            claimed |= identities
    if "device_group_possessions" in existing:
        for row in db.execute('SELECT proof_body_b64,proof_signature_b64 FROM "device_group_possessions"'):
            proof = Signed(body_b64=row[0], signature_b64=row[1])
            try:
                try:
                    signed_operations = [unpack(proof, Delivery)[0].operation]
                except ValueError:
                    signed_operations = unpack(proof, Page)[0].operations
                if len(signed_operations) != 1:
                    raise ValueError("Supplying proof lost its operation identity")
                for signed in signed_operations:
                    operation, _, hashed = unpack(signed, Operation)
                    key = (str(operation.group_id), str(operation.operation_id),
                           str(operation.bundle.manifest.session_uuid), str(operation.origin_device_id), hashed)
                    if key in own_verified:
                        continue
                    claimed.add(key[2])
            except (ValueError, TypeError, KeyError, RecursionError):
                fail("cloud_group_evidence_unreadable")
    return claimed, own_count

def quoted(name):
    # All identifiers originate from the fixed schema vocabulary, not request data.
    return '"' + name.replace('"', '""') + '"'

def encode(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False, allow_nan=False)

def safe_text(value):
    if len(value) > 2048 or re.search(r"[\x00-\x1f\x7f]", value):
        fail("cloud_metadata_text_limit")
    # Fail visibly instead of silently censoring a label the user expects to review.
    if re.search(r"(?i)(?:https?://|file://|data:|(?:^|\s)/(?:[^/\s]+/)+|[a-z]:[\\/]|\b(?:password|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|secret)\s*[:=]|\b(?:ghp_|github_pat_|sk_live_|sk-proj-))", value):
        fail("cloud_metadata_sensitive_text")
    return value

def safe_value(value, json_column=False):
    if value is None or isinstance(value, bool):
        return value
    if json_column:
        if not isinstance(value, str) or len(value) > MAX_PART:
            fail("cloud_structured_metadata_invalid")
        try:
            parsed = json.loads(value, parse_constant=lambda _: fail("cloud_nonfinite_metadata"))
        except (ValueError, TypeError, RecursionError):
            fail("cloud_structured_metadata_invalid")
        # Fixed server DTO validation, including nested vocabulary and traversal
        # budgets, is performed again by main on the exact frozen part bytes.
        return parsed
    if isinstance(value, str):
        return safe_text(value)
    if isinstance(value, (int, float)) and math.isfinite(value) and abs(value) <= SAFE_INTEGER:
        return value
    fail("cloud_metadata_value_invalid")

def prepare_snapshot(path: Path, *, timeout_seconds=15):
    if not path or not isinstance(path, Path) or not path.is_file():
        fail("cloud_personal_sqlite_required")
    deadline = time.monotonic() + timeout_seconds
    uri = path.resolve().as_uri() + "?mode=ro"
    db = sqlite3.connect(uri, uri=True, timeout=3)
    db.row_factory = sqlite3.Row
    if not hasattr(db, "setlimit"):
        db.close()
        fail("cloud_python_runtime_unsupported")
    db.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 1024 * 1024)
    db.set_progress_handler(lambda: int(time.monotonic() > deadline), 10000)
    try:
        db.execute("PRAGMA query_only=ON")
        db.execute("BEGIN")  # One consistent WAL-aware read transaction.
        existing = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND sql NOT LIKE 'CREATE VIRTUAL%'")}
        cols = {t: {r[1] for r in db.execute("PRAGMA table_info(" + quoted(t) + ")")} for t in FIELDS if t in existing}
        if not {"id", "title", "artist"} <= cols.get("tracks", set()):
            fail("cloud_library_schema_unrecognized")
        omitted = list(OMISSIONS)
        excluded_ids = set()
        for table in ("peer_history", "device_group_history"):
            if table in existing:
                table_cols = {r[1] for r in db.execute("PRAGMA table_info(" + quoted(table) + ")")}
                if "session_id" not in table_cols:
                    fail("cloud_peer_schema_unrecognized")
                for row in db.execute("SELECT session_id FROM " + quoted(table)):
                    excluded_ids.add(row[0])
                    if len(excluded_ids) > 100000:
                        fail("cloud_peer_exclusion_limit")
        # Group identity denial depends on signed bodies and possession records,
        # not only denormalized projection IDs. Recovery is equivalent to the
        # app's verified selector; unreadable evidence fails the whole review.
        group_claims, own_group_operations = set(), 0
        if "device_group_operations" in existing or "device_group_possessions" in existing:
            group_claims, own_group_operations = group_denied_sessions(db, existing)
        excluded_sessions = set(group_claims)
        if "peer_sync_sessions" in existing:
            peer_cols = {r[1] for r in db.execute('PRAGMA table_info("peer_sync_sessions")')}
            if not {"session_uuid", "direction"} <= peer_cols:
                fail("cloud_peer_schema_unrecognized")
            for sid, direction in db.execute('SELECT session_uuid,direction FROM peer_sync_sessions'):
                if not isinstance(sid, str) or not sid or direction not in ("issued", "received"):
                    fail("cloud_peer_schema_unrecognized")
                if direction == "received":
                    excluded_sessions.add(sid)
                    if len(excluded_sessions) > 100000:
                        fail("cloud_peer_exclusion_limit")
        known_sessions = set()
        if "sessions" in existing:
            if not {"id", "uuid"} <= cols["sessions"]:
                fail("cloud_history_schema_unrecognized")
            for ident, sid in db.execute("SELECT id,uuid FROM sessions"):
                if not isinstance(sid, str) or not sid:
                    fail("cloud_history_schema_unrecognized")
                known_sessions.add(sid)
                if sid in excluded_sessions:
                    excluded_ids.add(ident)
                if ident in excluded_ids:
                    excluded_sessions.add(sid)
                if len(known_sessions) > 100000:
                    fail("cloud_history_provenance_limit")
        elif excluded_ids:
            fail("cloud_history_schema_unrecognized")
        excluded_takes, excluded_routine_takes, excluded_transitions, excluded_routines = set(), set(), set(), set()
        provenance = {"sessionless": 0, "pruned_local": 0}
        for table, destination, promoted in (("takes", excluded_takes, "promoted_transition_uuid"),
                                             ("routine_takes", excluded_routine_takes, "promoted_routine_uuid")):
            if table in existing:
                if not {"uuid", "session_uuid"} <= cols[table]:
                    fail("cloud_history_schema_unrecognized")
                select = ["uuid", "session_uuid"] + ([promoted] if promoted in cols[table] else [])
                for row in db.execute("SELECT " + ",".join(map(quoted, select)) + " FROM " + quoted(table)):
                    if row[1] and row[1] in excluded_sessions:
                        destination.add(row[0])
                        if len(row) > 2 and row[2]:
                            (excluded_transitions if table == "takes" else excluded_routines).add(row[2])
                    elif not row[1]:
                        # Pre-Sessions Takes are sessionless and local by
                        # construction (ADR 0020/0033): every peer/group bundle
                        # requires a manifest session_uuid, so a missing one can
                        # never be received evidence.
                        provenance["sessionless"] += 1
                    elif row[1] not in known_sessions:
                        # Received evidence is durable: peer_sync_sessions rows
                        # and signed group operations/possessions have no delete
                        # path, group Sessions cannot be deleted (deny_group_uuid)
                        # and the silent sweep exempts peer/group Sessions. A
                        # dangling reference is therefore a deleted local Session;
                        # Takes survive deletion by design (ADR 0033).
                        provenance["pruned_local"] += 1
        parts, counts, total, excluded = [], {}, 0, 0
        def emit(table, rows):
            nonlocal total
            body = encode({"schema": SCHEMA, "table": table, "rows": rows})
            size = len(body.encode())
            if size > MAX_PART or len(parts) >= MAX_PARTS or total + size > MAX_TOTAL:
                fail("cloud_snapshot_limit")
            parts.append(body); total += size
        for table, wanted in FIELDS.items():
            if time.monotonic() > deadline:
                fail("cloud_prepare_timeout")
            if table not in existing:
                omitted.append("Table not present: " + table)
                continue
            selected = [c for c in wanted if c in cols[table]]
            missing = [c for c in wanted if c not in cols[table]]
            if missing:
                omitted.append("Fields not present in " + table + ": " + ", ".join(missing))
            if not selected:
                continue
            if table == "session_chunks" and "session_id" not in selected:
                fail("cloud_history_schema_unrecognized")
            if table == "routines" and excluded_routine_takes and "origin_take_uuid" not in selected:
                fail("cloud_history_schema_unrecognized")
            order = [c for c in ("session_id", "seq", "id") if c in selected]
            query = "SELECT " + ",".join(map(quoted, selected)) + " FROM " + quoted(table)
            if order:
                query += " ORDER BY " + ",".join(map(quoted, order))
            batch, batch_size, counts[table] = [], 100, 0
            for record in db.execute(query):
                if time.monotonic() > deadline:
                    fail("cloud_prepare_timeout")
                row = dict(record)
                if ((table == "sessions" and row.get("id") in excluded_ids)
                    or (table == "session_chunks" and row.get("session_id") in excluded_ids)
                    or (table in ("takes", "routine_takes") and row.get("session_uuid") in excluded_sessions)
                    or (table in ("transitions", "cameos") and row.get("uuid") in excluded_transitions)
                    or (table == "routines" and (row.get("uuid") in excluded_routines or row.get("origin_take_uuid") in excluded_routine_takes))):
                    excluded += 1
                    continue
                value = {k: safe_value(v, k.endswith("_json")) for k, v in row.items()}
                size = len(encode(value).encode()) + 1
                if size + 100 > MAX_PART:
                    fail("cloud_metadata_row_limit")
                if batch and (batch_size + size > MAX_PART or len(batch) >= 4000):
                    emit(table, batch); batch, batch_size = [], 100
                batch.append(value); batch_size += size; counts[table] += 1
            if batch:
                emit(table, batch)
        if not counts.get("tracks"):
            fail("cloud_empty_library")
        omitted.append("Peer/group-related rows excluded: " + str(excluded))
        if group_claims:
            omitted.append("Group-claimed sessions excluded by signed evidence: " + str(len(group_claims)))
        if own_group_operations:
            omitted.append("Own verified group-published sessions included as local: " + str(own_group_operations))
        if provenance["sessionless"]:
            omitted.append("Pre-Sessions takes without a session included as local evidence: " + str(provenance["sessionless"]))
        if provenance["pruned_local"]:
            omitted.append("Takes from deleted local sessions included: " + str(provenance["pruned_local"]))
        return {"parts": parts, "rowCounts": counts, "omissions": omitted}
    except PreparationError:
        raise
    except (sqlite3.Error, ValueError, TypeError, RecursionError, OverflowError):
        fail("cloud_prepare_failed")
    finally:
        db.close()
