"""Build an isolated macOS helper identity. Packaging only, never run capture.

Ad-hoc signing is development preparation, not stable TCC attribution proof.
Do not enable the app bridge until the actual signed identity is validated.
"""
from pathlib import Path
import plistlib
import subprocess

HELPER_NAME = "manaDJ Speak"
HELPER_ID = "com.murtaza64.manadj.local-speech"


def helper_plist(version: str) -> dict:
    return {
        "CFBundleName": HELPER_NAME,
        "CFBundleDisplayName": HELPER_NAME,
        "CFBundleIdentifier": HELPER_ID,
        "CFBundleExecutable": HELPER_NAME,
        "CFBundlePackageType": "APPL",
        "CFBundleVersion": version,
        "CFBundleShortVersionString": version,
        "LSUIElement": True,
        "NSSpeechRecognitionUsageDescription": "Turn your spoken feedback into editable text on this Mac. Audio is not uploaded.",
        "NSMicrophoneUsageDescription": "Listen only when you start local feedback dictation. Audio is not saved or uploaded.",
    }


def build_local_speech(root: Path, resources: Path, version: str, run=subprocess.run) -> Path:
    bundle = resources / f"{HELPER_NAME}.app"
    contents = bundle / "Contents"
    executable = contents / "MacOS" / HELPER_NAME
    executable.parent.mkdir(parents=True, exist_ok=True)
    with (contents / "Info.plist").open("wb") as stream:
        plistlib.dump(helper_plist(version), stream)
    run(["xcrun", "swiftc", "-swift-version", "5", "-framework", "Speech", "-framework", "AVFoundation",
         str(root / "desktop" / "local-speech.swift"), "-o", str(executable)], check=True)
    # Sign the nested helper before signing the outer Electron bundle.
    run(["codesign", "--force", "--sign", "-", str(bundle)], check=True)
    run(["codesign", "--verify", "--strict", str(bundle)], check=True)
    return bundle
