"""Host tooling checks use synthetic trees/DBs only."""

import argparse
import shutil
import socket
import sqlite3
import subprocess
from unittest.mock import patch

import pytest

from scripts.agent import db_backup, guard, land, lane_app
from scripts.agent.project_paths import discover, require_lane


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
