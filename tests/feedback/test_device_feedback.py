"""Phone feedback over device-sync: one scoped write into the shared pipeline.

The LAN listener exposes only /api/device-sync/*; POST /feedback files a
reviewed phone report through the desktop's FeedbackService. Filing reaches an
external tracker, so it requires a verified paired device — the legacy shared
pairing code keeps its read paths but cannot file. The full /api/feedback
router stays loopback-only.
"""

import base64
import subprocess
from io import BytesIO
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from backend import device_listener
from backend.device_pairing import DeviceRegistry, PairingRequests
from backend.feedback import REQUEST_LIMIT, FeedbackService, Workspace
from backend.routers.device_sync import router


class FakeGitHub:
    def __init__(self):
        self.issues = {}
        self.creates = []

    def find(self, marker):
        return self.issues.get(marker)

    def create(self, title, body):
        self.creates.append((title, body))
        url = f"https://github.com/murtaza64/manadj/issues/{len(self.creates)}"
        self.issues[body.splitlines()[0]] = url
        return url


def png_data_url(width=8, height=6):
    out = BytesIO()
    Image.new("RGB", (width, height), (200, 30, 30)).save(out, format="PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode("ascii")


@pytest.fixture
def world(tmp_path, monkeypatch):
    monkeypatch.delenv("MANADJ_FEEDBACK_TRIAGE_SESSION", raising=False)
    monkeypatch.delenv("MANADJ_FEEDBACK_TRIAGE_DIRECTORY", raising=False)
    monkeypatch.delenv("MANADJ_FEEDBACK_DIR", raising=False)
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(returncode=0, stdout="a" * 40),
    )
    root = tmp_path / "repo"
    sidecar = root / ".editspace"
    sidecar.mkdir(parents=True)
    (sidecar / "EDITSPACE.md").write_text(f"type: single-repo\nrepo: {root}\n")
    gh = FakeGitHub()
    service = FeedbackService(Workspace(root), github=gh, daemon=SimpleNamespace())
    yield SimpleNamespace(service=service, gh=gh, root=root)
    service.stop()


@pytest.fixture
def lan(world, tmp_path):
    registry = DeviceRegistry(
        path_fn=lambda: tmp_path / "data" / "paired_devices.json",
        legacy_fn=lambda: tmp_path / "paired_devices.json",
    )
    pairing = PairingRequests(registry)
    app = device_listener.build_app(lambda: "ABCDE-12345", pairing, feedback=world.service)
    token = registry.add("phone-1", "Murtaza's iPhone")
    return SimpleNamespace(
        client=TestClient(app, client=("192.168.1.50", 50000)),
        registry=registry,
        gh=world.gh,
        service=world.service,
        headers={"X-Manadj-Device-Token": token},
    )


def report(**changes):
    body = {
        "id": str(uuid4()),
        "kind": "bug",
        "title": "Deck A froze during a transition",
        "description": "Shook the phone right after deck A locked up.",
        "snapshot": {
            "captured_at": "2026-11-20T22:30:00Z",
            "view": "performance",
            "decks": [{"deck": "A", "title": "Ascension", "playing": True, "position": 83.2}],
            "errors": [],
        },
        "screenshot": png_data_url(),
        "capture_warnings": [],
    }
    body.update(changes)
    return body


def test_feedback_requires_pairing(lan):
    assert lan.client.post("/api/device-sync/feedback", json=report()).status_code == 401
    assert lan.gh.creates == []


def test_legacy_pair_code_cannot_file_feedback(lan):
    """The shared code keeps read paths; external filing needs a paired device."""
    response = lan.client.post(
        "/api/device-sync/feedback", json=report(), headers={"X-Manadj-Pair": "ABCDE-12345"}
    )
    assert response.status_code == 401
    assert lan.gh.creates == []


def test_paired_device_files_report_to_github(lan):
    response = lan.client.post("/api/device-sync/feedback", json=report(), headers=lan.headers)
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    body = response.json()
    assert body["status"] == "filed"
    assert body["issue_url"] == "https://github.com/murtaza64/manadj/issues/1"
    title, issue = lan.gh.creates[0]
    assert title == "Deck A froze during a transition"
    assert f"<!-- manadj-feedback:{body['id']} -->" in issue
    # The issue stays text-only: the screenshot is not uploaded.
    assert "data:image/png" not in issue
    assert "Local bundle: feedback:" in issue


def test_browser_originated_requests_are_rejected(lan):
    for header in ({"Origin": "http://192.168.1.50:48127"}, {"Referer": "http://example.com/"}):
        response = lan.client.post(
            "/api/device-sync/feedback", json=report(), headers={**lan.headers, **header}
        )
        assert response.status_code == 403
    assert lan.gh.creates == []


def test_paired_device_identity_recorded_as_evidence(lan):
    submission = report()
    response = lan.client.post("/api/device-sync/feedback", json=submission, headers=lan.headers)
    assert response.status_code == 200, response.text
    evidence = lan.service.evidence(submission["id"])
    assert evidence["snapshot"]["session"]["reporting_device"] == {
        "id": "phone-1",
        "name": "Murtaza's iPhone",
    }


def test_caller_cannot_forge_reporting_device(lan):
    submission = report(snapshot={"session": {"reporting_device": {"id": "forged", "name": "forged"}}})
    response = lan.client.post("/api/device-sync/feedback", json=submission, headers=lan.headers)
    assert response.status_code == 200
    assert lan.service.evidence(submission["id"])["snapshot"]["session"]["reporting_device"]["id"] == "phone-1"


def test_caller_origin_is_replaced_with_the_running_app(lan):
    submission = report(origin={"lane": "other", "owner": "opencode:ses_fake", "revision": "0" * 40})
    response = lan.client.post("/api/device-sync/feedback", json=submission, headers=lan.headers)
    assert response.status_code == 200, response.text
    assert response.json()["origin"] == lan.service.workspace.origin.model_dump()


def test_secrets_in_reporter_text_are_scrubbed(lan):
    submission = report(description="log said token: ghp_a1b2c3d4e5f6 before the freeze")
    response = lan.client.post("/api/device-sync/feedback", json=submission, headers=lan.headers)
    assert response.status_code == 200, response.text
    _, issue = lan.gh.creates[0]
    assert "ghp_a1b2c3d4e5f6" not in issue
    assert "[REDACTED]" in issue


def test_unknown_snapshot_field_rejected(lan):
    response = lan.client.post(
        "/api/device-sync/feedback",
        json=report(snapshot={"pairing_code": "ABCDE-12345"}),
        headers=lan.headers,
    )
    assert response.status_code == 422
    assert response.headers["Cache-Control"] == "no-store"
    assert lan.gh.creates == []


def test_oversize_requests_rejected(lan):
    assert (
        lan.client.post(
            "/api/device-sync/feedback",
            content=b"{}",
            headers={
                **lan.headers,
                "content-type": "application/json",
                "content-length": str(REQUEST_LIMIT + 1),
            },
        ).status_code
        == 413
    )
    assert (
        lan.client.post(
            "/api/device-sync/feedback",
            content=iter([b"x" * REQUEST_LIMIT, b"x"]),
            headers={**lan.headers, "content-type": "application/json"},
        ).status_code
        == 413
    )


def test_resending_the_same_report_files_once(lan):
    submission = report()
    first = lan.client.post("/api/device-sync/feedback", json=submission, headers=lan.headers)
    second = lan.client.post("/api/device-sync/feedback", json=submission, headers=lan.headers)
    assert first.status_code == second.status_code == 200
    assert first.json()["issue_url"] == second.json()["issue_url"]
    assert len(lan.gh.creates) == 1


def test_missing_feedback_service_is_a_clean_503():
    app = FastAPI()
    app.include_router(router, prefix="/api/device-sync")
    client = TestClient(app)
    response = client.post("/api/device-sync/feedback", json=report())
    assert response.status_code == 503
