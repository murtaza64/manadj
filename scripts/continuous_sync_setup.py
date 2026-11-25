"""Local owner-only private-test setup. Public output only; never sends network.

Run against the app's normal data root. init creates one new local group/key;
pin adds an explicitly supplied own-device public key; identify binds selected
local rows. Existing keys/pins/bindings are never replaced or revoked here.
"""
import argparse
import json
from uuid import uuid4

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from backend.database import SessionLocal
from backend.peer_sync.group import GroupSync
from backend.peer_sync.service import PeerSync
from backend.peer_sync.contracts import GuardBody
from backend.continuous_sync.service import Replica
from backend.peer_sync.models import GroupMember
from sqlalchemy import select


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    sub.add_parser('init')
    pin = sub.add_parser('pin')
    pin.add_argument('--group', required=True)
    pin.add_argument('--origin', required=True)
    pin.add_argument('--public-key', required=True)
    identify = sub.add_parser('identify')
    identify.add_argument('--group', required=True)
    identify.add_argument('--track-ids', type=int, nargs='+', required=True)
    args = parser.parse_args()
    if args.action == 'init':
        with SessionLocal() as db:
            PeerSync(db).initialize()
        group = str(uuid4())
        with SessionLocal() as db:
            result = GroupSync(db, group).provision(Ed25519PrivateKey.generate().private_bytes_raw())
        print(json.dumps({'group': group, 'origin': result['device_id'], 'publicKey': result['public_key_b64']}))
    elif args.action == 'pin':
        with SessionLocal() as db:
            members = list(db.scalars(select(GroupMember).where(GroupMember.group_id == args.group, GroupMember.revoked == 0)))
            if len(members) >= 3 and args.origin not in {m.device_id for m in members}:
                parser.error('private trial allows at most three pinned members')
        with SessionLocal() as db:
            GroupSync(db, args.group).pin_member(args.origin, args.public_key, label='Explicit own test device')
        print('Public member pinned. No network started.')
    else:
        if not 1 <= len(args.track_ids) <= 25 or len(set(args.track_ids)) != len(args.track_ids):
            parser.error('select 1..25 distinct local track IDs')
        result = {}
        for local in args.track_ids:
            with SessionLocal() as db:
                selected = PeerSync(db).select_track(local)
            with SessionLocal() as db:
                bound = PeerSync(db).identify(local, GuardBody(guard=selected['guard']))
            logical = bound['logical_track_id']
            with SessionLocal() as db:
                Replica(db, args.group).enroll_track(logical)
            result[str(local)] = logical
        print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
