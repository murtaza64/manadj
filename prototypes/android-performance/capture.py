#!/usr/bin/env -S uv run --script
"""Capture mounted prototype evidence on the lane's existing emulator."""
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ADB = ROOT / ".lane-tmp/android-sdk/platform-tools/adb"
OUT = ROOT / ".lane-tmp/public-review"


def adb(*args):
    return subprocess.run([str(ADB), "-s", "emulator-5580", *map(str, args)], check=True, capture_output=True)


def tap(x, y):
    adb("shell", "input", "tap", x, y)
    time.sleep(.25)


def shot(name):
    adb("shell", "screencap", "-p", "/sdcard/iteration2.png")
    adb("pull", "/sdcard/iteration2.png", OUT / f"iteration2-{name}.png")


def launch(width, height, font=1):
    adb("shell", "am", "force-stop", "dev.manadj.phonelab")
    adb("shell", "wm", "size", f"{width}x{height}")
    adb("shell", "settings", "put", "system", "font_scale", font)
    adb("shell", "am", "start", "-W", "-n", "dev.manadj.phonelab/.MainActivity")
    for attempt in range(10):
        adb("shell", "uiautomator", "dump", "/sdcard/iteration2-window.xml")
        hierarchy = adb("exec-out", "cat", "/sdcard/iteration2-window.xml").stdout
        if b"01 / WORKSPACE" in hierarchy:
            return
        time.sleep(.2 * (attempt + 1))
    raise RuntimeError("Native performance surface did not mount")


launch(360, 640)
shot("workspace-360")
tap(225, 16)
shot("mixer-360")
launch(390, 844)
shot("workspace-390")
tap(255, 16)
shot("mixer-390")
tap(300, 130)
shot("mixer-b-selected")
launch(800, 360)
tap(665, 12)
tap(665, 12)
shot("dense-800")
launch(800, 360, 1.3)
tap(665, 12)
tap(665, 12)
shot("dense-800-font130")
launch(360, 640, 1.3)
tap(225, 16)
shot("mixer-360-font130")

launch(390, 844)
adb("shell", "settings", "put", "system", "show_touches", "1")
record = subprocess.Popen([str(ADB), "-s", "emulator-5580", "shell", "screenrecord", "--time-limit", "40", "/sdcard/iteration2-motion.mp4"])
time.sleep(.5)
tap(102, 788)
tap(295, 788)
time.sleep(2)
tap(105, 736)
shot("jump-picker")
tap(335, 690)
tap(170, 736)
time.sleep(1)
tap(112, 212)
time.sleep(.5)
adb("shell", "input", "motionevent", "DOWN", "102", "540")
time.sleep(.6)
shot("precision")
adb("shell", "input", "motionevent", "MOVE", "102", "480")
time.sleep(.5)
adb("shell", "input", "motionevent", "UP", "102", "480")
tap(168, 788)
time.sleep(.4)
shot("browse")
tap(110, 384)
time.sleep(.4)
shot("replace")
tap(282, 300)
time.sleep(1)
tap(102, 788)
time.sleep(2)
shot("loaded")
record.wait(timeout=40)
adb("pull", "/sdcard/iteration2-motion.mp4", OUT / "iteration2-motion.mp4")
adb("shell", "settings", "put", "system", "show_touches", "0")

launch(680, 320)
tap(545, 16)
tap(545, 16)
shot("small-landscape-fallback")
launch(390, 844)
adb("shell", "input", "swipe", "190", "0", "190", "80", "200")
shot("transient-bars")
time.sleep(4)
shot("bars-hidden-again")
try:
    adb("shell", "cmd", "overlay", "enable", "com.android.internal.display.cutout.emulation.hole")
    launch(390, 844)
    shot("cutout")
finally:
    adb("shell", "cmd", "overlay", "disable", "com.android.internal.display.cutout.emulation.hole")
launch(390, 844)
tap(102, 788)
tap(295, 788)
