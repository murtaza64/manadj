#!/usr/bin/env python3
"""Bound one Apple test stage and preserve process samples on a stall.

Only samples this stage's descendants on an isolated test runner. A timeout is
always a failure, never a skip or a successful verification.
"""
import os
from pathlib import Path
import signal
import subprocess
import sys

seconds = int(sys.argv[1])
command = sys.argv[2:]
output = Path('ios/.test-results/stall-diagnostics')
output.mkdir(parents=True, exist_ok=True)
process = subprocess.Popen(command, start_new_session=True,
                           env={**os.environ, 'NSUnbufferedIO': 'YES'})
try:
    raise SystemExit(process.wait(timeout=seconds))
except subprocess.TimeoutExpired:
    print(f'Apple test stage stalled after {seconds}s: {command[0]}', flush=True)
    listing = subprocess.run(['ps', '-axo', 'pid=,ppid=,comm='], capture_output=True, text=True)
    (output / 'processes.txt').write_text(listing.stdout)
    rows = [line.strip().split(None, 2) for line in listing.stdout.splitlines()]
    descendants = {process.pid}
    for _ in range(len(rows)):
        for row in rows:
            if len(row) == 3 and int(row[1]) in descendants:
                descendants.add(int(row[0]))
    for pid in sorted(descendants):
        with (output / f'sample-{pid}.txt').open('w') as target:
            try:
                subprocess.run(['sample', str(pid), '3'], stdout=target, stderr=subprocess.STDOUT, timeout=15)
            except (OSError, subprocess.TimeoutExpired) as error:
                target.write(type(error).__name__ + '\n')
    os.killpg(process.pid, signal.SIGKILL)
    process.wait()
    raise SystemExit(124)
