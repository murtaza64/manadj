#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Cut a manaDJ release: macOS DMG + Windows installer (#298, #317; ADR 0043).

Version is single-sourced in pyproject.toml; desktop/package.json mirrors it
and the frontend reads it at build time (vite.config.ts).

Every release is built from ONE commit (--rev; default main):
  1. Final X.Y.Z only: bump pyproject.toml + desktop/package.json, roll
     CHANGELOG [Unreleased] -> [X.Y.Z]. If that changed files, stop: land and
     push them, then re-run. Final releases must come from main.
  2. The working copy must be that commit (`jj new <rev>`): the macOS DMG is
     built locally from it (build_dmg.py).
  3. Push bookmark release/vX.Y.Z at the commit. That push triggers
     .github/workflows/release-windows.yml, which builds the Windows
     installer from the same commit (build_windows.py) and attaches it.
  4. gh release create vX.Y.Z --target <commit>: the tag lands on that
     commit (never main's tip by accident). Body = CHANGELOG section +
     docs/install.md (+ a preview banner for prereleases). DMG attached.
  5. Wait for the Windows run and confirm the installer is attached.

Draft by default; --publish makes it public (prereleases stay marked
prerelease). jj refuses to push commits with conflicted ancestors (e.g. a
multi-lane integration probe): flatten first — `jj new main` +
`jj restore --from <probe>` gives a clean commit with the identical tree.

Usage:
  uv run scripts/release/release.py 0.1.0                      # draft final, from main
  uv run scripts/release/release.py 0.1.0 --publish
  uv run scripts/release/release.py 0.1.0-rc.3 --rev @- --publish   # public preview
  uv run scripts/release/release.py 0.1.0-rc.3 --rev @- --skip-build --no-wait
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPO = "murtaza64/manadj"
PYPROJECT = ROOT / "pyproject.toml"
PACKAGE_JSON = ROOT / "desktop" / "package.json"
CHANGELOG = ROOT / "CHANGELOG.md"
INSTALL_DOC = ROOT / "docs" / "install.md"
DMG_DIR = ROOT / "build" / "release" / "out"
WINDOWS_WORKFLOW = "release-windows.yml"
WINDOWS_TIMEOUT_S = 2 * 3600

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


def release_notes(changelog: str, install_doc: str, version: str, extra: str = "") -> str:
    """Release body: the changelog section for this version + install doc."""
    section = changelog_section(changelog, version)
    if section is None:
        section = changelog_section(changelog, base_version(version))
    if section is None:
        section = changelog_section(changelog, "Unreleased") or ""
    parts = []
    if is_prerelease(version):
        parts.append(
            "> [!WARNING]\n"
            f"> **Preview build — not a release.** {version} is a test build ahead of "
            f"v{base_version(version)}. Expect rough edges; data formats may change "
            "before the final release. Windows builds are untested on Windows hardware."
        )
    if extra.strip():
        parts.append(extra.strip())
    if is_prerelease(version) and changelog_section(changelog, version) is not None:
        section = f"## What's new in {version}\n\n{section}"
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


def roll_prerelease_changelog(version: str) -> bool:
    """Mechanical [Unreleased] -> [version] roll for a prerelease (no-op when
    the section exists or [Unreleased] is empty). Returns True if changed."""
    log = CHANGELOG.read_text()
    if not (changelog_section(log, "Unreleased") or "").strip():
        return False
    rolled = roll_changelog(log, version, dt.date.today().isoformat())
    if rolled == log:
        return False
    CHANGELOG.write_text(rolled)
    return True


def jj_out(*args: str) -> str:
    return subprocess.run(
        ["jj", *args], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.strip()


def commit_of(rev: str) -> str:
    return jj_out("log", "-r", rev, "--no-graph", "-T", "commit_id")


def working_copy_matches(rev: str) -> bool:
    return not jj_out("diff", "--from", rev, "--to", "@", "--summary")


def commit_on_github(sha: str) -> bool:
    return subprocess.run(
        ["gh", "api", f"repos/{REPO}/commits/{sha}", "--silent"],
        capture_output=True,
    ).returncode == 0


def push_release_bookmark(version: str, rev: str) -> None:
    bookmark = f"release/v{version}"
    run(["jj", "bookmark", "set", bookmark, "-r", rev, "--allow-backwards"], cwd=ROOT)
    run(["jj", "git", "push", "-b", bookmark], cwd=ROOT)


def windows_run_id(sha: str, deadline: float) -> str | None:
    """The release-windows run for `sha` (it starts a few seconds after push)."""
    while time.time() < deadline:
        out = subprocess.run(
            ["gh", "run", "list", "--repo", REPO, "--workflow", WINDOWS_WORKFLOW,
             "--commit", sha, "--limit", "1", "--json", "databaseId", "--jq", ".[0].databaseId"],
            capture_output=True, text=True,
        ).stdout.strip()
        if out:
            return out
        time.sleep(10)
    return None


def release_assets(tag: str) -> list[str]:
    out = subprocess.run(
        ["gh", "release", "view", tag, "--repo", REPO, "--json", "assets", "--jq", ".assets[].name"],
        capture_output=True, text=True,
    ).stdout
    return [line for line in out.splitlines() if line]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("version", help="X.Y.Z or X.Y.Z-rc.N")
    ap.add_argument("--rev", default="main", help="jj revision to release (default: main)")
    ap.add_argument("--publish", action="store_true", help="publish (default: draft)")
    ap.add_argument("--skip-build", action="store_true", help="reuse the built DMG")
    ap.add_argument("--no-windows", action="store_true", help="macOS only (don't wait for the installer)")
    ap.add_argument("--no-wait", action="store_true", help="don't wait for the Windows build")
    ap.add_argument("--extra-notes", type=Path, default=None,
                    help="markdown inserted after the preview banner (e.g. what to try)")
    args = ap.parse_args()

    version = args.version.removeprefix("v")
    if not VERSION_RE.match(version):
        sys.exit(f"bad version {version!r} (want X.Y.Z or X.Y.Z-rc.N)")
    tag = f"v{version}"
    pre = is_prerelease(version)

    if not pre:
        if commit_of(args.rev) != commit_of("main"):
            sys.exit("final releases come from main (--rev main)")
        print("==> version + changelog")
        if bump_files(version):
            sys.exit(
                f"bumped files for {version} — commit, land and push them to main, "
                "then re-run (the release must point at a pushed commit)"
            )
    elif args.rev == "main" and roll_prerelease_changelog(version):
        # Prereleases keep the pyproject version (the build is stamped with
        # the rc version) but roll [Unreleased] into [X.Y.Z-rc.N] so the
        # changelog records what each rc shipped.
        sys.exit(
            f"rolled CHANGELOG [Unreleased] -> [{version}] — land and push it to main, "
            "then re-run"
        )
    sha = commit_of(args.rev)
    if not working_copy_matches(args.rev):
        sys.exit(f"working copy differs from {args.rev} — `jj new {args.rev}` first "
                 "(the DMG is built from the working copy)")

    dmg = DMG_DIR / f"manaDJ-{version}-arm64.dmg"
    if not args.skip_build:
        print("==> build DMG")
        run(["uv", "run", ROOT / "scripts" / "release" / "build_dmg.py", "--version", version], cwd=ROOT)
    if not dmg.exists():
        sys.exit(f"missing {dmg}")

    print(f"==> push release/v{version} at {sha[:12]} (triggers the Windows build)")
    push_release_bookmark(version, args.rev)
    if not commit_on_github(sha):
        sys.exit(f"{sha[:12]} did not reach GitHub")
    pushed_at = time.time()

    extra = args.extra_notes.read_text() if args.extra_notes else ""
    notes = release_notes(CHANGELOG.read_text(), INSTALL_DOC.read_text(), version, extra)
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
        f.write(notes)
        notes_file = f.name
    exists = subprocess.run(
        ["gh", "release", "view", tag, "--repo", REPO], capture_output=True
    ).returncode == 0
    print(f"==> GitHub release {tag}")
    if exists:
        run(["gh", "release", "edit", tag, "--repo", REPO, "--notes-file", notes_file])
    else:
        cmd = ["gh", "release", "create", tag, "--repo", REPO, "--target", sha,
               "--title", f"manaDJ {tag}" + (" (preview)" if pre else ""),
               "--notes-file", notes_file]
        if pre:
            cmd.append("--prerelease")
        if not args.publish:
            cmd.append("--draft")
        run(cmd)
    run(["gh", "release", "upload", tag, dmg, "--repo", REPO, "--clobber"])

    if not (args.no_windows or args.no_wait):
        print("==> waiting for the Windows installer (release-windows.yml)")
        run_id = windows_run_id(sha, pushed_at + 300)
        if not run_id:
            sys.exit("no release-windows run found for the commit — check Actions")
        subprocess.run(["gh", "run", "watch", run_id, "--repo", REPO, "--exit-status",
                        "--interval", "60"], check=False)
        installers = [a for a in release_assets(tag) if a.endswith("-x64-setup.exe")]
        if not installers:
            sys.exit(f"Windows run {run_id} finished without attaching an installer — "
                     f"gh run view {run_id} --repo {REPO} --log-failed")
        print(f"  attached: {installers[0]}")

    url = subprocess.run(
        ["gh", "release", "view", tag, "--repo", REPO, "--json", "url", "--jq", ".url"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    print(f"\nrelease: {url}")


if __name__ == "__main__":
    main()
