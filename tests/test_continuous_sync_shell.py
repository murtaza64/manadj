from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.continuous_sync.shell import install, PATH
from tests.test_continuous_sync import pair
from tests.test_peer_session_exchange import instance


def test_managed_shell_controls_actual_replica_without_exposing_secrets(instance):
    a, _, gid, ids, logical = pair(instance)
    app = FastAPI(); install(app, 'generated-shell-token', a.sessions)
    client = TestClient(app, client=('127.0.0.1', 12345))
    body = {'group': gid, 'action': 'plan'}
    assert client.post(PATH, json=body).status_code == 403
    headers = {'x-manadj-shell-token': 'generated-shell-token'}
    assert client.post(PATH, json=body, headers={**headers, 'origin': 'http://localhost'}).status_code == 403
    result = client.post(PATH, json=body, headers=headers)
    assert result.status_code == 200
    plan = result.json()
    assert plan['local'] == ids[0]['device_id'] and plan['latest'] == 0
    assert len(plan['origins']) == 3 and set(plan['cursors'].values()) == {0}
    assert 'private' not in result.text and 'seed' not in result.text
    assert client.post(PATH, json={'group': gid, 'action': 'capture'}, headers=headers).status_code == 200
    assert client.post(PATH, json={'group': gid, 'action': 'packets', 'origin': ids[1]['device_id'], 'after': 0}, headers=headers).status_code == 409
    assert client.post(PATH, json={**body, 'url': 'https://not-allowed.invalid'}, headers=headers).status_code == 409
