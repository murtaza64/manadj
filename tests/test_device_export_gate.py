from pathlib import Path

import pytest
from fastapi import HTTPException

from rekordbox.device import export_cli


def test_device_export_cli_requires_export_gate(monkeypatch, tmp_path: Path) -> None:
    def disabled() -> None:
        raise HTTPException(status_code=403, detail="export disabled")

    monkeypatch.setattr(export_cli, "require_export_enabled", disabled)
    destination = tmp_path / "device"

    with pytest.raises(SystemExit, match="export disabled"):
        export_cli.main(["--playlist-id", "1", "--dest", str(destination)])

    assert not destination.exists()
