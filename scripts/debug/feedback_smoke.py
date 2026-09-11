#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["playwright", "fastapi==0.122.0", "httpx", "pillow"]
# ///
"""Exercise a running lane UI against real feedback storage and fake external writes.

uv run scripts/debug/feedback_smoke.py --url http://localhost:5463
Add --electron /path/to/Electron to verify the native capture bridge as well.
All /api/feedback requests are intercepted; no GitHub issues or agent prompts leave this test.
"""

import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI
from fastapi.testclient import TestClient
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from backend.feedback import FeedbackService, Workspace
from backend.routers.feedback import router


class FakeGitHub:
    def __init__(self):
        self.issues = {}

    def find(self, marker):
        return self.issues.get(marker)

    def create(self, title, body):
        assert "data:image" not in body and '"snapshot"' not in body
        url = f"https://github.com/murtaza64/manadj/issues/{900000 + len(self.issues)}"
        self.issues[body.splitlines()[0]] = url
        return url


class FakeDaemon:
    def __init__(self):
        self.ready = False
        self.sent = []

    def inspect(self, session, directory):
        return {"directory": directory, "options": {"agent": "lane"}}

    def idle(self, session, directory):
        return self.ready

    def send(self, session, directory, prompt, **options):
        self.sent.append(prompt)

    def acknowledged(self, session, directory, batch_id, *, cursor=None):
        return any(f"MANADJ_FEEDBACK_BATCH:{batch_id}" in p for p in self.sent), None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--electron")
    args = parser.parse_args()
    artifacts = ROOT / ".lane-app" / "feedback-review"
    artifacts.mkdir(parents=True, exist_ok=True)
    gh, daemon = FakeGitHub(), FakeDaemon()
    process = None
    with (
        tempfile.TemporaryDirectory(prefix="manadj-feedback-smoke-") as temp,
        sync_playwright() as pw,
    ):
        service = FeedbackService(Workspace(ROOT), Path(temp), github=gh, daemon=daemon)
        app = FastAPI()
        app.state.feedback_service = service
        app.include_router(router)
        client = TestClient(app, client=("127.0.0.1", 50000))
        posts = []

        def feedback(route):
            request = route.request
            if request.method == "OPTIONS":
                route.fulfill(
                    status=204,
                    headers={
                        "Access-Control-Allow-Origin": args.url,
                        "Access-Control-Allow-Headers": "Content-Type, X-Manadj-Feedback",
                        "Access-Control-Allow-Methods": "GET, POST",
                    },
                )
                return
            if request.method == "POST":
                posts.append(urlsplit(request.url).path)
            response = client.request(
                request.method,
                urlsplit(request.url).path,
                content=request.post_data,
                headers={
                    "X-Manadj-Feedback": "1",
                    "Content-Type": "application/json",
                    "Origin": args.url,
                },
            )
            route.fulfill(
                status=response.status_code,
                body=response.content,
                headers={
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": args.url,
                },
            )

        browser = pw.chromium.launch(channel="chrome", headless=True)
        try:
            context = browser.new_context(viewport={"width": 1440, "height": 1000})
            context.route("**/api/feedback/**", feedback)
            page = context.new_page()
            page.goto(args.url)
            page.get_by_role("button", name="Feedback", exact=True).click()
            expect(page.get_by_role("dialog")).to_be_visible(timeout=15000)
            expect(page.get_by_text("Browser capture is best-effort", exact=False)).to_be_visible()
            assert posts == []
            page.get_by_label("Title", exact=True).fill("Feedback smoke report")
            page.get_by_label("Detailed description").fill(
                "The queue should wait for an explicit dispatch."
            )
            page.screenshot(path=str(artifacts / "browser-form.png"))
            page.get_by_role("button", name="File report on GitHub").click()
            expect(page.get_by_role("button", name="Send feedback (1)")).to_be_visible()
            assert len(gh.issues) == 1 and not daemon.sent
            report = service.list()["reports"][0]
            evidence = service.evidence(report["id"])
            assert evidence["snapshot"]["view"] is not None
            assert evidence["screenshot"] or evidence["capture_warnings"]
            page.get_by_role("button", name="Close", exact=True).click()
            page.reload()
            page.get_by_role("button", name="Queue (1)", exact=True).click()
            expect(page.get_by_role("button", name="Send feedback (1)")).to_be_visible()
            assert not daemon.sent and not service.list()["batches"]

            # Restart the service over the same temporary SQLite store.
            service = FeedbackService(Workspace(ROOT), Path(temp), github=gh, daemon=daemon)
            app.state.feedback_service = service
            page.get_by_role("button", name="Send feedback (1)").click()
            expect(page.get_by_text("Queued; waiting for recipient availability")).to_be_visible()
            service.poll()
            assert not daemon.sent  # busy never interrupts the owner
            daemon.ready = True
            service.poll()
            service.poll()
            assert len(daemon.sent) == 1
            page.get_by_role("button", name="Refresh status").click()
            expect(page.get_by_text("Delivered", exact=True)).to_be_visible()
            page.screenshot(path=str(artifacts / "browser-delivered.png"))
            page.get_by_role("button", name="Close", exact=True).click()
            page.set_viewport_size({"width": 390, "height": 844})
            page.get_by_role("button", name="Feedback", exact=True).click()
            expect(page.get_by_role("dialog")).to_be_visible(timeout=15000)
            box = page.get_by_role("dialog").bounding_box()
            assert box and box["x"] >= 0 and box["x"] + box["width"] <= 390
            assert page.get_by_role("dialog").evaluate("el => el.scrollWidth <= el.clientWidth")
            page.screenshot(path=str(artifacts / "mobile-form.png"))
            assert len(gh.issues) == 1 and len(daemon.sent) == 1

            if args.electron:
                with socket.socket() as sock:
                    sock.bind(("127.0.0.1", 0))
                    port = sock.getsockname()[1]
                env = dict(os.environ)
                env.pop("ELECTRON_RUN_AS_NODE", None)
                with (artifacts / "electron.log").open("w") as log:
                    process = subprocess.Popen(
                        [
                            args.electron,
                            str(ROOT / "desktop"),
                            "--url",
                            args.url,
                            "--remote-debug",
                            "--remote-debug-port",
                            str(port),
                            f"--user-data-dir={temp}/electron-profile",
                        ],
                        stdout=log,
                        stderr=log,
                        env=env,
                    )
                desktop = None
                for _ in range(60):
                    try:
                        desktop = pw.chromium.connect_over_cdp(
                            f"http://127.0.0.1:{port}", timeout=1000
                        )
                        break
                    except PlaywrightError:
                        time.sleep(0.25)
                assert desktop, "Electron CDP did not start"
                dc = desktop.contexts[0]
                dc.route("**/api/feedback/**", feedback)
                dp = dc.pages[0]
                # The shell owns splash-to-app navigation; do not race attach().
                dp.wait_for_url(args.url + "/**")
                dp.get_by_role("button", name="Feedback", exact=True).click()
                expect(dp.get_by_role("dialog")).to_be_visible(timeout=15000)
                expect(
                    dp.get_by_role("img", name="App screenshot captured before this form opened")
                ).to_be_visible()
                assert not dp.get_by_text("Browser capture is best-effort", exact=False).count()
                dp.screenshot(path=str(artifacts / "electron-form.png"))
                dp.get_by_role("button", name="Remove screenshot").click()
                expect(dp.get_by_label("Optional PNG screenshot")).to_be_visible()
                dp.get_by_role("button", name="Discard draft").click()
                assert len(gh.issues) == 1 and len(daemon.sent) == 1
            print(
                json.dumps(
                    {
                        "result": "passed",
                        "fake_issues": len(gh.issues),
                        "fake_agent_messages": len(daemon.sent),
                        "artifacts": str(artifacts),
                        "electron": bool(args.electron),
                    }
                )
            )
        finally:
            browser.close()
            client.close()
            if process:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


if __name__ == "__main__":
    main()
