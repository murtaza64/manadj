"""Generated-only coverage for public iPhone provisioning export."""
import hashlib
from uuid import uuid4

import pytest

from backend.continuous_sync.provisioning import native_configuration
from backend.continuous_sync.service import SyncFailure
from tests.test_continuous_sync import pair
from tests.test_peer_session_exchange import instance


def test_native_public_configuration_exact_content_and_explicit_differing_ids(instance):
    a, _, group, identities, logical = pair(instance)
    with a.sessions() as db:
        config = native_configuration(db, group, identities[1]['device_id'], {logical: 93})
    assert config['group'] == group and config['origin'] == identities[1]['device_id']
    assert len(config['members']) == 3
    binding = config['bindings'][0]
    raw = (a.root / 'generated.wav').read_bytes()
    assert binding == {'logicalID': logical, 'localID': 93, 'contentSHA256': hashlib.sha256(raw).hexdigest(), 'byteLength': len(raw)}
    assert all(set(member) == {'origin', 'publicKey'} for member in config['members'])
    assert 'seed' not in repr(config) and 'filename' not in repr(config)
    with a.sessions() as db:
        assert native_configuration(db, group, identities[1]['device_id'], {logical: 93}) == config


def test_native_export_denies_unpinned_target_missing_binding_and_empty_selection(instance):
    a, _, group, identities, logical = pair(instance)
    for origin, selection, message in [
        (str(uuid4()), {logical: 9}, 'target_must_be_locally_pinned'),
        (identities[1]['device_id'], {str(uuid4()): 9}, 'selected_track_unavailable'),
        (identities[1]['device_id'], {}, 'select_one_to_25_tracks'),
        (identities[1]['device_id'], {logical: True}, 'unique_positive_phone_ids_required'),
    ]:
        with a.sessions() as db, pytest.raises(SyncFailure, match=message):
            native_configuration(db, group, origin, selection)
    (a.root / 'generated.wav').unlink()
    with a.sessions() as db, pytest.raises(SyncFailure, match='selected_audio_unavailable'):
        native_configuration(db, group, identities[1]['device_id'], {logical: 9})
