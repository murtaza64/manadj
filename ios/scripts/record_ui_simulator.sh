#!/usr/bin/env bash
# Record the device actually running the UI-test runner, including Xcode clone simulators.
set -u
STOP=$1
OUT=$2
VIDEO_PID=''
cleanup() { if [[ -n "$VIDEO_PID" ]]; then kill -INT "$VIDEO_PID" 2>/dev/null || true; wait "$VIDEO_PID" || true; fi; }
trap cleanup EXIT TERM INT
for ((attempt=0; attempt<480; attempt++)); do
  [[ -f "$STOP" ]] && exit 0
  while read -r udid; do
    [[ -z "$udid" ]] && continue
    processes=$(xcrun simctl spawn "$udid" launchctl list 2>&1)
    if grep -q 'earth.murtaza.manadj.ios.ManadjUITests' <<<"$processes"; then
      printf 'UI test runner device: %s\n' "$udid" > "${OUT%.mp4}-device.txt"
      printf '%s\n' "$processes" >> "${OUT%.mp4}-device.txt"
      xcrun simctl io "$udid" recordVideo --codec=h264 "$OUT" &
      VIDEO_PID=$!
      for ((tick=0; tick<2400; tick++)); do
        [[ -f "$STOP" ]] && exit 0
        kill -0 "$VIDEO_PID" 2>/dev/null || exit 0
        sleep 0.5
      done
      exit 0
    fi
  done < <(xcrun simctl list devices booted --json | python3 -c 'import json,sys; print("\n".join(d["udid"] for group in json.load(sys.stdin)["devices"].values() for d in group if d["state"]=="Booted"))')
  sleep 0.5
done
printf '%s\n' 'No running manaDJ UI-test runner found. No recording claimed.'
