#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["pyobjc-framework-Quartz", "pyobjc-framework-Cocoa", "pyobjc-framework-ApplicationServices", "pillow"]
# ///
"""macOS accessibility probe for agent-owned Rekordbox USB verification.

Usage: uv run scripts/debug/rekordbox_ui.py dump|check|press TEXT|click X Y
check fails on the exact device-library corruption dialog (not a success oracle).
"""

import re
import sys
import time

import AppKit
import ApplicationServices as AX
import Quartz as Q


def attr(element, name):
    error, value = AX.AXUIElementCopyAttributeValue(element, name, None)
    return value if error == 0 else None


def walk(element, depth=0):
    if depth > 18:
        return
    yield element, depth
    for child in attr(element, "AXChildren") or []:
        yield from walk(child, depth + 1)


def main():
    apps = [
        a
        for a in AppKit.NSWorkspace.sharedWorkspace().runningApplications()
        if a.localizedName() == "rekordbox"
    ]
    if not apps:
        raise SystemExit("rekordbox is not running")
    app = AX.AXUIElementCreateApplication(apps[0].processIdentifier())
    command = sys.argv[1]
    if command == "previewcheck":
        import io

        from PIL import Image

        image = Q.CGDisplayCreateImage(Q.CGMainDisplayID())
        bitmap = AppKit.NSBitmapImageRep.alloc().initWithCGImage_(image)
        png = bitmap.representationUsingType_properties_(AppKit.NSPNGFileType, {})
        image = Image.open(io.BytesIO(bytes(png))).convert("RGB")
        x, y, w, h = map(float, sys.argv[2:6])
        crop = image.crop(
            (
                round(x * image.width),
                round(y * image.height),
                round((x + w) * image.width),
                round((y + h) * image.height),
            )
        )
        columns = sum(
            max(max(crop.getpixel((x, y))) for y in range(crop.height))
            - min(max(crop.getpixel((x, y))) for y in range(crop.height))
            > 30
            for x in range(crop.width)
        )
        print(f"Preview ROI: {columns}/{crop.width} columns contain waveform contrast")
        if columns < crop.width / 4:
            raise SystemExit("FAIL: browser waveform preview is blank")
        return
    if command == "playcheck":
        elements = [element for element, _ in walk(app)]
        button = next(e for e in elements if attr(e, "AXTitle") == "Play/Pause")

        def timer():
            return [
                str(attr(e, "AXValue"))
                for e, _ in walk(app)
                if attr(e, "AXRole") == "AXStaticText"
                and re.fullmatch(r"\d{2}:\d{2}", str(attr(e, "AXValue")))
            ]

        before = timer()
        try:
            assert AX.AXUIElementPerformAction(button, "AXPress") == 0
            time.sleep(3)
            after = timer()
        finally:
            AX.AXUIElementPerformAction(button, "AXPress")
        assert before and after and before != after, (before, after)
        print("PASS: playback timer advanced", before, "->", after, "; paused")
        return
    if command == "drag":
        apps[0].activateWithOptions_(AppKit.NSApplicationActivateIgnoringOtherApps)
        bounds = Q.CGDisplayBounds(Q.CGMainDisplayID())
        x1, y1, x2, y2 = map(float, sys.argv[2:6])
        start = (x1 * bounds.size.width, y1 * bounds.size.height)
        end = (x2 * bounds.size.width, y2 * bounds.size.height)
        for kind, point in [(Q.kCGEventMouseMoved, start), (Q.kCGEventLeftMouseDown, start)]:
            Q.CGEventPost(Q.kCGHIDEventTap, Q.CGEventCreateMouseEvent(None, kind, point, 0))
            time.sleep(0.2)
        for i in range(1, 11):
            point = tuple(a + (b - a) * i / 10 for a, b in zip(start, end))
            Q.CGEventPost(
                Q.kCGHIDEventTap,
                Q.CGEventCreateMouseEvent(None, Q.kCGEventLeftMouseDragged, point, 0),
            )
            time.sleep(0.05)
        Q.CGEventPost(
            Q.kCGHIDEventTap, Q.CGEventCreateMouseEvent(None, Q.kCGEventLeftMouseUp, end, 0)
        )
        time.sleep(2)
        return
    if command in ("click", "doubleclick"):
        apps[0].activateWithOptions_(AppKit.NSApplicationActivateIgnoringOtherApps)
        time.sleep(0.2)
        point = tuple(map(float, sys.argv[2:4]))
        if max(point) <= 1:
            bounds = Q.CGDisplayBounds(Q.CGMainDisplayID())
            point = (point[0] * bounds.size.width, point[1] * bounds.size.height)
        Q.CGEventPost(
            Q.kCGHIDEventTap, Q.CGEventCreateMouseEvent(None, Q.kCGEventMouseMoved, point, 0)
        )
        time.sleep(0.15)
        for count in range(1, 3 if command == "doubleclick" else 2):
            for kind in (Q.kCGEventLeftMouseDown, Q.kCGEventLeftMouseUp):
                event = Q.CGEventCreateMouseEvent(None, kind, point, 0)
                Q.CGEventSetIntegerValueField(event, Q.kCGMouseEventClickState, count)
                Q.CGEventPost(Q.kCGHIDEventTap, event)
                time.sleep(0.06)
            time.sleep(0.08)
        time.sleep(1)
        return
    if command == "capture":
        print("screen recording authorized:", Q.CGPreflightScreenCaptureAccess())
        image = Q.CGDisplayCreateImage(Q.CGMainDisplayID())
        if image is None:
            raise SystemExit("display capture unavailable")
        bitmap = AppKit.NSBitmapImageRep.alloc().initWithCGImage_(image)
        bitmap.representationUsingType_properties_(
            AppKit.NSPNGFileType, {}
        ).writeToFile_atomically_(sys.argv[2], True)
        return
    found = False
    roots = attr(app, "AXWindows") or []
    if command == "press":
        roots = [app]
    for element, depth in (item for root in roots for item in walk(root)):
        values = [
            str(attr(element, n) or "") for n in ("AXRole", "AXTitle", "AXDescription", "AXValue")
        ]
        text = " | ".join(values)
        if command == "dump":
            print("  " * depth + text)
        elif command == "check" and "Device library is corrupted" in text:
            raise SystemExit("FAIL: " + text)
        elif command == "press" and sys.argv[2] in values[1:]:
            print(text, AX.AXUIElementPerformAction(element, "AXPress"))
            found = True
            break
        elif command == "expect" and sys.argv[2] in values[1:]:
            print("PASS:", text)
            found = True
            break
    if command == "press" and not found:
        raise SystemExit("control not found: " + sys.argv[2])
    if command == "expect" and not found:
        raise SystemExit("FAIL: expected visible value " + sys.argv[2])
    if command == "check":
        print("No corruption dialog; browsing/loading still requires verification.")
    time.sleep(0.2)


if __name__ == "__main__":
    main()
