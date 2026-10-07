#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Build the manaDJ DMG (packaged-app #280, ADR 0043).

Assembles a self-contained Apple Silicon app around the attach/managed
desktop shell (desktop/main.js — managed mode, #279):

  manaDJ.app/Contents/
    MacOS/manaDJ                 renamed Electron binary (app.isPackaged=true)
    Resources/app/               the shell (main.js, backend.js, preload, ...)
    Resources/backend/           repo-shaped tree: backend/, rekordbox/,
                                 enginedj/, harness/, alembic/, alembic.ini,
                                 scripts/agent/db_backup.py, frontend/dist
    Resources/python/            python-build-standalone 3.13 with the full
                                 dependency set installed (madmom, demucs,
                                 torch, ...) — relocatable, no venv
    Resources/ffmpeg/            static arm64 ffmpeg + ffprobe
                                 (ffmpeg.martin-riedl.de release builds)
    Resources/slskd/             RESERVED (#291, not yet landed): bundled
                                 slskd arm64 binary supervised by manadj —
                                 binary/path contract arrives as a comment
                                 on #280 from the setup-guides lane
    Resources/logo.png,
    Resources/manaDJ.icns        icon (generated from logo.png)

Ad-hoc signed (right-click -> Open once; notarization is out of scope).
No electron-builder: the bundle is the prebuilt Electron.app with our app
dir dropped in (Electron's documented manual distribution), which keeps the
pipeline dependency-free and the signing story trivial.

Usage:
  uv run scripts/release/build_dmg.py                 # build the DMG
  uv run scripts/release/build_dmg.py --launch        # build, then open the app
  uv run scripts/release/build_dmg.py --fresh         # drop build/release caches

Publishing is scripts/release/release.py (which calls this).

Caches live in build/release/ (gitignored): the python runtime (rebuilt when
the exported requirements change), downloaded ffmpeg, and the icon survive
between runs; the .app and DMG are assembled from scratch every time.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / "build" / "release"
OUT = BUILD / "out"

PYTHON_SERIES = "3.13"
# ffmpeg.martin-riedl.de: signed static arm64 builds. The documented
# /redirect/latest/.../release/ endpoint 404s (observed 2026-10); the release
# zips are linked from the homepage, so scrape that and fall back to the
# (working) snapshot redirect.
FFMPEG_HOME = "https://ffmpeg.martin-riedl.de"
FFMPEG_SNAPSHOT_URL = FFMPEG_HOME + "/redirect/latest/macos/arm64/snapshot/{tool}.zip"
FFMPEG_RELEASE_RE = r'href="(/download/macos/arm64/\d+_\d[^"]*/{tool}\.zip)"'
BUNDLE_ID = "com.murtaza64.manadj"
APP_NAME = "manaDJ"

# The repo-shaped backend tree (everything the backend imports at runtime).
BACKEND_DIRS = ["backend", "rekordbox", "enginedj", "harness", "alembic"]
BACKEND_FILES = ["alembic.ini", "scripts/agent/db_backup.py"]
SHELL_FILES = [
    "main.js",
    "backend.js",
    "chrome.js",
    "preload.js",
    "recording.js",
    "assert-channel-labels.swift",
    "package.json",
]


def pyproject_version() -> str:
    import re

    m = re.search(r'^version\s*=\s*"([^"]+)"', (ROOT / "pyproject.toml").read_text(), re.M)
    if not m:
        sys.exit("no version in pyproject.toml")
    return m.group(1)


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    print(f"  $ {' '.join(str(c) for c in cmd)}", flush=True)
    args = [str(c) for c in cmd]
    # Windows: npm/npx are .cmd shims that CreateProcess can't run by bare name.
    resolved = shutil.which(args[0])
    if resolved:
        args[0] = resolved
    return subprocess.run(args, check=True, **kwargs)


def step(name: str) -> None:
    print(f"\n==> {name}")


# --- frontend -------------------------------------------------------------------


def build_frontend(version: str) -> None:
    step("frontend build (no VITE_API_URL -> same-origin API, #279)")
    import os

    fe = ROOT / "frontend"
    if not (fe / "node_modules" / ".package-lock.json").exists():
        run(["npm", "install", "--no-audit", "--no-fund"], cwd=fe)
    # Never bake an API URL; stamp the (possibly prerelease) version (#298).
    env = {**os.environ, "VITE_API_URL": "", "MANADJ_APP_VERSION": version}
    # The `prebuild` hook (gen:keys) runs `uv run --project ..`, i.e. a full
    # project sync — which fails on Windows (essentia, #302) and is wasted
    # work here. The generator only needs stdlib backend/key.py: run it
    # project-less, then build with pre/post hooks skipped.
    run(["uv", "run", "--no-project", "python", "scripts/export/gen_key_table.py"], cwd=ROOT)
    run(["npm", "run", "build", "--ignore-scripts"], cwd=fe, env=env)


# --- python runtime -------------------------------------------------------------


def export_requirements(exclude: tuple[str, ...] = ()) -> Path:
    """Lock -> requirements for the bundle: no dev tools, stems included.

    `exclude`: distribution names to drop (Windows drops essentia — no wheel
    or sdist there, harness-only import; proper markers are #302's job).
    """
    reqs = BUILD / "requirements.txt"
    run(
        [
            "uv", "export", "--frozen", "--no-dev", "--group", "stems",
            "--no-emit-project", "--no-hashes", "-o", reqs,
        ],
        cwd=ROOT,
    )
    if exclude:
        kept = [
            line for line in reqs.read_text().splitlines()
            if not any(line.split("==")[0].split(" @ ")[0].strip() == name for name in exclude)
        ]
        reqs.write_text("\n".join(kept) + "\n")
    return reqs


def build_python_runtime() -> Path:
    """python-build-standalone + the full dependency set, relocatable.

    Deps go straight into the runtime's site-packages (no venv: venvs pin
    absolute paths in pyvenv.cfg and break when the .app moves). The
    EXTERNALLY-MANAGED marker is dropped from our private copy so uv will
    install into it. Cached until the exported requirements change.
    """
    step(f"python runtime ({PYTHON_SERIES} standalone + deps)")
    BUILD.mkdir(parents=True, exist_ok=True)
    reqs = export_requirements()
    stamp = BUILD / "python.stamp"
    digest = hashlib.sha256(reqs.read_bytes()).hexdigest()
    runtime = BUILD / "python"

    if runtime.exists() and stamp.exists() and stamp.read_text() == digest:
        print("  cached (requirements unchanged)")
        return runtime

    dl = BUILD / "python-dl"
    if not dl.exists():
        run(["uv", "python", "install", PYTHON_SERIES, "--install-dir", dl])
    cpythons = sorted(p for p in dl.glob("cpython-*") if p.is_dir() and not p.is_symlink())
    if not cpythons:
        sys.exit("no cpython-* dir under build/release/python-dl")

    if runtime.exists():
        shutil.rmtree(runtime)
    shutil.copytree(cpythons[-1], runtime, symlinks=True)
    marker = runtime / "lib" / f"python{PYTHON_SERIES}" / "EXTERNALLY-MANAGED"
    marker.unlink(missing_ok=True)

    run(["uv", "pip", "install", "--python", runtime / "bin" / "python3", "-r", reqs])
    stamp.write_text(digest)
    return runtime


# --- ffmpeg ---------------------------------------------------------------------


def _fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "manadj-build-dmg"})
    with urllib.request.urlopen(req) as resp:
        return resp.read()


def _ffmpeg_url(tool: str, homepage: str | None) -> str:
    import re

    if homepage:
        m = re.search(FFMPEG_RELEASE_RE.format(tool=tool), homepage)
        if m:
            return FFMPEG_HOME + m.group(1)
    print(f"  no release link for {tool}; falling back to latest snapshot")
    return FFMPEG_SNAPSHOT_URL.format(tool=tool)


def fetch_ffmpeg() -> Path:
    step("static arm64 ffmpeg + ffprobe")
    dest = BUILD / "ffmpeg"
    dest.mkdir(parents=True, exist_ok=True)
    homepage: str | None = None
    if not all((dest / t).exists() for t in ("ffmpeg", "ffprobe")):
        try:
            homepage = _fetch(FFMPEG_HOME + "/").decode(errors="replace")
        except OSError:
            homepage = None
    for tool in ("ffmpeg", "ffprobe"):
        binary = dest / tool
        if binary.exists():
            print(f"  cached: {binary}")
            continue
        url = _ffmpeg_url(tool, homepage)
        zip_path = dest / f"{tool}.zip"
        print(f"  fetching {url}")
        zip_path.write_bytes(_fetch(url))
        with zipfile.ZipFile(zip_path) as zf:
            names = [n for n in zf.namelist() if Path(n).name == tool]
            if not names:
                sys.exit(f"{tool} not found in {url}")
            zf.extract(names[0], dest)
            extracted = dest / names[0]
            if extracted != binary:
                extracted.replace(binary)
        binary.chmod(0o755)
        zip_path.unlink()
    for tool in ("ffmpeg", "ffprobe"):
        run([dest / tool, "-version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return dest


# --- icon -----------------------------------------------------------------------


def build_icns() -> Path:
    step("icon (logo.png -> manaDJ.icns)")
    icns = BUILD / f"{APP_NAME}.icns"
    if icns.exists():
        print(f"  cached: {icns}")
        return icns
    iconset = BUILD / f"{APP_NAME}.iconset"
    if iconset.exists():
        shutil.rmtree(iconset)
    iconset.mkdir(parents=True)
    logo = ROOT / "logo.png"
    for size in (16, 32, 128, 256, 512):
        for scale, suffix in ((1, ""), (2, "@2x")):
            px = size * scale
            run(
                ["sips", "-z", px, px, logo, "--out", iconset / f"icon_{size}x{size}{suffix}.png"],
                stdout=subprocess.DEVNULL,
            )
    run(["iconutil", "-c", "icns", iconset, "-o", icns])
    shutil.rmtree(iconset)
    return icns


# --- app bundle -----------------------------------------------------------------


def copytree_pyclean(src: Path, dst: Path) -> None:
    shutil.copytree(
        src, dst, symlinks=True,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store"),
    )


def electron_dist() -> Path:
    desktop = ROOT / "desktop"
    if not (desktop / "node_modules" / "electron" / "dist" / "Electron.app").exists():
        run(["npm", "install", "--no-audit", "--no-fund"], cwd=desktop)
        run([desktop / "ensure-electron.sh"], cwd=desktop)
    return desktop / "node_modules" / "electron" / "dist" / "Electron.app"


def assemble_app(python_runtime: Path, ffmpeg_dir: Path, icns: Path, version: str) -> Path:
    step("assemble manaDJ.app")
    app = BUILD / "app" / f"{APP_NAME}.app"
    if app.parent.exists():
        shutil.rmtree(app.parent)
    app.parent.mkdir(parents=True)

    # Pristine Electron.app as the base (ditto preserves symlinks/attrs).
    run(["ditto", electron_dist(), app])
    contents = app / "Contents"
    resources = contents / "Resources"

    # The shell is the app: Resources/app wins over default_app.asar.
    (resources / "default_app.asar").unlink(missing_ok=True)
    app_dir = resources / "app"
    app_dir.mkdir()
    for name in SHELL_FILES:
        shutil.copy2(ROOT / "desktop" / name, app_dir / name)
    pkg = json.loads((app_dir / "package.json").read_text())
    pkg["version"] = version  # app.getVersion() matches the build (#298)
    (app_dir / "package.json").write_text(json.dumps(pkg, indent=2) + "\n")

    # Repo-shaped backend tree (MANADJ_BACKEND_ROOT default — desktop/backend.js).
    backend_root = resources / "backend"
    for d in BACKEND_DIRS:
        copytree_pyclean(ROOT / d, backend_root / d)
    for f in BACKEND_FILES:
        dest = backend_root / f
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / f, dest)
    dist = ROOT / "frontend" / "dist"
    if not (dist / "index.html").is_file():
        sys.exit("frontend/dist/index.html missing — frontend build failed?")
    copytree_pyclean(dist, backend_root / "frontend" / "dist")

    # Runtime, ffmpeg, branding.
    run(["ditto", python_runtime, resources / "python"])
    copytree_pyclean(ffmpeg_dir, resources / "ffmpeg")
    shutil.copy2(ROOT / "logo.png", resources / "logo.png")
    shutil.copy2(icns, resources / f"{APP_NAME}.icns")

    # Identity: rename the executable (app.isPackaged keys off its name) and
    # patch the plist. Helpers keep their Electron identities — fine unsigned.
    (contents / "MacOS" / "Electron").rename(contents / "MacOS" / APP_NAME)
    plist = contents / "Info.plist"
    for key, value in [
        ("CFBundleName", APP_NAME),
        ("CFBundleDisplayName", APP_NAME),
        ("CFBundleIdentifier", BUNDLE_ID),
        ("CFBundleExecutable", APP_NAME),
        ("CFBundleIconFile", f"{APP_NAME}.icns"),
        ("CFBundleShortVersionString", version),
        ("CFBundleVersion", version),
    ]:
        run(["plutil", "-replace", key, "-string", value, plist],
            stdout=subprocess.DEVNULL)

    step("ad-hoc codesign")
    run(["codesign", "--force", "--deep", "--sign", "-", app])
    run(["codesign", "--verify", app])
    return app


def smoke_check(app: Path) -> None:
    step("bundle smoke check")
    res = app / "Contents" / "Resources"
    py = res / "python" / "bin" / "python3"
    run([py, "-c", "import uvicorn, fastapi, sqlalchemy, alembic, madmom, demucs"])
    run([res / "ffmpeg" / "ffmpeg", "-version"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    assert (res / "backend" / "frontend" / "dist" / "index.html").is_file()
    assert (res / "app" / "main.js").is_file()
    print("  ok")


def build_dmg(app: Path, version: str) -> Path:
    step("DMG")
    OUT.mkdir(parents=True, exist_ok=True)
    dmg = OUT / f"{APP_NAME}-{version}-arm64.dmg"
    dmg.unlink(missing_ok=True)
    dmgroot = BUILD / "dmgroot"
    if dmgroot.exists():
        shutil.rmtree(dmgroot)
    dmgroot.mkdir()
    run(["ditto", app, dmgroot / app.name])
    (dmgroot / "Applications").symlink_to("/Applications")
    run(["hdiutil", "create", "-volname", APP_NAME, "-srcfolder", dmgroot,
         "-ov", "-format", "UDZO", dmg])
    shutil.rmtree(dmgroot)
    print(f"\nDMG: {dmg} ({dmg.stat().st_size / 1_000_000:.0f} MB)")
    return dmg


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--version", default=None, help="default: pyproject.toml (single source, #298)")
    ap.add_argument("--fresh", action="store_true", help="drop build/release caches first")
    ap.add_argument("--launch", action="store_true", help="open the built app")
    args = ap.parse_args()

    if platform.system() != "Darwin" or platform.machine() != "arm64":
        sys.exit("this build targets Apple Silicon macOS and must run on it")

    version = args.version or pyproject_version()

    if args.fresh and BUILD.exists():
        shutil.rmtree(BUILD)
    BUILD.mkdir(parents=True, exist_ok=True)

    build_frontend(version)
    python_runtime = build_python_runtime()
    ffmpeg_dir = fetch_ffmpeg()
    icns = build_icns()
    app = assemble_app(python_runtime, ffmpeg_dir, icns, version)
    smoke_check(app)
    build_dmg(app, version)
    if args.launch:
        run(["open", app])


if __name__ == "__main__":
    main()
