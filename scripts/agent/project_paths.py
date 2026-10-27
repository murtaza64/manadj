"""Single-repo editspace discovery for stdlib-only host tooling."""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from typing import NamedTuple


def fields(path: Path) -> dict[str, str]:
    return dict(re.findall(r"^([\w-]+):[ \t]*(.*)$", path.read_text(), re.M))


class ProjectPaths(NamedTuple):
    workspace: Path
    default: Path
    sidecar: Path
    name: str

    @property
    def lane(self) -> str | None:
        try:
            parts = self.workspace.relative_to(self.sidecar).parts
        except ValueError:
            return None
        return parts[1] if len(parts) > 2 and parts[0] == "lanes" else None

    @property
    def record(self) -> Path | None:
        return self.sidecar / "lanes" / self.lane / "LANE.md" if self.lane else None


def discover(workspace: Path) -> ProjectPaths:
    """Resolve embedded or external sidecars, including compatibility symlinks.

    Embedded sidecars remain discoverable after relocating the entire project;
    their on-disk parent takes precedence over a stale absolute repo field.
    Standalone checkouts have no lane and use their own data directory.
    """
    workspace = workspace.resolve()
    candidates = [workspace / ".editspace"]
    candidates.extend(p for p in workspace.parents if (p / "EDITSPACE.md").is_file())
    for sidecar in candidates:
        metadata = sidecar / "EDITSPACE.md"
        if not metadata.is_file():
            continue
        data = fields(metadata)
        if data.get("type") != "single-repo":
            raise ValueError(f"not a single-repo sidecar: {sidecar}")
        sidecar = sidecar.resolve()
        if sidecar.name == ".editspace":
            default = sidecar.parent
        else:
            repo = data.get("repo", "")
            if not repo:
                raise ValueError(f"missing repo in {metadata}")
            default = Path(repo).expanduser()
            if not default.is_absolute():
                default = sidecar / default
            default = default.resolve()
            if (default / ".editspace").resolve() != sidecar:
                raise ValueError(f"repo/sidecar mismatch: {metadata}")
        return ProjectPaths(workspace, default, sidecar, data.get("name", default.name))
    return ProjectPaths(workspace, workspace, workspace / ".editspace", workspace.name)


def session_id() -> str:
    agent = os.environ.get("EDITSPACE_AGENT_ID", "")
    return (agent.removeprefix("opencode:") if agent.startswith("opencode:")
            else os.environ.get("OPENCODE_SESSION_ID", ""))


def require_lane(paths: ProjectPaths, session: str) -> None:
    """Fail closed on default, missing/foreign owner, or wrong jj workspace."""
    if paths.workspace == paths.default:
        raise ValueError("default workspace is read-only for agents — open a lane")
    if paths.record is None or not paths.record.is_file():
        raise ValueError(f"not an es lane workspace (missing LANE.md): {paths.workspace}")
    owner = fields(paths.record).get("owner", "").removeprefix("opencode:")
    if not session:
        raise ValueError("cannot verify ownership: no $EDITSPACE_AGENT_ID")
    if owner != session:
        raise ValueError(f"lane owned by {owner or 'nobody'}, you are {session}")
    for args in (("workspace", "root"),
                 ("workspace", "root", "--name", f"{paths.name}--{paths.lane}")):
        result = subprocess.run(["jj", "--ignore-working-copy", *args],
                                cwd=paths.workspace, capture_output=True, text=True)
        if result.returncode or Path(result.stdout.strip()).resolve() != paths.workspace:
            raise ValueError(f"workspace/record mismatch: jj {' '.join(args)}")
