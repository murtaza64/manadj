"""Host tooling checks use synthetic trees/DBs only."""

import argparse
import errno
import shutil
import socket
import sqlite3
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

from scripts.agent import db_backup, guard, land, lane_app
from scripts.agent.project_paths import discover, require_lane
from scripts.release.build_dmg import BACKEND_FILES


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "relocated project"
    sidecar = root / ".editspace"
    workspace = sidecar / "lanes" / "sample" / "repos" / "owner" / "repo"
    workspace.mkdir(parents=True)
    (sidecar / "EDITSPACE.md").write_text(
        "name: example\ntype: single-repo\nrepo: /old/machine/repo\n")
    (sidecar / "lanes/sample/LANE.md").write_text("owner: ses_mine\n")
    return discover(workspace)


def test_relocated_and_symlinked_discovery(project, tmp_path):
    alias = tmp_path / "compatibility"
    alias.symlink_to(project.sidecar, target_is_directory=True)
    via_alias = alias / project.workspace.relative_to(project.sidecar)
    assert discover(via_alias) == project
    assert project.default == project.sidecar.parent
    assert project.lane == "sample"
    assert discover(project.default).default == project.default


def test_external_sidecar(project, tmp_path):
    external = tmp_path / "external"
    shutil.move(project.sidecar, external)
    (project.default / ".editspace").symlink_to(external, target_is_directory=True)
    (external / "EDITSPACE.md").write_text(
        f"name: example\ntype: single-repo\nrepo: {project.default}\n")
    paths = discover(external / project.workspace.relative_to(project.sidecar))
    assert paths.default == project.default
    assert paths.sidecar == external


@pytest.mark.parametrize("session,owner", [("", "ses_mine"), ("ses_other", "ses_mine"),
                                         ("ses_mine", ""), ("ses_mine", "human")])
def test_ownership_refusals(project, session, owner):
    project.record.write_text(f"owner: {owner}\n")
    with patch("scripts.agent.project_paths.subprocess.run") as run:
        with pytest.raises(ValueError):
            require_lane(project, session)
        run.assert_not_called()


def test_default_and_missing_record_refused(project):
    with pytest.raises(ValueError, match="default workspace"):
        require_lane(discover(project.default), "ses_mine")
    project.record.unlink()
    with pytest.raises(ValueError, match="missing LANE.md"):
        require_lane(project, "ses_mine")


def test_jj_workspace_verified(project):
    result = subprocess.CompletedProcess([], 0, str(project.workspace), "")
    with patch("scripts.agent.project_paths.subprocess.run", return_value=result) as run:
        require_lane(project, "ses_mine")
        assert run.call_count == 2
    for result in (subprocess.CompletedProcess([], 1, "", "not found"),
                   subprocess.CompletedProcess([], 0, str(project.default), "")):
        with patch("scripts.agent.project_paths.subprocess.run", return_value=result):
            with pytest.raises(ValueError, match="workspace/record mismatch"):
                require_lane(project, "ses_mine")


def test_guard_and_lander_refuse_before_mutation(project):
    with patch.object(guard, "LANE_ROOT", project.default), patch("sys.argv", ["guard", "--session", "ses_mine"]):
        with pytest.raises(SystemExit, match="default workspace"):
            guard.main()
    with patch.object(land, "LANE_ROOT", project.workspace), patch.object(land, "jj") as jj:
        with patch("sys.argv", ["land", "@", "--session", "ses_foreign"]):
            with pytest.raises(SystemExit, match="lane owned by"):
                land.main()
        jj.assert_not_called()


def test_guard_jj_failure_is_not_clean():
    result = subprocess.CompletedProcess([], 1, "", "missing main")
    with patch.object(guard.subprocess, "run", return_value=result):
        with pytest.raises(SystemExit, match="missing main"):
            guard.jj("log", "-r", "main")


def test_occupied_ports_not_taken_over():
    with socket.socket() as occupied:
        occupied.bind(("127.0.0.1", 0))
        port = occupied.getsockname()[1]
        assert not lane_app.ports_available(port, port + 1)
        args = argparse.Namespace(reset=False, empty_db=True, backend_port=port, vite_port=port + 1)
        with patch.object(lane_app, "running_pid", return_value=None), patch.object(lane_app, "ensure_venv") as deps:
            with pytest.raises(SystemExit, match="ports unavailable"):
                lane_app.cmd_start(args)
            deps.assert_not_called()
        assert occupied.getsockname()[1] == port


def test_ipv6_occupied_port_is_skipped_and_refused(project):
    try:
        occupied = socket.socket(socket.AF_INET6)
        occupied.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        occupied.bind(("::1", 0))
    except OSError:
        pytest.skip("IPv6 loopback unavailable")
    with occupied:
        port = occupied.getsockname()[1]
        backend = port - 1
        assert not lane_app.ports_available(backend, port)
        args = argparse.Namespace(reset=False, empty_db=True, backend_port=backend, vite_port=port)
        with patch.object(lane_app, "running_pid", return_value=None), \
             patch.object(lane_app, "ensure_venv") as deps:
            with pytest.raises(SystemExit, match="ports unavailable"):
                lane_app.cmd_start(args)
            deps.assert_not_called()
        with patch.object(lane_app, "lane_record", return_value=project.record), \
             patch.object(lane_app, "taken_offsets", return_value=set()), \
             patch.object(lane_app, "BASE_BACKEND", backend - 10), \
             patch.object(lane_app, "BASE_VITE", port - 10):
            assigned = lane_app.self_assign_ports()
            assert assigned != (backend, port)
        assert occupied.getsockname()[1] == port


def test_ipv6_disabled_host_still_accepts_free_ipv4_ports():
    real_socket = socket.socket

    def ipv4_only(family=socket.AF_INET):
        if family == socket.AF_INET6:
            raise OSError(errno.EAFNOSUPPORT, "IPv6 disabled")
        return real_socket(family)

    with real_socket() as first, real_socket() as second:
        first.bind(("127.0.0.1", 0))
        second.bind(("127.0.0.1", 0))
        ports = first.getsockname()[1], second.getsockname()[1]
    with patch.object(lane_app.socket, "socket", side_effect=ipv4_only):
        assert lane_app.ports_available(*ports)


@pytest.mark.parametrize("override", [False, True])
def test_packaged_backup_import_from_shared_release_manifest(tmp_path, override):
    """No source checkout on sys.path; same BACKEND_FILES on macOS/Windows."""
    root = Path(__file__).resolve().parents[1]
    package = tmp_path / "packaged-backend"
    for relative in [*BACKEND_FILES, "backend/fs_clone.py"]:
        dest = package / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / relative, dest)
    script = (
        "import os, sys; from pathlib import Path; "
        f"sys.path.insert(0, {str(package)!r}); "
        + (f"os.environ['MANADJ_DATA_DIR'] = {str(tmp_path / 'user-data')!r}; "
           if override else "os.environ.pop('MANADJ_DATA_DIR', None); ")
        + "from scripts.agent import db_backup; "
        + (f"assert db_backup.REAL_DB == Path({str(tmp_path / 'user-data/data/library.db')!r})"
           if override else "assert db_backup.REAL_DB == db_backup.PROJECT_ROOT / 'data/library.db'")
    )
    result = subprocess.run([sys.executable, "-I", "-c", script], cwd=tmp_path,
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_port_assignment_skips_busy_pair(project):
    with patch.object(lane_app, "lane_record", return_value=project.record), \
         patch.object(lane_app, "taken_offsets", return_value={10}), \
         patch.object(lane_app, "ports_available", side_effect=[False, True]):
        assert lane_app.self_assign_ports() == (8157, 5203)
    assert "ports: backend 8157, vite 5203" in project.record.read_text()


def test_backup_and_sandbox_clone_preserve_wal(tmp_path):
    root, lane = tmp_path / "default", tmp_path / "lane"
    source = root / "data/library.db"
    source.parent.mkdir(parents=True)
    with sqlite3.connect(source) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("CREATE TABLE evidence(value)")
        connection.execute("INSERT INTO evidence VALUES (413)")
        connection.commit()
        assert source.with_name("library.db-wal").exists()
        backup = db_backup.backup(force=True, db=source, backup_dir=root / "backups")
        with sqlite3.connect(backup) as copied:
            assert copied.execute("SELECT value FROM evidence").fetchone() == (413,)
        with patch.object(lane_app, "MAIN_ROOT", root), \
             patch.object(lane_app, "LANE_ROOT", lane), \
             patch.object(lane_app, "LANE_DB", lane / "data/library.db"), \
             patch.dict("sys.modules", {"db_backup": db_backup}), \
             patch.object(db_backup, "maybe_backup"):
            lane_app.ensure_sandbox_db()
        with sqlite3.connect(lane / "data/library.db") as copied:
            assert copied.execute("SELECT value FROM evidence").fetchone() == (413,)
