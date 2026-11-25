"""Relay durability/CAS contract. Generated packets, no personal endpoints."""
import copy
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest

from backend.continuous_sync.relay import Relay
from backend.continuous_sync.service import SyncFailure


def packet(group, origin, sequence, value):
    return {'body': {'group_id': group, 'origin_id': origin, 'sequence': sequence, 'operation_id': str(uuid4()), 'value': value},
            'signature': 'generated-fixture-not-authentication'}


def test_concurrent_origin_append_exact_retry_and_conflicting_bytes(tmp_path):
    group, origin = str(uuid4()), str(uuid4())
    path = tmp_path / 'relay.db'
    relay = Relay(path)
    same = packet(group, origin, 1, 'same')
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda _: Relay(path).publish(group, origin, 1, 0, same), range(8)))
    assert Relay(path).head(group, origin) == 1
    assert Relay(path).read(group, origin, 0, 32)['operations'] == [same]
    conflict = copy.deepcopy(same); conflict['body']['value'] = 'different'
    with pytest.raises(SyncFailure, match='immutable_append_conflict'):
        relay.publish(group, origin, 1, 0, conflict)
    with pytest.raises(SyncFailure, match='head_compare_failed'):
        relay.publish(group, origin, 3, 2, packet(group, origin, 3, 'gap'))
    assert Relay(path).head(group, origin) == 1


def test_failed_transaction_exposes_neither_operation_nor_head(tmp_path):
    group, origin = str(uuid4()), str(uuid4())
    relay = Relay(tmp_path / 'relay.db')
    with pytest.raises(RuntimeError):
        with relay.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('INSERT INTO operations VALUES(?,?,?,?,?)', (group, origin, 1, b'generated', str(uuid4())))
            raise RuntimeError('fixture crash')
    assert relay.head(group, origin) == 0
    assert relay.read(group, origin, 0, 32)['operations'] == []


def test_aggregate_byte_page_and_uuid_reuse_do_not_truncate(tmp_path):
    group, origin = str(uuid4()), str(uuid4())
    relay = Relay(tmp_path / 'relay.db')
    first = packet(group, origin, 1, 'x' * (150 * 1024))
    second = packet(group, origin, 2, 'y' * (150 * 1024))
    relay.publish(group, origin, 1, 0, first)
    relay.publish(group, origin, 2, 1, second)
    page = relay.read(group, origin, 0, 32)
    assert page == {'operations': [first], 'nextAfter': 1, 'more': True}
    assert relay.read(group, origin, 1, 32) == {'operations': [second], 'nextAfter': 2, 'more': False}
    reused = packet(group, origin, 3, 'new'); reused['body']['operation_id'] = first['body']['operation_id']
    with pytest.raises(SyncFailure, match='operation_uuid_reused'):
        relay.publish(group, origin, 3, 2, reused)
    with relay.connect() as db:
        db.execute('DELETE FROM operations WHERE seq=1')
    with pytest.raises(SyncFailure, match='committed_log_gap'):
        relay.read(group, origin, 0, 32)


def test_worker_backoff_and_idle_are_bounded_without_payload_logging(caplog):
    from backend.continuous_sync.worker import Worker
    class Pump:
        def tick(self, limit):
            raise RuntimeError('private-payload-and-token')
    worker = Worker(Pump())
    delays = [worker.step() for _ in range(12)]
    assert delays[0] == 10 and max(delays) == 300
    assert 'private-payload-and-token' not in caplog.text
    worker.pump.tick = lambda limit: {'published': 0, 'applied': 0}
    assert worker.step() == 60 and worker.failures == 0
    worker.pump.tick = lambda limit: {'published': 1, 'applied': 0}
    assert worker.step() == 5
    worker.start(); worker.stop()
    assert worker.state == 'stopped'
