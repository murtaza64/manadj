#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT/.."
command -v xcodebuild
command -v xcrun
python3 ios/scripts/generate_project.py
swift test --package-path ios/Packages/ManadjCore
swift test --package-path ios/Packages/ManadjAudio
xcodebuild -project ios/Manadj.xcodeproj -scheme Manadj -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/.derived-data \
  CODE_SIGNING_ALLOWED=NO build
if [[ -z "${DESTINATION_UDID:-}" ]]; then
  DESTINATION_UDID=$(xcrun simctl list devices available --json | python3 -c '
import json,sys,re
r=json.load(sys.stdin)["devices"]
for runtime in sorted(r, key=lambda x: tuple(map(int,re.findall(r"\d+",x))), reverse=True):
    phones=[d for d in r[runtime] if d.get("isAvailable") and d["name"].startswith("iPhone")]
    if phones:
        print(phones[0]["udid"]); break
')
fi
if [[ -z "$DESTINATION_UDID" ]]; then
  printf '%s\n' 'No available iPhone simulator. Install an iOS runtime in Xcode Settings > Platforms.' >&2
  exit 1
fi
RESULT="ios/.test-results/Manadj-$(date +%Y%m%d-%H%M%S).xcresult"
mkdir -p ios/.test-results
xcodebuild -project ios/Manadj.xcodeproj -scheme Manadj -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=$DESTINATION_UDID" -derivedDataPath ios/.derived-data \
  -resultBundlePath "$RESULT" CODE_SIGNING_ALLOWED=NO test
printf '\n%s\n' "Apple verification completed. Open $RESULT in Xcode to inspect tests and actual simulator screenshots."
