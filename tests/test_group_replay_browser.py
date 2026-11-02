"""Actual Chromium decode, existing decks/worklet/mixer/driver; decoy files only."""
import json
from pathlib import Path

import pytest

from tests.test_group_replay import bound, receiver
from tests.test_peer_session_exchange import instance as instance  # noqa: PLC0414


def test_real_group_decode_render_seek_resume_and_replacement_refusal(instance, tmp_path):
    browser_api = pytest.importorskip("playwright.sync_api")
    shells = sorted((Path.home() / ".cache/ms-playwright").glob("chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell"))
    if not shells:
        pytest.skip("Playwright Chromium required")
    from tests.peer_folder_app import fixture_app, replay_frontend, serving
    peer, value, path, _ = bound(instance)
    gid, oid = path.split("/")[1:]
    with serving(fixture_app(peer)) as backend, replay_frontend(backend, tmp_path) as frontend, browser_api.sync_playwright() as p:
        browser = p.chromium.launch(executable_path=str(shells[-1]), headless=True,
                                    args=["--autoplay-policy=no-user-gesture-required"])
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(frontend.replace("peer-replay.html", "group-replay.html"))
        page.wait_for_function("!!window.groupProof")
        result = page.evaluate("([g,o]) => window.groupProof.start(g,o)", [gid, oid])
        assert result["stopped"] is None
        for deck, local, recipe in zip(("A", "B"), (73, 88), (a["recipe"] for a in value["assets"])):
            actual = result["decks"][deck]
            assert actual["trackId"] == local and actual["loadState"] == "ready"
            assert actual["audioSourceKey"].startswith("GROUP:")
            decoded = actual["decoded"]
            assert decoded["frames"] == 96000 and decoded["rate"] == 48000
            expected = [recipe["amplitude"] / 32768 * (1 if n % recipe["period_frames"] < recipe["period_frames"] // 2 else -1) for n in range(192)]
            # Chromium's PCM16 decoder scales positive samples by 32767.
            assert decoded["pcm"] == pytest.approx(expected, abs=1e-5)
        assert result["renderedFrames"] > 0 and result["renderedPeak"] > 0.01
        seek = page.evaluate("() => window.groupProof.seek(1)")
        assert abs(seek["decks"]["A"]["playhead"] - 1) < 0.06
        assert abs(seek["decks"]["B"]["playhead"] - 0.5) < 0.06
        resumed = page.evaluate("() => window.groupProof.resume()")
        assert resumed["stopped"] is None and resumed["decks"]["A"]["playhead"] > 1.05
        asset = peer.root / value["assets"][0]["file_name"]
        replacement = peer.root / "identical-decoy-replacement.wav"
        replacement.write_bytes(asset.read_bytes())
        replacement.replace(asset)
        refused = page.evaluate("() => window.groupProof.resume()")
        assert refused["stopped"] == "load-failed"
        assert not refused["decks"]["A"]["playing"] and not refused["decks"]["B"]["playing"]
        assert not errors, errors
        browser.close()


def test_normal_group_controls_bind_decode_play_pause_seek_resume(instance):
    browser_api = pytest.importorskip("playwright.sync_api")
    shells = sorted((Path.home() / ".cache/ms-playwright").glob("chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell"))
    if not shells:
        pytest.skip("Playwright Chromium required")
    from tests.peer_folder_app import fixture_app, serving
    peer, value, _ = receiver(instance)
    sid = json.loads(value["body_utf8"])["bundle"]["manifest"]["session_uuid"]
    with serving(fixture_app(peer)) as url, browser_api.sync_playwright() as p:
        browser = p.chromium.launch(executable_path=str(shells[-1]), headless=True,
                                    args=["--autoplay-policy=no-user-gesture-required"])
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.add_init_script("localStorage.setItem('manadj-tour-state', JSON.stringify({seen:{},skippedAll:true}))")
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(url)
        page.locator('[data-tour="library.sessions-row"]').click()
        page.locator(f'[data-session-uuid="{sid}"] .session-open').click()
        controls = page.get_by_role("region", name="Exact local group replay")
        assert controls.get_by_role("button", name="Replay local audio").is_disabled()
        for index, local in enumerate((73, 88), 1):
            controls.get_by_label(f"Track {index} local library ID").fill(str(local))
            controls.get_by_role("button", name="Select and bind exact local audio").nth(index - 1).click()
            page.wait_for_function("() => !document.querySelector('[aria-label=\"Exact local group replay\"] button').disabled")
        controls.get_by_role("button", name="Replay local audio").click()
        controls.get_by_role("button", name="Pause", exact=True).wait_for()
        controls.get_by_role("button", name="Pause", exact=True).click()
        controls.get_by_role("button", name="Resume", exact=True).wait_for()
        controls.get_by_label("Replay offset (seconds)").fill("1")
        controls.get_by_role("button", name="Seek", exact=True).click()
        controls.get_by_role("button", name="Resume", exact=True).click()
        controls.get_by_role("button", name="Pause", exact=True).wait_for()
        controls.get_by_role("button", name="Stop", exact=True).click()
        assert not errors, errors
        browser.close()
