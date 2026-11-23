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
        # Group identity denial also depends on signed bodies and possession
        # records, not only denormalized projection IDs. Until the selective
        # exporter has equivalent verified recovery, fail the whole review when
        # any group operation/possession exists. Never reinterpret it as local.
        for table in ("device_group_operations", "device_group_possessions"):
            if table in existing and db.execute("SELECT 1 FROM " + quoted(table) + " LIMIT 1").fetchone():
                fail("cloud_group_provenance_review_required")
        excluded_sessions = set()
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
        for table, destination, promoted in (("takes", excluded_takes, "promoted_transition_uuid"),
                                             ("routine_takes", excluded_routine_takes, "promoted_routine_uuid")):
            if table in existing:
                if not {"uuid", "session_uuid"} <= cols[table]:
                    fail("cloud_history_schema_unrecognized")
                select = ["uuid", "session_uuid"] + ([promoted] if promoted in cols[table] else [])
                for row in db.execute("SELECT " + ",".join(map(quoted, select)) + " FROM " + quoted(table)):
                    # Legacy/sessionless or pruned-session evidence has no
                    # positive local provenance. Do not infer it from origin
                    # (detected/manual), tracks, timestamps or opaque events.
                    if not row[1] or (row[1] not in known_sessions and row[1] not in excluded_sessions):
                        fail("cloud_history_provenance_unresolved")
                    if row[1] in excluded_sessions:
                        destination.add(row[0])
                        if len(row) > 2 and row[2]:
                            (excluded_transitions if table == "takes" else excluded_routines).add(row[2])
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
        return {"parts": parts, "rowCounts": counts, "omissions": omitted}
    except PreparationError:
        raise
    except (sqlite3.Error, ValueError, TypeError, RecursionError, OverflowError):
        fail("cloud_prepare_failed")
    finally:
        db.close()
