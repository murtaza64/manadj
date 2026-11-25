"""Generated Apple CryptoKit/JavaScriptCore output, checked by Python protocol primitives.

No enrollment, user library, network, private keys, or mutation outside generated
files. Verifies codec interoperability, not client convergence or durable cursors.
"""
import base64
import json
import sys
from uuid import UUID

import rfc8785
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

value = json.load(open(sys.argv[1]))
key = Ed25519PublicKey.from_public_bytes(base64.b64decode(value['publicKey'], validate=True))
p = value['packet']
b = p['body']
assert set(p) == {'body', 'signature'}
assert set(b) == {'entity', 'field', 'format', 'generation', 'group_id', 'operation_id', 'origin_id', 'parents', 'sequence', 'value'}
for field in ['group_id', 'operation_id', 'origin_id']:
    assert str(UUID(b[field])) == b[field]
assert b['entity'].startswith('track:')
assert str(UUID(b['entity'][6:])) == b['entity'][6:]
assert b['format'] == 'manadj-continuous-sync/v1' and b['generation'] == 1
assert b['sequence'] == 1 and b['field'] == 'title' and b['parents'] == []
assert b['value'] == 'Generated native title'
sig = base64.b64decode(p['signature'], validate=True)
domain = b'manadj-continuous-sync/v1\0'
key.verify(sig, domain + rfc8785.dumps(b))
b['value'] = 'Changed after signing'
try:
    key.verify(sig, domain + rfc8785.dumps(b))
except InvalidSignature:
    pass
else:
    raise AssertionError('tampered native packet accepted')
print('APPLE_NATIVE_TO_PYTHON_SIGNATURE_CANONICAL_TYPED_VECTOR_PASS')
