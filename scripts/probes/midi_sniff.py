#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["mido>=1.3", "python-rtmidi"]
# ///
"""GRV6 MIDI sniffer (four-deck 34). Polls for MIDI ports and logs every
message with monotonic timestamps; hot-plug aware so it can be started
BEFORE the controller is connected to capture the power-on burst.

Usage: uv run .probe/midi-sniff.py [--filter GRV6] [--out FILE]
Ctrl-C to stop.
"""
import argparse, sys, time
import mido

ap = argparse.ArgumentParser()
ap.add_argument("--filter", default="", help="substring filter on port name")
ap.add_argument("--out", default="", help="also append to file")
args = ap.parse_args()

out = open(args.out, "a") if args.out else None
def log(line: str) -> None:
    stamp = f"{time.monotonic():12.4f}"
    text = f"{stamp} {line}"
    print(text, flush=True)
    if out:
        out.write(text + "\n"); out.flush()

open_ports: dict[str, object] = {}
log(f"sniffer up; waiting for ports matching {args.filter!r} (plug in now)")
try:
    while True:
        names = [n for n in mido.get_input_names() if args.filter.lower() in n.lower()]
        for name in names:
            if name not in open_ports:
                def make_cb(port_name):
                    def cb(msg):
                        log(f"[{port_name}] {msg.hex() if msg.type == 'sysex' else msg}")
                    return cb
                try:
                    open_ports[name] = mido.open_input(name, callback=make_cb(name))
                    log(f"OPENED input: {name}")
                except Exception as e:
                    log(f"open failed for {name}: {e}")
        for name in list(open_ports):
            if name not in mido.get_input_names():
                log(f"port GONE: {name}")
                try: open_ports.pop(name).close()
                except Exception: pass
        time.sleep(0.25)
except KeyboardInterrupt:
    log("sniffer stopped")
