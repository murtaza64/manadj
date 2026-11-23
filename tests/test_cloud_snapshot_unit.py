"""Synthetic SQLite fixtures only; no app/database initialization or real files."""
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from backend.cloud_snapshot import prepare_snapshot, PreparationError

class FrozenPreparation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="manadj-cloud-fixture-")
        self.path = Path(self.temp.name) / "synthetic.db"
        self.db = sqlite3.connect(self.path)
        self.db.executescript("""
            CREATE TABLE tracks(id INTEGER PRIMARY KEY,title TEXT,artist TEXT,bpm INTEGER,path TEXT,settings TEXT,audio BLOB);
            INSERT INTO tracks VALUES(1,'Synthetic title','Synthetic artist',12345,'/never/read/music.mp3','secret',X'1234');
            CREATE TABLE sessions(id INTEGER,uuid TEXT,started_at TEXT);
            INSERT INTO sessions VALUES(1,'local-session','2026-11-22');
            INSERT INTO sessions VALUES(2,'peer-session','2026-11-22');
            CREATE TABLE session_chunks(id INTEGER,session_id INTEGER,seq INTEGER,events_json TEXT);
            INSERT INTO session_chunks VALUES(1,1,0,'[{"t":1.5,"kind":"load","trackId":1}]');
            INSERT INTO session_chunks VALUES(2,2,0,'[{"t":2,"kind":"load","trackId":2}]');
            CREATE TABLE peer_history(session_id INTEGER);
            INSERT INTO peer_history VALUES(2);
            CREATE TABLE takes(id INTEGER,uuid TEXT,session_uuid TEXT,promoted_transition_uuid TEXT);
            INSERT INTO takes VALUES(1,'local-take','local-session','local-transition');
            INSERT INTO takes VALUES(2,'peer-take','peer-session','peer-transition');
            CREATE TABLE transitions(id INTEGER,uuid TEXT,name TEXT);
            INSERT INTO transitions VALUES(1,'local-transition','local');
            INSERT INTO transitions VALUES(2,'peer-transition','peer');
            CREATE TABLE routine_takes(id INTEGER,uuid TEXT,session_uuid TEXT,promoted_routine_uuid TEXT);
            INSERT INTO routine_takes VALUES(1,'local-routine-take','local-session','local-routine');
            INSERT INTO routine_takes VALUES(2,'peer-routine-take','peer-session','peer-routine');
            CREATE TABLE routines(id INTEGER,uuid TEXT,origin_take_uuid TEXT,name TEXT);
            INSERT INTO routines VALUES(1,'local-routine','local-routine-take','local');
            INSERT INTO routines VALUES(2,'peer-routine','peer-routine-take','peer');
        """)
        self.db.commit()
    def tearDown(self):
        self.db.close(); self.temp.cleanup()
    def rows(self, value):
        return {json.loads(p)["table"]: json.loads(p)["rows"] for p in value["parts"]}
    def test_read_only_frozen_allowlisted_local_rows_and_peer_derivative_exclusion(self):
        before = hashlib.sha256(self.path.read_bytes()).hexdigest()
        value = prepare_snapshot(self.path); rows = self.rows(value)
        self.assertEqual(before, hashlib.sha256(self.path.read_bytes()).hexdigest())
        self.assertEqual(rows['tracks'], [{'id':1,'title':'Synthetic title','artist':'Synthetic artist','bpm':12345}])
        self.assertEqual(rows['sessions'][0]['uuid'], 'local-session'); self.assertEqual(len(rows['sessions']),1)
        self.assertEqual(rows['session_chunks'][0]['events_json'][0]['t'],1.5)
        for table in ('takes','transitions','routine_takes','routines'):
            self.assertEqual(len(rows[table]),1)
            self.assertNotIn('peer-',json.dumps(rows[table]))
        self.assertNotIn('/never/read',json.dumps(value)); self.assertNotIn('settings',json.dumps(rows))
        self.assertTrue(any('Peer/group-related rows excluded: 6' == x for x in value['omissions']))
    def test_wal_visible_consistent_data_without_immutable_shortcut(self):
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute("UPDATE tracks SET title='WAL fixture'"); self.db.commit()
        self.assertEqual(self.rows(prepare_snapshot(self.path))['tracks'][0]['title'],'WAL fixture')
    def test_missing_path_never_creates_database(self):
        target=Path(self.temp.name)/'missing.db'
        with self.assertRaisesRegex(PreparationError,'personal_sqlite'):prepare_snapshot(target)
        self.assertFalse(target.exists())
    def test_unknown_schema_and_empty_library_fail(self):
        self.db.execute('DELETE FROM tracks');self.db.commit()
        with self.assertRaisesRegex(PreparationError,'empty_library'):prepare_snapshot(self.path)
        self.db.execute('DROP TABLE tracks');self.db.commit()
        with self.assertRaisesRegex(PreparationError,'schema_unrecognized'):prepare_snapshot(self.path)
    def test_secret_path_url_labels_fail_visibly_no_silent_redaction(self):
        for value in ['/Users/example/music/file.mp3','C:\\Music\\file.mp3','api_key=synthetic','https://example.invalid','x'*2049]:
            self.db.execute('UPDATE tracks SET title=?',(value,));self.db.commit()
            with self.assertRaises(PreparationError):prepare_snapshot(self.path)
    def test_nonfinite_and_unsafe_numbers_fail(self):
        for value in [float('inf'),9007199254740992]:
            self.db.execute('UPDATE tracks SET bpm=?',(value,));self.db.commit()
            with self.assertRaises(PreparationError):prepare_snapshot(self.path)
    def test_invalid_structured_json_fails(self):
        self.db.execute("UPDATE session_chunks SET events_json='not json' WHERE session_id=1");self.db.commit()
        with self.assertRaises(PreparationError):prepare_snapshot(self.path)
    def test_oversize_row_fails_instead_of_truncation(self):
        value=json.dumps([{'t':i,'kind':'load','trackId':1} for i in range(10000)])
        self.db.execute('UPDATE session_chunks SET events_json=? WHERE session_id=1',(value,));self.db.commit()
        with self.assertRaisesRegex(PreparationError,'structured_metadata|row_limit'):prepare_snapshot(self.path)
    def test_timeout_fails_closed(self):
        with self.assertRaisesRegex(PreparationError,'timeout|prepare_failed'):prepare_snapshot(self.path,timeout_seconds=-1)
    def test_unrecognized_peer_exclusion_schema_fails_closed(self):
        self.db.execute('DROP TABLE peer_history');self.db.execute('CREATE TABLE peer_history(other INTEGER)');self.db.commit()
        with self.assertRaisesRegex(PreparationError,'peer_schema'):prepare_snapshot(self.path)
    def test_sessionless_and_pruned_local_takes_included_with_explicit_counts(self):
        self.db.execute("INSERT INTO takes VALUES(3,'other-local','local-session',NULL)")
        for sid, note in ((None, "Pre-Sessions takes without a session included as local evidence: 1"),
                          ("", "Pre-Sessions takes without a session included as local evidence: 1"),
                          ("removed-session", "Takes from deleted local sessions included: 1")):
            self.db.execute("UPDATE takes SET session_uuid=? WHERE id=1", (sid,));self.db.commit()
            value = prepare_snapshot(self.path); rows = self.rows(value)
            self.assertEqual(len(rows['takes']), 2)
            self.assertTrue(any(x == note for x in value['omissions']), value['omissions'])
        self.db.execute("DELETE FROM takes WHERE id=1");self.db.commit()
    def test_durable_received_peer_identity_excludes_after_projection_removal(self):
        self.db.execute("CREATE TABLE peer_sync_sessions(session_uuid TEXT,direction TEXT)")
        self.db.execute("INSERT INTO peer_sync_sessions VALUES('peer-session','received')")
        self.db.execute("DELETE FROM peer_history");self.db.commit()
        rows=self.rows(prepare_snapshot(self.path))
        for table in ('sessions','session_chunks','takes','transitions','routine_takes','routines'):
            self.assertEqual(len(rows[table]),1)
        self.db.execute("DELETE FROM sessions WHERE uuid='peer-session'");self.db.commit()
        self.assertEqual(len(self.rows(prepare_snapshot(self.path))['takes']),1)
    def test_unknown_peer_direction_fails_not_local_fallback(self):
        self.db.execute("CREATE TABLE peer_sync_sessions(session_uuid TEXT,direction TEXT)")
        self.db.execute("INSERT INTO peer_sync_sessions VALUES('peer-session','unknown')");self.db.commit()
        with self.assertRaisesRegex(PreparationError, "peer_schema"):prepare_snapshot(self.path)
    def _group_tables(self):
        self.db.executescript("""
            CREATE TABLE device_groups(group_id TEXT,device_id TEXT,private_seed_b64 TEXT);
            CREATE TABLE device_group_members(group_id TEXT,device_id TEXT,public_key_b64 TEXT,revoked INTEGER);
            CREATE TABLE device_group_operations(cursor INTEGER PRIMARY KEY AUTOINCREMENT,group_id TEXT,operation_id TEXT,
                origin_device_id TEXT,session_uuid TEXT,sha256 TEXT,body_b64 TEXT,signature_b64 TEXT);
            CREATE TABLE device_group_possessions(group_id TEXT,operation_id TEXT,device_id TEXT,sha256 TEXT,
                proof_body_b64 TEXT,proof_signature_b64 TEXT);
            CREATE TABLE peer_sync_local(id INTEGER,replica_id TEXT);
            CREATE TABLE peer_sync_sessions(session_uuid TEXT,direction TEXT);
        """)
        self.db.commit()
    def _signed_operation(self, seed_offset, origin, session_uuid, operation_id):
        import rfc8785, hashlib, base64, json as _json
        from backend.peer_sync.group_contracts import sign
        from scripts.group_session_fixture import fixture
        body = _json.loads(fixture()["body_utf8"])
        body["origin_device_id"] = origin; body["operation_id"] = operation_id
        body["bundle"]["manifest"]["session_uuid"] = session_uuid
        body["bundle"]["manifest"]["origin_replica_id"] = origin
        signed = sign(body, bytes(range(seed_offset, seed_offset + 32)))
        return {"sha256": hashlib.sha256(rfc8785.dumps(body)).hexdigest(),
                "body_b64": base64.b64encode(rfc8785.dumps(body)).decode(), "signature_b64": signed.signature_b64,
                "signed": signed, "body": body}
    GROUP = "33333333-3333-4333-8333-333333333333"
    OWN = "11111111-1111-4111-8111-111111111111"
    PEER = "22222222-2222-4222-8222-222222222222"
    OWN_SESSION = "55555555-5555-4555-8555-555555555555"
    PEER_SESSION = "99999999-9999-4999-8999-999999999999"
    def _enroll_group(self):
        from backend.peer_sync.group_contracts import encode
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        self._group_tables()
        own_public = Ed25519PrivateKey.from_private_bytes(bytes(range(32))).public_key().public_bytes_raw()
        peer_public = Ed25519PrivateKey.from_private_bytes(bytes(range(32, 64))).public_key().public_bytes_raw()
        self.db.execute("INSERT INTO device_groups VALUES(?,?,?)", (self.GROUP, self.OWN, encode(bytes(range(32)))))
        self.db.execute("INSERT INTO device_group_members VALUES(?,?,?,0)", (self.GROUP, self.OWN, encode(own_public)))
        self.db.execute("INSERT INTO device_group_members VALUES(?,?,?,0)", (self.GROUP, self.PEER, encode(peer_public)))
        self.db.execute("INSERT INTO peer_sync_local VALUES(1,?)", (self.OWN,))
        self.db.execute("INSERT INTO sessions VALUES(3,?,'2026-11-22')", (self.OWN_SESSION,))
        self.db.execute("INSERT INTO session_chunks VALUES(3,3,0,'[{\"t\":1,\"kind\":\"load\",\"trackId\":1}]')")
        self.db.execute("INSERT INTO takes VALUES(3,'own-take',?,NULL)", (self.OWN_SESSION,))
        self.db.execute("INSERT INTO sessions VALUES(4,?,'2026-11-22')", (self.PEER_SESSION,))
        self.db.execute("INSERT INTO session_chunks VALUES(4,4,0,'[{\"t\":1,\"kind\":\"load\",\"trackId\":1}]')")
        self.db.execute("INSERT INTO takes VALUES(4,'group-take',?,NULL)", (self.PEER_SESSION,))
        self.db.commit()
    def test_group_signed_evidence_excludes_foreign_and_keeps_own_verified(self):
        self._enroll_group()
        own = self._signed_operation(0, self.OWN, self.OWN_SESSION, "44444444-4444-4444-8444-444444444444")
        peer = self._signed_operation(32, self.PEER, self.PEER_SESSION, "77777777-7777-4777-8777-777777777777")
        for op in (own, peer):
            self.db.execute("INSERT INTO device_group_operations(group_id,operation_id,origin_device_id,session_uuid,sha256,body_b64,signature_b64)"
                            " VALUES(?,?,?,?,?,?,?)", (op["body"]["group_id"], op["body"]["operation_id"],
                            op["body"]["origin_device_id"], op["body"]["bundle"]["manifest"]["session_uuid"],
                            op["sha256"], op["body_b64"], op["signature_b64"]))
        self.db.commit()
        value = prepare_snapshot(self.path); rows = self.rows(value)
        sessions = [r["uuid"] for r in rows["sessions"]]
        self.assertIn(self.OWN_SESSION, sessions); self.assertNotIn(self.PEER_SESSION, sessions)
        take_ids = [r["uuid"] for r in rows["takes"]]
        self.assertIn("own-take", take_ids); self.assertNotIn("group-take", take_ids)
        self.assertTrue(any(x == "Own verified group-published sessions included as local: 1" for x in value["omissions"]))
        self.assertTrue(any(x == "Group-claimed sessions excluded by signed evidence: 1" for x in value["omissions"]))
    def test_group_evidence_denies_even_when_signature_never_verifies(self):
        self._enroll_group()
        peer = self._signed_operation(32, self.PEER, self.PEER_SESSION, "77777777-7777-4777-8777-777777777777")
        import base64
        bad = dict(peer); bad["signature_b64"] = base64.b64encode(b"x" * 64).decode()
        self.db.execute("INSERT INTO device_group_operations(group_id,operation_id,origin_device_id,session_uuid,sha256,body_b64,signature_b64)"
                        " VALUES(?,?,?,?,?,?,?)", (self.GROUP, peer["body"]["operation_id"], self.PEER,
                        self.PEER_SESSION, peer["sha256"], peer["body_b64"], bad["signature_b64"]))
        self.db.commit()
        rows = self.rows(prepare_snapshot(self.path))
        self.assertNotIn(self.PEER_SESSION, [r["uuid"] for r in rows["sessions"]])
    def test_group_possession_proof_alone_denies_its_session(self):
        self._enroll_group()
        peer = self._signed_operation(32, self.PEER, self.PEER_SESSION, "77777777-7777-4777-8777-777777777777")
        from backend.peer_sync.group_contracts import sign
        delivery = {"format": "manadj-device-group/v1", "group_id": self.GROUP, "origin_device_id": self.PEER,
                    "kind": "deliver", "recipient_device_id": self.OWN, "operation": peer["signed"].model_dump()}
        proof = sign(delivery, bytes(range(32, 64)))
        self.db.execute("INSERT INTO device_group_possessions VALUES(?,?,?,?,?,?)",
                        (self.GROUP, peer["body"]["operation_id"], self.PEER, peer["sha256"], proof.body_b64, proof.signature_b64))
        self.db.commit()
        rows = self.rows(prepare_snapshot(self.path))
        self.assertNotIn(self.PEER_SESSION, [r["uuid"] for r in rows["sessions"]])
        self.assertNotIn("group-take", [r["uuid"] for r in rows["takes"]])
    def test_unreadable_group_evidence_fails_visibly_never_local(self):
        self._enroll_group()
        import base64
        self.db.execute("INSERT INTO device_group_operations(group_id,operation_id,origin_device_id,session_uuid,sha256,body_b64,signature_b64)"
                        " VALUES(?,?,?,?,?,?,?)", (self.GROUP, "77777777-7777-4777-8777-777777777777", self.PEER,
                        "not-a-uuid", "0" * 64, base64.b64encode(b"garbage").decode(), base64.b64encode(b"x" * 64).decode()))
        self.db.commit()
        with self.assertRaisesRegex(PreparationError, "group_evidence_unreadable"): prepare_snapshot(self.path)
        self.db.execute("DELETE FROM device_group_operations")
        self.db.execute("INSERT INTO device_group_possessions VALUES(?,?,?,?,?,?)",
                        (self.GROUP, "77777777-7777-4777-8777-777777777777", self.PEER, "0" * 64,
                         base64.b64encode(b"garbage").decode(), base64.b64encode(b"x" * 64).decode()))
        self.db.commit()
        with self.assertRaisesRegex(PreparationError, "group_evidence_unreadable"): prepare_snapshot(self.path)
    def test_parts_are_bounded_and_all_rows_preserved(self):
        self.db.executemany('INSERT INTO tracks(id,title,artist,bpm) VALUES(?,?,?,?)',[(i,'x'*1000,'a',10000) for i in range(2,902)])
        self.db.commit();value=prepare_snapshot(self.path)
        parts=[json.loads(p) for p in value['parts'] if json.loads(p)['table']=='tracks']
        self.assertGreater(len(parts),1);self.assertEqual(sum(len(x['rows']) for x in parts),901)
        self.assertTrue(all(len(p.encode())<=250000 for p in value['parts']))
        self.assertEqual(value['rowCounts']['tracks'],901)

if __name__=='__main__':unittest.main()
