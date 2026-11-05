"""Cut one deterministic identity into backend and frontend builds."""

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from backend.release_notes import identity, load_release


def cut_metadata(root: Path, version: str, source_revision: str, destination: Path) -> dict:
    changelog = (root / "CHANGELOG.md").read_text(encoding="utf-8")
    section = re.search(
        rf"^## \[{re.escape(version)}\][^\n]*\n(.*?)(?=^## \[|^\[[^\]]+\]: |\Z)",
        changelog, re.MULTILINE | re.DOTALL,
    )
    if section is None or not section[1].strip():
        raise ValueError(f"No authored notes for exact release {version}")
    body = section[1].strip()
    build = identity(version, source_revision, body)
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "build-info.json").write_text(json.dumps(build) + "\n", encoding="utf-8")
    (destination / "release-notes.json").write_text(json.dumps({
        "schema": 1, "release_id": build["release_id"], "body": body,
    }) + "\n", encoding="utf-8")
    if load_release(destination) is None:
        raise ValueError("Invalid cut-time release metadata")
    return build


def prepare_metadata(root: Path, version: str, destination: Path) -> dict:
    # jj locally, git in Actions. Never infer a feed tip.
    jj = subprocess.run(["jj", "log", "-r", "@", "--no-graph", "-T", "commit_id"],
                        check=False, cwd=root, capture_output=True, text=True) if shutil.which("jj") else None
    if jj is not None and jj.returncode == 0:
        source = os.environ.get("MANADJ_SOURCE_REVISION", jj.stdout.strip())
        if not re.fullmatch(r"[0-9a-f]{40}", source):
            raise ValueError("Expected full source commit")
        diff = subprocess.check_output(["jj", "diff", "--from", source, "--to", "@", "--summary"], cwd=root, text=True)
        if diff.strip():
            raise ValueError("Source tree differs from pinned commit")
    else:
        source = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
        if subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=root, text=True).strip():
            raise ValueError("Release builds require a clean source checkout")
    return cut_metadata(root, version, source, destination)


def stage_metadata(metadata_dir: Path, frontend_dist: Path, backend_root: Path, version: str) -> None:
    """Refuse stale frontend/metadata combinations before shipping either platform."""
    release = load_release(metadata_dir)
    if release is None or release.version != version:
        raise ValueError("Missing or mismatched build metadata")
    if json.loads((frontend_dist / "build-info.json").read_text()) != {
        key: value for key, value in release.wire().items() if key != "body"
    }:
        raise ValueError("Frontend was built for another release")
    for name in ("build-info.json", "release-notes.json"):
        shutil.copy2(metadata_dir / name, backend_root / name)
