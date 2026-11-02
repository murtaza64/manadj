"""Actual normal desktop Sessions UI, generated full Session evidence only."""
from pathlib import Path

import pytest


def test_normal_sessions_origin_relay_status_expandable_evidence_no_playback(tmp_path, monkeypatch):
    browser_api = pytest.importorskip("playwright.sync_api")
    shells = sorted((Path.home() / ".cache/ms-playwright").glob("chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell"))
    if not shells or not (Path(__file__).parents[1] / "frontend/dist/index.html").exists():
        pytest.skip("Build frontend and install Playwright Chromium first")
    from fastapi.testclient import TestClient

    from backend.peer_sync.group_contracts import Operation, unpack
    from tests.device_group_app import DEVICES, GROUP, SESSIONS, create_app
    from tests.peer_folder_app import fixture_app, serving
    from tests.test_device_group_mesh import call, push
    monkeypatch.setenv("MANADJ_GROUP_FIXTURE_ROOT", str(tmp_path / "full-http"))
    monkeypatch.setenv("MANADJ_GROUP_FULL_SESSION", "1")
    app = create_app()
    a, phone, b = [app.state.replicas[name] for name in ("a", "phone", "b")]
    operation = call(a, GROUP, "issue", SESSIONS["a"])
    assert len(unpack(operation, Operation)[0].bundle.manifest.tracks) == 2
    push(a, phone, GROUP, DEVICES["phone"], operation)
    push(phone, b, GROUP, DEVICES["b"], operation)
    with TestClient(app), serving(fixture_app(b)) as url, browser_api.sync_playwright() as p:
        browser = p.chromium.launch(executable_path=str(shells[-1]), headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(url)
        page.locator('[data-tour="library.sessions-row"]').click()
        row = page.locator(f'[data-session-uuid="{SESSIONS["a"]}"]')
        row.get_by_text("Laptop A", exact=False).wait_for()
        assert "Via Phone" in row.inner_text()
        assert "Replay unavailable" in row.inner_text()
        assert "44444444" not in row.inner_text()
        assert row.locator(".session-delete").count() == 0
        row.locator(".session-open").click()
        evidence = page.get_by_role("region", name="Relayed Session evidence")
        evidence.get_by_text("Playback, audio transfer and editing are not available", exact=False).wait_for()
        assert evidence.get_by_role("button", name="Play", exact=True).count() == 0
        assert evidence.locator("details").get_attribute("open") is None
        evidence.get_by_text("Technical evidence", exact=False).click()
        assert str(unpack(operation, Operation)[0].operation_id) in evidence.inner_text()
        assert "66666666-6666-4666-8666-666666666666" in evidence.inner_text()
        page.screenshot(path=str(tmp_path / "group-session-desktop.png"), full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        page.screenshot(path=str(tmp_path / "group-session-narrow.png"), full_page=True)
        assert not errors, errors
        browser.close()
