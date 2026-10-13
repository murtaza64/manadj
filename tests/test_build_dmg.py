"""Offline help reaches the shared release build and the assembled app.

Run the real site generator in a temporary repo. Stub npm's public-directory
copy and native packaging tools; no runtimes, downloads or DMG are needed.
"""

import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.release import build_dmg

ROOT = Path(__file__).resolve().parents[1]


def test_release_generates_and_packages_offline_help(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    site = repo / "site"
    for name in ("content", "templates", "assets", "shots", "media"):
        shutil.copytree(ROOT / "site" / name, site / name)
    for name in ("build.py", "CNAME"):
        shutil.copyfile(ROOT / "site" / name, site / name)
    fe = repo / "frontend"
    shutil.copytree(ROOT / "frontend" / "src" / "theme", fe / "src" / "theme")
    (fe / "public").mkdir()
    shutil.copyfile(ROOT / "frontend" / "public" / "logo.png", fe / "public" / "logo.png")
    (fe / "node_modules").mkdir()
    (fe / "node_modules" / ".package-lock.json").write_text("{}")
    monkeypatch.setattr(build_dmg, "ROOT", repo)
    monkeypatch.setattr(build_dmg, "BUILD", repo / "build" / "release")

    calls = []
    real_run = build_dmg.run

    def run(cmd, **kwargs):
        calls.append(cmd)
        if cmd == ["uv", "run", "site/build.py", "--app-help"]:
            assert kwargs["cwd"] == repo
            return real_run(cmd, **kwargs)
        if cmd == ["npm", "run", "build", "--ignore-scripts"]:
            assert kwargs["cwd"] == fe
            assert kwargs["env"]["VITE_API_URL"] == ""
            assert kwargs["env"]["MANADJ_APP_VERSION"] == "0.1.0-test"
            assert (fe / "public" / "manual" / "help" / "manifest.json").is_file()
            shutil.copytree(fe / "public", fe / "dist")
            (fe / "dist" / "index.html").write_text("App shell")
        elif cmd[0] == "ditto":
            shutil.copytree(cmd[1], cmd[2])

    monkeypatch.setattr(build_dmg, "run", run)
    build_dmg.build_frontend("0.1.0-test")
    assert calls.index(["uv", "run", "site/build.py", "--app-help"]) < calls.index(
        ["npm", "run", "build", "--ignore-scripts"])

    # A tiny Electron shell exercises the real frontend/dist packaging copy.
    electron = tmp_path / "Electron.app"
    (electron / "Contents" / "Resources").mkdir(parents=True)
    (electron / "Contents" / "MacOS").mkdir()
    (electron / "Contents" / "MacOS" / "Electron").write_text("binary decoy")
    monkeypatch.setattr(build_dmg, "electron_dist", lambda: electron)
    monkeypatch.setattr(build_dmg, "BACKEND_DIRS", [])
    monkeypatch.setattr(build_dmg, "BACKEND_FILES", [])
    (repo / "desktop").mkdir()
    for name in build_dmg.SHELL_FILES:
        shutil.copyfile(ROOT / "desktop" / name, repo / "desktop" / name)
    shutil.copyfile(fe / "public" / "logo.png", repo / "logo.png")
    runtime, ffmpeg = tmp_path / "python", tmp_path / "ffmpeg"
    runtime.mkdir()
    ffmpeg.mkdir()
    icns = tmp_path / "manaDJ.icns"
    icns.write_bytes(b"icon decoy")
    app = build_dmg.assemble_app(runtime, ffmpeg, icns, "0.1.0-test")
    manual = app / "Contents" / "Resources" / "backend" / "frontend" / "dist" / "manual"
    manifest = json.loads((manual / "help" / "manifest.json").read_text())
    assert manifest
    for article in manifest:
        assert (manual / "help" / article["slug"] / "index.html").is_file()
    for name in ("index.html", "install.html", "CNAME", "assets/help.css", "assets/help.js",
                 "assets/tokens.css", "assets/logo.png", "shots/perform.webp", "media/perform.mp4"):
        assert (manual / name).is_file(), name
    for name in ("UbuntuMono-Regular.ttf", "UbuntuMono-Bold.ttf", "UFL.txt"):
        assert (manual / "assets" / "fonts" / name).is_file()
    assert not (manual / "content").exists()
    assert not (manual / "templates").exists()
    for path in (fe / "public" / "manual").rglob("*"):
        if path.is_file():
            assert (manual / path.relative_to(fe / "public" / "manual")).read_bytes() == path.read_bytes()


def test_help_generation_failure_stops_frontend_build(tmp_path, monkeypatch):
    monkeypatch.setattr(build_dmg, "ROOT", tmp_path)
    calls = []

    def run(cmd, **kwargs):
        calls.append(cmd)
        if cmd == ["uv", "run", "site/build.py", "--app-help"]:
            raise subprocess.CalledProcessError(1, cmd)

    monkeypatch.setattr(build_dmg, "run", run)
    with pytest.raises(subprocess.CalledProcessError):
        build_dmg.build_frontend("0.1.0-test")
    assert ["npm", "run", "build", "--ignore-scripts"] not in calls


def test_windows_uses_same_frontend_pipeline(monkeypatch):
    monkeypatch.setitem(sys.modules, "build_dmg", build_dmg)
    spec = importlib.util.spec_from_file_location(
        "build_windows_test", ROOT / "scripts" / "release" / "build_windows.py")
    module = importlib.util.module_from_spec(spec)
    # build_windows adjusts sys.path for direct script invocation.
    monkeypatch.syspath_prepend(str(ROOT / "scripts" / "release"))
    spec.loader.exec_module(module)
    assert module.build_frontend is build_dmg.build_frontend
