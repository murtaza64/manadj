#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Cut a manaDJ release (packaged-app #298, ADR 0043).

Version is single-sourced in pyproject.toml; desktop/package.json mirrors it
and the frontend reads it at build time (vite.config.ts).

Final release (X.Y.Z), from main:
  1. bump pyproject.toml + desktop/package.json, roll CHANGELOG
     [Unreleased] -> [X.Y.Z]. If that changed files, stop: commit + push them
     (land), then re-run — the release must point at a pushed commit.
  2. build the DMG (build_dmg.py)
  3. gh release create vX.Y.Z --target <main's commit> — GitHub creates and
     pushes the tag at that commit when the release is published. Body =
     CHANGELOG section + docs/install.md. DMG attached.

Prerelease (X.Y.Z-rc.N etc.): no file edits; the build is stamped with the
prerelease version, the body uses the [X.Y.Z] (or [Unreleased]) section, and
the release is marked prerelease. Drafts may come from an unpushed lane build
(probe artifacts) — no tag exists until publish.

Always --draft unless --publish.

Usage:
  uv run scripts/release/release.py 0.1.0-rc.1           # draft prerelease
  uv run scripts/release/release.py 0.1.0                # draft final release
  uv run scripts/release/release.py 0.1.0 --publish      # publish immediately
  uv run scripts/release/release.py 0.1.0-rc.1 --skip-build   # reuse built DMG
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPO = "murtaza64/manadj"
PYPROJECT = ROOT / "pyproject.toml"
PACKAGE_JSON = ROOT / "desktop" / "package.json"
CHANGELOG = ROOT / "CHANGELOG.md"
INSTALL_DOC = ROOT / "docs" / "install.md"
DMG_DIR = ROOT / "build" / "release" / "out"

VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$")
PYPROJECT_VERSION_RE = re.compile(r'^(version\s*=\s*")([^"]+)(")', re.M)


# --- pure helpers (tests/test_release.py) -----------------------------------------


def is_prerelease(version: str) -> bool:
    return "-" in version


def base_version(version: str) -> str:
    return version.split("-", 1)[0]


def read_pyproject_version(text: str) -> str:
    m = PYPROJECT_VERSION_RE.search(text)
    if not m:
        raise ValueError("no version in pyproject.toml")
    return m.group(2)


def set_pyproject_version(text: str, version: str) -> str:
    return PYPROJECT_VERSION_RE.sub(lambda m: f"{m.group(1)}{version}{m.group(3)}", text, count=1)


def set_package_json_version(text: str, version: str) -> str:
    data = json.loads(text)
    data["version"] = version
    return json.dumps(data, indent=2) + "\n"


def changelog_section(text: str, version: str) -> str | None:
    """Body of `## [version]` (without its heading), or None."""
    m = re.search(rf"^## \[{re.escape(version)}\][^\n]*\n(.*?)(?=^## \[|^\[[^\]]+\]: |\Z)", text, re.M | re.S)
    return m.group(1).strip() if m else None


def roll_changelog(text: str, version: str, date: str) -> str:
    """Move [Unreleased] entries under a new `## [version] - date` heading.

    Idempotent: a changelog that already has the version is returned as-is.
    Link references are updated (Unreleased compares from the new tag).
    """
    if changelog_section(text, version) is not None:
        return text
    if "## [Unreleased]" not in text:
        raise ValueError("CHANGELOG has no [Unreleased] section")
    text = text.replace("## [Unreleased]", f"## [Unreleased]\n\n## [{version}] - {date}", 1)
    link = f"[{version}]: https://github.com/{REPO}/releases/tag/v{version}"
    text = re.sub(
        r"^\[Unreleased\]: .*$",
        f"[Unreleased]: https://github.com/{REPO}/compare/v{version}...HEAD\n{link}",
        text,
        count=1,
        flags=re.M,
    )
    return text


def release_notes(changelog: str, install_doc: str, version: str) -> str:
    """Release body: the changelog section for this version + install doc."""
    section = changelog_section(changelog, version)
    if section is None:
        section = changelog_section(changelog, base_version(version))
    if section is None:
        section = changelog_section(changelog, "Unreleased") or ""
    parts = []
    if is_prerelease(version):
        parts.append(
            f"> Prerelease {version} — a test build ahead of v{base_version(version)}; "
            "expect rough edges."
        )
    parts.append(section)
    # Drop the doc's own H1; the release title already names the app.
    install = re.sub(r"\A# [^\n]*\n+", "", install_doc)
    parts.append("## Install\n\n" + install.strip())
    return "\n\n".join(p for p in parts if p).strip() + "\n"


# --- side effects -----------------------------------------------------------------


def run(cmd: list, **kwargs) -> subprocess.CompletedProcess:
    print(f"  $ {' '.join(str(c) for c in cmd)}")
    return subprocess.run([str(c) for c in cmd], check=True, **kwargs)


def bump_files(version: str) -> bool:
    """Write version + roll changelog. Returns True if anything changed."""
    changed = False
    py = PYPROJECT.read_text()
    if read_pyproject_version(py) != version:
        PYPROJECT.write_text(set_pyproject_version(py, version))
        run(["uv", "lock"], cwd=ROOT)
        changed = True
    pkg = PACKAGE_JSON.read_text()
    if json.loads(pkg)["version"] != version:
        PACKAGE_JSON.write_text(set_package_json_version(pkg, version))
        changed = True
    log = CHANGELOG.read_text()
    rolled = roll_changelog(log, version, dt.date.today().isoformat())
    if rolled != log:
        CHANGELOG.write_text(rolled)
        changed = True
    return changed


def main_commit() -> str:
    """Git commit id of the jj `main` bookmark."""
    out = subprocess.run(
        ["jj", "log", "-r", "main", "--no-graph", "-T", "commit_id"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    )
    return out.stdout.strip()


def commit_on_github(sha: str) -> bool:
    return subprocess.run(
        ["gh", "api", f"repos/{REPO}/commits/{sha}", "--silent"],
        capture_output=True,
    ).returncode == 0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("version", help="X.Y.Z or X.Y.Z-rc.N")
    ap.add_argument("--publish", action="store_true", help="publish (default: draft)")
    ap.add_argument("--skip-build", action="store_true", help="reuse the built DMG")
    args = ap.parse_args()

    version = args.version.removeprefix("v")
    if not VERSION_RE.match(version):
        sys.exit(f"bad version {version!r} (want X.Y.Z or X.Y.Z-rc.N)")
    tag = f"v{version}"
    pre = is_prerelease(version)

    target: str | None = None
    if not pre:
        print("==> version + changelog")
        if bump_files(version):
            sys.exit(
                f"bumped files for {version} — commit, land and push them to main, "
                "then re-run (the release must point at a pushed commit)"
            )
        target = main_commit()
        if not commit_on_github(target):
            sys.exit(f"main ({target[:12]}) is not on GitHub — push main first")

    dmg = DMG_DIR / f"manaDJ-{version}-arm64.dmg"
    if not args.skip_build:
        print("==> build DMG")
        run(["uv", "run", ROOT / "scripts" / "release" / "build_dmg.py", "--version", version], cwd=ROOT)
    if not dmg.exists():
        sys.exit(f"missing {dmg}")

    notes = release_notes(CHANGELOG.read_text(), INSTALL_DOC.read_text(), version)
    exists = subprocess.run(
        ["gh", "release", "view", tag, "--repo", REPO], capture_output=True
    ).returncode == 0
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
        f.write(notes)
        notes_file = f.name

    print(f"==> GitHub release {tag}")
    if exists:
        run(["gh", "release", "edit", tag, "--repo", REPO, "--notes-file", notes_file])
    else:
        cmd = ["gh", "release", "create", tag, "--repo", REPO,
               "--title", f"manaDJ {tag}", "--notes-file", notes_file]
        if target:
            cmd += ["--target", target]
        if pre:
            cmd.append("--prerelease")
        if not args.publish:
            cmd.append("--draft")
        run(cmd)
    run(["gh", "release", "upload", tag, dmg, "--repo", REPO, "--clobber"])
    url = subprocess.run(
        ["gh", "release", "view", tag, "--repo", REPO, "--json", "url", "--jq", ".url"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    print(f"\nrelease: {url}")


if __name__ == "__main__":
    main()
