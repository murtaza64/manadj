#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow"]
# ///
"""Build the manaDJ Windows x64 installer (cross-platform #317, ADR 0043 amendment).

Runs ON Windows (GitHub Actions windows-latest: .github/workflows/release-windows.yml)
— madmom builds from source with MSVC, and the Windows wheels must resolve
there. Mirrors build_dmg.py's layout so the shell (desktop/backend.js)
resolves the same contract:

  manaDJ\\
    manaDJ.exe                   renamed electron.exe (app.isPackaged=true),
                                 icon + version info via rcedit
    resources\\app\\               the shell (main.js, backend.js, preload, ...)
    resources\\backend\\           repo-shaped tree + frontend\\dist
    resources\\python\\            python-build-standalone 3.13 x86_64-pc-windows-msvc
                                 with the full dependency set (python.exe, Lib\\)
    resources\\ffmpeg\\            ffmpeg.exe + ffprobe.exe (BtbN LGPL win64 static)
    resources\\slskd\\             RESERVED (#291): slskd win-x64, fetched when
                                 scripts/slskd/fetch_slskd.py exists

Then: smoke tests against the assembled app (bundled python imports, backend
boot + graceful shutdown hook, the real manaDJ.exe launching and quitting
cleanly), and an Inno Setup per-user installer (no admin, %LOCALAPPDATA%\\
Programs\\manaDJ, Start menu entry, uninstaller that keeps user data).

Unsigned: SmartScreen shows "Windows protected your PC" -> More info -> Run
anyway (#318 decides signing). Shipped as untested on Windows hardware.

Usage (on Windows):
  uv run scripts/release/build_windows.py [--version X.Y.Z[-rc.N]] [--skip-launch-test]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_dmg import (  # noqa: E402  (shared release helpers)
    APP_NAME,
    BACKEND_DIRS,
    BACKEND_FILES,
    BUILD,
    PYTHON_SERIES,
    ROOT,
    SHELL_FILES,
    _fetch,
    build_frontend,
    copytree_pyclean,
    export_requirements,
    pyproject_version,
    run,
    step,
)

WIN = BUILD / "win"
OUT = BUILD / "out"
BTBN_RELEASES = "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest"
BTBN_ASSET_RE = re.compile(r"^ffmpeg-n(\d+)\.(\d+)(?:\.\d+)?-latest-win64-lgpl-\d+\.\d+\.zip$")
ELECTRON_ZIP = "https://github.com/electron/electron/releases/download/v{v}/electron-v{v}-win32-x64.zip"
RCEDIT_URL = "https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe"
ISCC_CANDIDATES = [
    r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    r"C:\Program Files\Inno Setup 6\ISCC.exe",
]
# No Windows wheel or sdist; only harness/ imports it (#302 adds markers).
WINDOWS_EXCLUDES = ("essentia",)


def download(url: str, dest: Path) -> Path:
    print(f"  fetching {url}", flush=True)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(_fetch(url))
    return dest


# --- python runtime -------------------------------------------------------------


def build_python_runtime() -> Path:
    step(f"python runtime ({PYTHON_SERIES} standalone x86_64-pc-windows-msvc + deps)")
    reqs = export_requirements(exclude=WINDOWS_EXCLUDES)
    dl = BUILD / "python-dl-win"
    if not dl.exists():
        run(["uv", "python", "install", PYTHON_SERIES, "--install-dir", dl])
    cpythons = sorted(p for p in dl.glob("cpython-*windows*") if p.is_dir() and not p.is_symlink())
    if not cpythons:
        sys.exit(f"no cpython-*windows* dir under {dl}")
    runtime = WIN / "python"
    if runtime.exists():
        shutil.rmtree(runtime)
    shutil.copytree(cpythons[-1], runtime)
    (runtime / "Lib" / "EXTERNALLY-MANAGED").unlink(missing_ok=True)
    run(["uv", "pip", "install", "--python", runtime / "python.exe", "-r", reqs])
    return runtime


# --- ffmpeg ---------------------------------------------------------------------


def fetch_ffmpeg() -> Path:
    step("ffmpeg + ffprobe (BtbN LGPL win64 static)")
    dest = WIN / "ffmpeg"
    if (dest / "ffmpeg.exe").exists() and (dest / "ffprobe.exe").exists():
        print("  cached")
        return dest
    req = urllib.request.Request(BTBN_RELEASES, headers={"User-Agent": "manadj-build"})
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req) as resp:
        assets = json.load(resp)["assets"]
    # Highest numbered release branch (n8.0 > n7.1), never the master snapshot.
    candidates = sorted(
        ((tuple(int(x) for x in m.groups()), a) for a in assets if (m := BTBN_ASSET_RE.match(a["name"]))),
        key=lambda t: t[0],
    )
    if not candidates:
        sys.exit("no ffmpeg-n*-latest-win64-lgpl-*.zip asset in BtbN's latest release")
    asset = candidates[-1][1]
    zip_path = download(asset["browser_download_url"], BUILD / asset["name"])
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        for name in zf.namelist():
            if Path(name).name in ("ffmpeg.exe", "ffprobe.exe"):
                (dest / Path(name).name).write_bytes(zf.read(name))
            if Path(name).name == "LICENSE.txt":
                (dest / "LICENSE.txt").write_bytes(zf.read(name))
    run([dest / "ffmpeg.exe", "-version"], stdout=subprocess.DEVNULL)
    return dest


# --- electron + branding ----------------------------------------------------------


def electron_version() -> str:
    lock = json.loads((ROOT / "desktop" / "package-lock.json").read_text())
    return lock["packages"]["node_modules/electron"]["version"]


def build_ico() -> Path:
    from PIL import Image

    ico = BUILD / f"{APP_NAME}.ico"
    Image.open(ROOT / "logo.png").convert("RGBA").save(
        ico, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    )
    return ico


def fetch_slskd(dest: Path) -> None:
    """Bundled slskd slot (#291). Contract: fetch_slskd.py --dest <dir>; the
    win-x64 selector is passed as --rid (to be confirmed by the #291 lane)."""
    script = ROOT / "scripts" / "slskd" / "fetch_slskd.py"
    if not script.exists():
        print("  slskd: not included (#291 not in this tree)")
        return
    run(["uv", "run", script, "--dest", dest, "--rid", "win-x64"])


def assemble_app(python_runtime: Path, ffmpeg_dir: Path, version: str) -> Path:
    step("assemble manaDJ (Electron win32-x64)")
    app = WIN / APP_NAME
    if app.exists():
        shutil.rmtree(app)
    ev = electron_version()
    zip_path = BUILD / f"electron-v{ev}-win32-x64.zip"
    if not zip_path.exists():
        download(ELECTRON_ZIP.format(v=ev), zip_path)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(app)
    (app / "electron.exe").rename(app / f"{APP_NAME}.exe")
    resources = app / "resources"
    (resources / "default_app.asar").unlink(missing_ok=True)

    app_dir = resources / "app"
    app_dir.mkdir()
    for name in SHELL_FILES:
        shutil.copy2(ROOT / "desktop" / name, app_dir / name)
    pkg = json.loads((app_dir / "package.json").read_text())
    pkg["version"] = version
    (app_dir / "package.json").write_text(json.dumps(pkg, indent=2) + "\n")

    backend_root = resources / "backend"
    for d in BACKEND_DIRS:
        copytree_pyclean(ROOT / d, backend_root / d)
    for f in BACKEND_FILES:
        (backend_root / f).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / f, backend_root / f)
    dist = ROOT / "frontend" / "dist"
    if not (dist / "index.html").is_file():
        sys.exit("frontend/dist/index.html missing — frontend build failed?")
    copytree_pyclean(dist, backend_root / "frontend" / "dist")

    shutil.copytree(python_runtime, resources / "python")
    shutil.copytree(ffmpeg_dir, resources / "ffmpeg")
    shutil.copy2(ROOT / "logo.png", resources / "logo.png")
    fetch_slskd(resources / "slskd")

    step("branding (rcedit: icon + version info)")
    ico = build_ico()
    shutil.copy2(ico, resources / f"{APP_NAME}.ico")
    rcedit = BUILD / "rcedit-x64.exe"
    if not rcedit.exists():
        download(RCEDIT_URL, rcedit)
    numeric = re.match(r"\d+\.\d+\.\d+", version).group(0)
    run([
        rcedit, app / f"{APP_NAME}.exe",
        "--set-icon", ico,
        "--set-file-version", numeric,
        "--set-product-version", version,
        "--set-version-string", "ProductName", APP_NAME,
        "--set-version-string", "FileDescription", APP_NAME,
        "--set-version-string", "CompanyName", APP_NAME,
        "--set-version-string", "OriginalFilename", f"{APP_NAME}.exe",
    ])
    return app


# --- smoke tests ------------------------------------------------------------------


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _http(method: str, url: str, headers: dict | None = None) -> int:
    req = urllib.request.Request(url, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code


def _wait_http(url: str, proc: subprocess.Popen, timeout: float) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            sys.exit(f"process exited early (code {proc.returncode}) waiting for {url}")
        try:
            if _http("GET", url) < 500:
                return
        except OSError:
            pass
        time.sleep(1)
    sys.exit(f"timed out waiting for {url}")


def smoke_backend(app: Path) -> None:
    """Bundled python imports + backend boot + graceful shutdown hook (#314)."""
    step("smoke: bundled python + backend boot + shutdown hook")
    res = app / "resources"
    py = res / "python" / "python.exe"
    run([py, "-c", "import uvicorn, fastapi, sqlalchemy, alembic, madmom, demucs, torch; print('imports ok')"])
    run([res / "ffmpeg" / "ffmpeg.exe", "-version"], stdout=subprocess.DEVNULL)

    port, token = _free_port(), secrets.token_hex(16)
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as data:
        env = {
            **os.environ,
            "MANADJ_DATA_DIR": data,
            "MANADJ_PACKAGED": "1",
            "MANADJ_SHELL_TOKEN": token,
            "PYTHONUTF8": "1",
            "PATH": str(res / "ffmpeg") + os.pathsep + os.environ.get("PATH", ""),
        }
        proc = subprocess.Popen(
            [str(py), "-m", "backend.serve", "--port", str(port)], cwd=res / "backend", env=env
        )
        try:
            base = f"http://127.0.0.1:{port}"
            _wait_http(f"{base}/api/tracks/", proc, 180)
            assert _http("GET", f"{base}/api/tracks/") == 200, "tracks API"
            assert _http("GET", f"{base}/midi-inspect") == 200, "SPA fallback"
            assert _http("POST", f"{base}/api/_shell/shutdown") == 403, "hook must need the token"
            status = _http("POST", f"{base}/api/_shell/shutdown", {"X-Manadj-Shell-Token": token})
            assert status == 202, f"shutdown hook returned {status}"
            proc.wait(timeout=30)
            print(f"  graceful shutdown ok (exit {proc.returncode})")
        finally:
            if proc.poll() is None:
                proc.kill()


def smoke_launch(app: Path) -> None:
    """Launch the real manaDJ.exe, wait for the managed backend to serve the
    page, then close the window and require the backend to be gone."""
    step("smoke: launch manaDJ.exe (managed mode) and quit")
    debug_port = _free_port()
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as data:
        env = {**os.environ, "MANADJ_DATA_DIR": data, "MANADJ_REMOTE_DEBUG": "1",
               "MANADJ_REMOTE_DEBUG_PORT": str(debug_port)}
        log = Path(data) / "launch.log"
        with open(log, "w", encoding="utf-8") as out:
            proc = subprocess.Popen([str(app / f"{APP_NAME}.exe")], env=env, stdout=out, stderr=out)
        try:
            deadline, page = time.time() + 240, None
            while time.time() < deadline and proc.poll() is None:
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{debug_port}/json", timeout=3) as r:
                        pages = [p["url"] for p in json.load(r) if p.get("type") == "page"]
                    page = next((u for u in pages if u.startswith("http://127.0.0.1:")), None)
                    if page:
                        break
                except OSError:
                    pass
                time.sleep(2)
            text = log.read_text(encoding="utf-8", errors="replace")
            if not page:
                print(text[-4000:])
                sys.exit("manaDJ.exe never loaded the backend-served app")
            print(f"  window loaded {page}")
            backend_pid = _backend_pid(page)
            # WM_CLOSE (no /F): the normal close path -> before-quit -> stopBackend.
            subprocess.run(["taskkill", "/PID", str(proc.pid)], check=False)
            proc.wait(timeout=60)
            time.sleep(2)
            if backend_pid and _pid_alive(backend_pid):
                print(log.read_text(encoding="utf-8", errors="replace")[-4000:])
                sys.exit(f"backend pid {backend_pid} outlived the app")
            shell_log = Path(data) / "logs" / "shell-backend.log"
            text = shell_log.read_text(encoding="utf-8", errors="replace") if shell_log.exists() else ""
            if "/api/_shell/shutdown" not in text:
                print(text[-4000:] or log.read_text(encoding="utf-8", errors="replace")[-4000:])
                sys.exit("app quit without using the graceful shutdown hook")
            print("  quit ok: backend stopped via the shutdown hook")
        finally:
            if proc.poll() is None:
                subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], check=False)


def _backend_pid(page_url: str) -> int | None:
    port = page_url.split(":")[2].split("/")[0]
    out = subprocess.run(["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True).stdout
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 5 and parts[1].endswith(f":{port}") and parts[3] == "LISTENING":
            return int(parts[4])
    return None


def _pid_alive(pid: int) -> bool:
    out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True).stdout
    return str(pid) in out


# --- installer --------------------------------------------------------------------


def build_installer(app: Path, version: str) -> Path:
    step("installer (Inno Setup, per-user)")
    iscc = next((p for p in ISCC_CANDIDATES if Path(p).exists()), shutil.which("iscc"))
    if not iscc:
        sys.exit("Inno Setup 6 (ISCC.exe) not found — choco install innosetup")
    OUT.mkdir(parents=True, exist_ok=True)
    base = f"{APP_NAME}-{version}-x64-setup"
    numeric = re.match(r"\d+\.\d+\.\d+", version).group(0)
    run([
        iscc,
        f"/DAppVersion={version}",
        f"/DAppVersionNumeric={numeric}",
        f"/DSourceDir={app}",
        f"/DOutputDir={OUT}",
        f"/DOutputBase={base}",
        f"/DIconFile={BUILD / (APP_NAME + '.ico')}",
        ROOT / "scripts" / "release" / "windows" / "manadj.iss",
    ])
    exe = OUT / f"{base}.exe"
    print(f"\nInstaller: {exe} ({exe.stat().st_size / 1_000_000:.0f} MB)")
    return exe


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", default=None, help="default: pyproject.toml")
    ap.add_argument("--skip-launch-test", action="store_true")
    args = ap.parse_args()
    if sys.platform != "win32":
        sys.exit("build_windows.py must run on Windows (CI: .github/workflows/release-windows.yml)")
    version = args.version or pyproject_version()
    WIN.mkdir(parents=True, exist_ok=True)

    build_frontend(version)
    runtime = build_python_runtime()
    ffmpeg_dir = fetch_ffmpeg()
    app = assemble_app(runtime, ffmpeg_dir, version)
    smoke_backend(app)
    if not args.skip_launch_test:
        smoke_launch(app)
    build_installer(app, version)


if __name__ == "__main__":
    main()
