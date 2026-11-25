"""Explicit local-only provisioning export. Does not start sync or enroll anyone.

Run with the application's normal MANADJ_DB_URL/data-root selection. The mapping
JSON is logical track UUID -> iPhone local integer ID, obtained locally. Output
contains public pins and selected content hashes only, never a private seed.
"""
import argparse
import json
import os
from pathlib import Path

from backend.continuous_sync.provisioning import native_configuration
from backend.database import SessionLocal


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--group', required=True)
    parser.add_argument('--phone-origin', required=True)
    parser.add_argument('--mapping', type=Path, required=True)
    parser.add_argument('--enroll-selected', action='store_true', help='Explicitly establish initial capture baselines for these selected tracks only, without network')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.mapping.stat().st_size > 65536:
        parser.error('mapping exceeds 64 KiB')
    selection = json.loads(args.mapping.read_bytes())
    with SessionLocal() as db:
        config = native_configuration(db, args.group, args.phone_origin, selection)
    if args.enroll_selected:
        from backend.continuous_sync.service import Replica
        for logical in selection:
            with SessionLocal() as db:
                Replica(db, args.group).enroll_track(logical)
    raw = json.dumps(config, separators=(',', ':'), sort_keys=True).encode()
    # Exclusive new file, private permissions; never overwrite another export.
    fd = os.open(args.output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'wb') as output:
        output.write(raw); output.flush(); os.fsync(output.fileno())
    print('Public configuration exported. Import on the selected phone to verify its audio bytes. Sync remains off.')


if __name__ == '__main__':
    main()
