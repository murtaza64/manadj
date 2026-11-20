#!/usr/bin/env python3
"""Keep the real synthetic-only desktop listener alive through native Apple tests."""
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
resource = root / 'ios/Manadj/Resources/lan-fixture.json'
process = subprocess.Popen([sys.executable, str(root / 'tests/lan_fixture/serve.py'), '--seconds', '1500', '--live'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
try:
    line = process.stdout.readline()
    if not line:
        raise RuntimeError('Real desktop fixture failed before announcing readiness')
    descriptor = json.loads(line)
    assert descriptor['origin'].startswith('http://127.0.0.1:')
    # Pairing secret and token are not bundled or logged. Request/approval flow is mandatory.
    descriptor.pop('pair_code', None)
    resource.write_text(json.dumps(descriptor))
    print('Real desktop listener ready with one synthetic track', flush=True)
    raise SystemExit(subprocess.call(['bash', 'ios/scripts/verify_apple.sh'], cwd=root))
finally:
    resource.unlink(missing_ok=True)
    process.terminate()
    try: process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill(); process.wait()
