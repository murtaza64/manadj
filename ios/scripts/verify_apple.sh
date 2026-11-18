#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT/.."
command -v xcodebuild
command -v xcrun
python3 ios/scripts/generate_project.py
swift test --package-path ios/Packages/ManadjCore
swift test --package-path ios/Packages/ManadjAudio
HOST_ARCH=$(uname -m)
SDK_VERSION=$(xcrun --sdk iphonesimulator --show-sdk-version)
xcodebuild -project ios/Manadj.xcodeproj -scheme Manadj -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/.derived-data \
  CODE_SIGNING_ALLOWED=NO ONLY_ACTIVE_ARCH=YES ARCHS="$HOST_ARCH" build
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
        print(phones[0]["udid"]); break
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
xcrun simctl io "$DESTINATION_UDID" recordVideo --codec=h264 ios/.test-results/native-ui-temporal.mp4 > ios/.test-results/video.log 2>&1 &
VIDEO_PID=$!
trap 'kill -INT "$VIDEO_PID" 2>/dev/null || true; wait "$VIDEO_PID" || true' EXIT
xcodebuild -project ios/Manadj.xcodeproj -scheme Manadj -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=$DESTINATION_UDID" -derivedDataPath ios/.derived-data \
  -resultBundlePath "$RESULT" CODE_SIGNING_ALLOWED=NO ONLY_ACTIVE_ARCH=YES ARCHS="$HOST_ARCH" test
printf '\n%s\n' "Apple verification completed. Open $RESULT in Xcode to inspect tests and actual simulator screenshots."
