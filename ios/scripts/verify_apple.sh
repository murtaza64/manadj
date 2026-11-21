#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT/.."
command -v xcodebuild
command -v xcrun
python3 ios/scripts/generate_project.py
python3 ios/scripts/bounded_apple_check.py 180 swift test --package-path ios/Packages/ManadjCore
python3 ios/scripts/bounded_apple_check.py 180 swift test --package-path ios/Packages/ManadjAudio
HOST_ARCH=$(uname -m)
SDK_VERSION=$(xcrun --sdk iphonesimulator --show-sdk-version)
xcodebuild -project ios/Manadj.xcodeproj -scheme Manadj -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/.derived-data \
  CODE_SIGNING_ALLOWED=NO ONLY_ACTIVE_ARCH=YES ARCHS="$HOST_ARCH" build
# Device-SDK compilation catches target-only compiler/linker failures. It is
# unsigned and cannot be installed; no team, account or provisioning is used.
xcodebuild -project ios/Manadj.xcodeproj -scheme Manadj -sdk iphoneos \
  -destination 'generic/platform=iOS' -derivedDataPath "${TMPDIR:-/tmp}/manadj-device-derived-data" \
  CODE_SIGNING_ALLOWED=NO ARCHS=arm64 build
if [[ -z "${DESTINATION_UDID:-}" ]]; then
  DESTINATION_UDID=$(xcrun simctl list devices available --json | python3 -c '
import json,sys,re
r=json.load(sys.stdin)["devices"]
sdk=tuple(map(int,sys.argv[1].split(".")))
for runtime in sorted(r, key=lambda x: tuple(map(int,re.findall(r"\d+",x))), reverse=True):
    version=tuple(map(int,re.findall(r"\d+",runtime)))
    if "iOS" not in runtime or version > sdk: continue
    phones=[d for d in r[runtime] if d.get("isAvailable") and d["name"].startswith("iPhone")]
    if phones:
        phone=next((d for d in phones if d["name"] == "iPhone 16"), phones[0])
        print(phone["udid"]); break
' "$SDK_VERSION")
fi
if [[ -z "$DESTINATION_UDID" ]]; then
  printf '%s\n' 'No available iPhone simulator. Install an iOS runtime in Xcode Settings > Platforms.' >&2
  exit 1
fi
RESULT="ios/.test-results/Manadj-$(date +%Y%m%d-%H%M%S).xcresult"
mkdir -p ios/.test-results
xcrun simctl boot "$DESTINATION_UDID" || true
xcrun simctl bootstatus "$DESTINATION_UDID" -b
STOP="$PWD/ios/.test-results/recording-stop"
rm -f "$STOP"
bash ios/scripts/record_ui_simulator.sh "$STOP" "$PWD/ios/.test-results/actual-ui-runner.mp4" > ios/.test-results/record-ui.log 2>&1 &
MONITOR_PID=$!
trap 'touch "$STOP"; wait "$MONITOR_PID" || true' EXIT
PRIMARY_STATUS=0
xcodebuild -project ios/Manadj.xcodeproj -scheme Manadj -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=$DESTINATION_UDID" -derivedDataPath ios/.derived-data \
  -parallel-testing-enabled NO -maximum-concurrent-test-simulator-destinations 1 -resultBundlePath "$RESULT" CODE_SIGNING_ALLOWED=NO ONLY_ACTIVE_ARCH=YES ARCHS="$HOST_ARCH" test || PRIMARY_STATUS=$?
touch "$STOP"
wait "$MONITOR_PID" || true
trap - EXIT
# Optional compact-phone checks include interaction geometry and actual workspace screenshots.
SMALL_STATUS=0
if [[ "${CHECK_COMPACT_PHONE:-0}" == "1" ]]; then
  SMALL_UDID=$(xcrun simctl list devices available --json | python3 -c '
import json,sys
for group in json.load(sys.stdin)["devices"].values():
    for device in group:
        if device.get("isAvailable") and device["name"] == "iPhone SE (3rd generation)":
            print(device["udid"]); raise SystemExit
')
  if [[ -n "$SMALL_UDID" ]]; then
    xcrun simctl shutdown "$DESTINATION_UDID" || true
    xcrun simctl boot "$SMALL_UDID" || true
    xcrun simctl bootstatus "$SMALL_UDID" -b
    xcodebuild -project ios/Manadj.xcodeproj -scheme Manadj -sdk iphonesimulator \
      -parallel-testing-enabled NO -maximum-concurrent-test-simulator-destinations 1 \
      -destination "platform=iOS Simulator,id=$SMALL_UDID" -derivedDataPath ios/.derived-data \
      -only-testing:ManadjUITests/WorkspaceUITests/testCompactFixedTargetsAndScrollableMixerReview -only-testing:ManadjUITests/WorkspaceUITests/testKnobDetentFullscreenAndSquarePads \
      -resultBundlePath ios/.test-results/SmallPhone.xcresult CODE_SIGNING_ALLOWED=NO ONLY_ACTIVE_ARCH=YES ARCHS="$HOST_ARCH" test || SMALL_STATUS=$?
  fi
fi
printf '\n%s\n' "Apple verification completed. Open $RESULT in Xcode to inspect tests and actual simulator screenshots."

if (( PRIMARY_STATUS != 0 || SMALL_STATUS != 0 )); then exit 1; fi
