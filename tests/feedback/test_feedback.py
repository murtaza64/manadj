"""Standalone API and real SQLite, with fake external writes only."""

import base64
import json
import multiprocessing
import sqlite3
import subprocess
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image, PngImagePlugin

from backend.feedback import (
    REQUEST_LIMIT,
    Dispatch,
    FeedbackService,
    Origin,
    Submission,
    Workspace,
)
from backend.feedback_transport import RoutingError, Unavailable, Uncertain
from backend.routers.feedback import router


class FakeGitHub:
    def __init__(self):
        self.issues = {}
        self.creates = []
        self.offline = False
        self.outcome = "success"

    def find(self, marker):
        if self.offline:
            raise Unavailable("GitHub offline")
        return self.issues.get(marker)

    def create(self, title, body):
        if self.outcome == "preflight":
            raise Unavailable("gh authentication unavailable")
        self.creates.append((title, body))
        url = f"https://github.com/murtaza64/manadj/issues/{len(self.creates)}"
        if self.outcome != "lost":
            self.issues[body.splitlines()[0]] = url
        if self.outcome == "crash":
            raise KeyboardInterrupt("simulated process loss after remote create")
        if self.outcome in {"timeout", "lost"}:
            raise Uncertain("GitHub outcome unknown")
        return url


class FakeDaemon:
    def __init__(self):
        self.ready = True
        self.offline = False
        self.missing = False
        self.sent = []
        self.acks = set()
        self.outcome = "success"

    def inspect(self, session, directory):
        if self.missing:
            raise RoutingError("Owning session missing")
        if self.offline:
            raise Unavailable("Daemon offline")

    def idle(self, session, directory):
        return self.ready

    def acknowledged(self, session, directory, batch_id):
        return batch_id in self.acks

    def send(self, session, directory, prompt):
        self.sent.append((session, directory, prompt))
        if self.outcome == "timeout":
            raise Uncertain("Daemon outcome unknown")
        if self.outcome == "crash":
            raise KeyboardInterrupt("simulated process loss after POST")


@pytest.fixture
def world(tmp_path, monkeypatch):
    monkeypatch.delenv("MANADJ_FEEDBACK_TRIAGE_SESSION", raising=False)
    monkeypatch.delenv("MANADJ_FEEDBACK_TRIAGE_DIRECTORY", raising=False)
    monkeypatch.delenv("MANADJ_FEEDBACK_DIR", raising=False)
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(
            returncode=0,
            stdout="a" * 40,
        ),
    )
    root = tmp_path / "repo"
    sidecar = root / ".editspace"
    sidecar.mkdir(parents=True)
    (sidecar / "EDITSPACE.md").write_text(f"type: single-repo\nrepo: {root}\n")
    gh, daemon = FakeGitHub(), FakeDaemon()
    services = []

    def make(lane="one", owner="opencode:ses_owner", *, path=None):
        if path is None:
            path = sidecar / "lanes" / lane / "repos/murtaza64/manadj" if lane else root
            path.mkdir(parents=True, exist_ok=True)
            if lane:
                (sidecar / "lanes" / lane / "LANE.md").write_text(f"owner: {owner}\n")
        service = FeedbackService(Workspace(path), github=gh, daemon=daemon)
        services.append(service)
        return service

    yield SimpleNamespace(make=make, gh=gh, daemon=daemon, root=root, sidecar=sidecar)
    for service in services:
        service.stop()


def app_client(service):
    app = FastAPI()
    app.state.feedback_service = service
    app.include_router(router)
    return TestClient(app, headers={"X-Manadj-Feedback": "1"})


def data(service, **changes):
    return {
        "id": str(uuid4()),
        "kind": "bug",
        "title": "Loop skips a beat",
        "description": "Repro: enable loop then seek.",
        "origin": service.context()["origin"],
        "snapshot": {"view": "browse", "decks": [{"track_id": 10}]},
        "screenshot": None,
        "capture_warnings": [],
        **changes,
    }


def submit(service, **changes):
    return service.submit(Submission.model_validate(data(service, **changes)))


def freeze(service, reports):
    return service.dispatch(Dispatch(report_ids=[report["id"] for report in reports]))


def batch(service, id):
    return next(item for item in service.list()["batches"] if item["id"] == id)


def test_context_private_durable_store_and_api_contract(world):
    service = world.make()
    client = app_client(service)
    context = client.get("/api/feedback/context")
    assert context.status_code == 200
    assert context.headers["cache-control"] == "no-store"
    assert context.json()["origin"] == {
        "lane": "one",
        "owner": "opencode:ses_owner",
        "revision": "a" * 40,
    }
    payload = data(service)
    response = client.post("/api/feedback/reports", json=payload)
    assert response.status_code == 200
    report = response.json()
    assert set(report) == {
        "id",
        "kind",
        "title",
        "description",
        "status",
        "issue_url",
        "error",
        "batch_id",
        "created_at",
        "origin",
        "destination",
    }
    assert report["status"] == "filed" and report["batch_id"] is None
    assert service.storage == world.sidecar / "feedback"
    assert service.storage.stat().st_mode & 0o777 == 0o700
    assert service.db_path.stat().st_mode & 0o777 == 0o600
    restarted = world.make(path=service.workspace.path)
    assert restarted.list()["reports"] == [report]
    assert (
        client.get(f"/api/feedback/reports/{report['id']}").json()["snapshot"]
        == payload["snapshot"]
    )
    body = world.gh.creates[0][1]
    assert "NOT dispatched" in body and "needs-human" in body
    assert "track_id" not in body and "base64" not in body
    assert f"<!-- manadj-feedback:{report['id']} -->" in body
    restarted.poll()
    assert not world.daemon.sent


def test_duplicate_submit_is_immutable_and_never_refiles(world):
    service = world.make()
    client = app_client(service)
    payload = data(service)
    first = client.post("/api/feedback/reports", json=payload).json()
    assert client.post("/api/feedback/reports", json=payload).json() == first
    assert len(world.gh.creates) == 1
    payload["description"] = "Different report"
    assert client.post("/api/feedback/reports", json=payload).status_code == 409


@pytest.mark.parametrize("outcome", ["timeout", "crash", "lost"])
def test_uncertain_create_restart_reconciliation_never_blindly_retries(world, outcome):
    service = world.make()
    world.gh.outcome = outcome
    payload = data(service)
    if outcome == "crash":
        with pytest.raises(KeyboardInterrupt):
            service.submit(Submission.model_validate(payload))
    else:
        assert service.submit(Submission.model_validate(payload))["status"] == "filing_uncertain"
    restarted = world.make(path=service.workspace.path)
    restarted.poll()
    report = restarted.retry_report(payload["id"])
    assert report["status"] == ("filing_uncertain" if outcome == "lost" else "filed")
    restarted.retry_report(payload["id"])
    assert len(world.gh.creates) == 1
    assert not world.daemon.sent


@pytest.mark.parametrize("failure", ["offline", "preflight"])
def test_retryable_filing_failure_keeps_bundle_and_can_retry(world, failure):
    service = world.make()
    world.gh.offline = failure == "offline"
    world.gh.outcome = failure
    report = submit(service)
    assert report["status"] == "filing_failed"
    assert service.evidence(report["id"])["snapshot"]["view"] == "browse"
    world.gh.offline = False
    world.gh.outcome = "success"
    service.poll()  # Do not automatically create issues for retryable failures.
    assert not world.gh.creates
    assert service.retry_report(report["id"])["status"] == "filed"


def test_freeze_atomic_idempotent_and_new_reports_stay_pending(world):
    service = world.make()
    first, second = submit(service), submit(service)
    frozen = freeze(service, [first, second])
    assert frozen["status"] == "queued"
    assert set(frozen) == {"id", "report_ids", "status", "destination", "error"}
    assert freeze(service, [second, first]) == frozen
    later = submit(service)
    assert later["batch_id"] is None
    client = app_client(service)
    assert (
        client.post(
            "/api/feedback/dispatch",
            json={
                "report_ids": [first["id"], later["id"]],
            },
        ).status_code
        == 409
    )
    assert service.list()["reports"][-1]["batch_id"] is None
    world.daemon.ready = False
    service.poll()
    assert batch(service, frozen["id"])["status"] == "queued"
    assert not world.daemon.sent
    world.daemon.ready = True
    service.poll()
    assert batch(service, frozen["id"])["status"] == "submitted"
    assert len(world.daemon.sent) == 1
    session, directory, prompt = world.daemon.sent[0]
    assert session == "ses_owner" and directory == str(service.workspace.path)
    assert later["id"] not in prompt
    assert first["id"] in prompt and "UNTRUSTED DATA" in prompt
    assert "land/review policies" in prompt
    service.poll()
    assert len(world.daemon.sent) == 1
    world.daemon.acks.add(frozen["id"])
    service.poll()
    assert batch(service, frozen["id"])["status"] == "delivered"
    assert len(world.daemon.sent) == 1


def test_concurrent_app_instances_freeze_and_submit_once(world):
    first = world.make()
    second = world.make(path=first.workspace.path)
    payload = Submission.model_validate(data(first))
    with ThreadPoolExecutor(max_workers=2) as pool:
        reports = list(pool.map(lambda service: service.submit(payload), [first, second]))
    assert reports[0] == reports[1] and len(world.gh.creates) == 1
    selection = Dispatch(report_ids=[payload.id])
    with ThreadPoolExecutor(max_workers=2) as pool:
        batches = list(pool.map(lambda service: service.dispatch(selection), [first, second]))
        list(pool.map(lambda service: service.poll(), [first, second]))
    assert batches[0]["id"] == batches[1]["id"]
    assert len(world.daemon.sent) == 1


@pytest.mark.parametrize("outcome", ["timeout", "crash"])
def test_submitted_before_post_and_restart_never_resends(world, outcome):
    service = world.make()
    frozen = freeze(service, [submit(service)])
    world.daemon.outcome = outcome
    if outcome == "crash":
        with pytest.raises(KeyboardInterrupt):
            service.poll()
    else:
        service.poll()
    restarted = world.make(path=service.workspace.path)
    assert batch(restarted, frozen["id"])["status"] == "submitted"
    restarted.retry_batch(frozen["id"])
    assert len(world.daemon.sent) == 1
    world.daemon.acks.add(frozen["id"])
    restarted.poll()
    assert batch(restarted, frozen["id"])["status"] == "delivered"


def test_crash_between_durable_submit_and_post_requires_manual_review(world):
    service = world.make()
    frozen = freeze(service, [submit(service)])
    with service.writing() as db:
        value = service._get(db, "batches", frozen["id"])
        value["status"] = "submitted"
        db.execute("INSERT INTO session_slots VALUES (?, ?)", ("ses_owner", frozen["id"]))
        service._save(db, "batches", value)
    restarted = world.make(path=service.workspace.path)
    restarted.poll()
    restarted.retry_batch(frozen["id"])
    assert batch(restarted, frozen["id"])["status"] == "submitted"
    assert not world.daemon.sent


def test_shared_session_slot_blocks_another_workspace_until_ack(world):
    first, second = world.make("one"), world.make("two")
    one = freeze(first, [submit(first)])
    two = freeze(second, [submit(second)])
    first.poll()
    second.poll()
    assert len(world.daemon.sent) == 1
    assert batch(second, two["id"])["status"] == "queued"
    world.daemon.acks.add(one["id"])
    first.poll()
    second.poll()
    assert len(world.daemon.sent) == 2


@pytest.mark.parametrize("mutation", ["changed", "missing", "blank"])
def test_owner_change_or_loss_blocks_capture_and_delivery(world, mutation):
    service = world.make()
    payload = data(service)
    report = submit(service)
    frozen = freeze(service, [report])
    if mutation == "missing":
        service.workspace.lane_record.unlink()
    else:
        service.workspace.lane_record.write_text(
            "owner: ses_other\n" if mutation == "changed" else "owner:\n"
        )
    client = app_client(service)
    assert client.post("/api/feedback/reports", json=payload).status_code == 409
    assert client.post(f"/api/feedback/reports/{report['id']}/retry").status_code == 409
    assert client.post(f"/api/feedback/batches/{frozen['id']}/retry").status_code == 409
    service.poll()
    assert batch(service, frozen["id"])["status"] == "needs-routing"
    assert not world.daemon.sent


def test_missing_lane_record_at_start_is_not_main(world):
    service = world.make()
    service.workspace.lane_record.unlink()
    restarted = world.make(path=service.workspace.path)
    assert restarted.context()["origin"]["lane"] == "one"
    assert restarted.context()["origin"]["owner"] is None
    assert (
        app_client(restarted).post("/api/feedback/reports", json=data(restarted)).status_code == 409
    )


def test_origin_capture_revision_and_owner_are_validated(world):
    service = world.make()
    client = app_client(service)
    for field in ("lane", "owner", "revision"):
        payload = data(service)
        payload["origin"][field] = "forged"
        assert client.post("/api/feedback/reports", json=payload).status_code == 409
    assert not world.gh.creates


def test_scoped_reads_mutations_poll_and_ids(world):
    first, second = world.make("one"), world.make("two")
    payload = data(first)
    report = first.submit(Submission.model_validate(payload))
    frozen = freeze(first, [report])
    client = app_client(second)
    assert client.get("/api/feedback/reports").json()["reports"] == []
    for method, url in [
        ("get", f"/api/feedback/reports/{report['id']}"),
        ("post", f"/api/feedback/reports/{report['id']}/retry"),
        ("post", f"/api/feedback/batches/{frozen['id']}/retry"),
    ]:
        assert getattr(client, method)(url).status_code == 404
    assert (
        client.post("/api/feedback/dispatch", json={"report_ids": [report["id"]]}).status_code
        == 404
    )
    payload["origin"] = second.context()["origin"]
    assert client.post("/api/feedback/reports", json=payload).status_code == 409
    second.poll()
    assert not world.daemon.sent


@pytest.mark.parametrize("condition", ["offline", "missing", "busy"])
def test_unavailable_recipient_is_never_fake_success(world, condition):
    service = world.make()
    frozen = freeze(service, [submit(service)])
    world.daemon.offline = condition == "offline"
    world.daemon.missing = condition == "missing"
    world.daemon.ready = condition != "busy"
    service.poll()
    current = batch(service, frozen["id"])
    assert current["status"] == ("needs-routing" if condition == "missing" else "queued")
    assert current["error"] and not world.daemon.sent


def test_main_needs_explicit_triage_config_then_retry_and_never_retargets(world, monkeypatch):
    service = world.make(lane=None)
    frozen = freeze(service, [submit(service)])
    assert frozen["status"] == "needs-routing"
    assert "MANADJ_FEEDBACK_TRIAGE_SESSION" in frozen["error"]
    monkeypatch.setenv("MANADJ_FEEDBACK_TRIAGE_SESSION", "opencode:ses_triage")
    service.poll()
    assert not world.daemon.sent
    assert service.retry_batch(frozen["id"])["status"] == "submitted"
    assert world.daemon.sent[0][0:2] == ("ses_triage", str(world.root))
    monkeypatch.setenv("MANADJ_FEEDBACK_TRIAGE_SESSION", "ses_replacement")
    service.poll()
    assert batch(service, frozen["id"])["status"] == "needs-routing"
    assert len(world.daemon.sent) == 1


@pytest.mark.parametrize(
    "origin",
    [
        "https://evil.example:443",
        "null",
        "http://localhost.evil:5173",
        "http://user@localhost:5173",
        "file://",
        "http://localhost:1/path",
    ],
)
def test_foreign_origin_rejected_for_reads_and_writes(world, origin):
    client = app_client(world.make())
    for method, url in [
        ("get", "/api/feedback/reports"),
        ("get", "/api/feedback/context"),
        ("post", "/api/feedback/reports"),
        ("post", "/api/feedback/dispatch"),
    ]:
        assert getattr(client, method)(url, headers={"Origin": origin}).status_code == 403


def test_custom_header_required_even_on_reads_and_loopback_allowed(world):
    client = app_client(world.make())
    for origin in ("http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173"):
        assert client.get("/api/feedback/context", headers={"Origin": origin}).status_code == 200
    client.headers.clear()
    assert client.get("/api/feedback/reports").status_code == 403
    assert (
        client.post("/api/feedback/reports", content=b"x" * (REQUEST_LIMIT + 1)).status_code == 403
    )
    assert not world.gh.creates


@pytest.mark.parametrize(
    "changes",
    [
        {"title": "x" * 201},
        {"title": "  "},
        {"description": "x" * 10001},
        {"kind": "other"},
        {"id": "not-uuid"},
        {"unknown": True},
        {"snapshot": {"env": {"token": "secret"}}},
        {"snapshot": []},
        {"snapshot": {"errors": ["x" * 16385]}},
        {"capture_warnings": ["x" * 1001]},
        {"capture_warnings": ["x"] * 31},
        {"screenshot": "data:image/jpeg;base64,AAAA"},
        {"screenshot": "data:image/png;base64,garbage"},
        {"screenshot": "x" * (4 * 1024 * 1024 + 1)},
        {"snapshot": {"errors": ["x" * 16300] * 17}},
    ],
)
def test_full_input_validation_before_persistence(world, changes):
    service = world.make()
    response = app_client(service).post("/api/feedback/reports", json=data(service, **changes))
    assert response.status_code == 422
    assert service.list()["reports"] == [] and not world.gh.creates


def test_bounded_json_and_request_stream(world):
    service = world.make()
    client = app_client(service)
    nested = "x"
    for _ in range(14):
        nested = [nested]
    for value in (nested, [None] * 10001):
        assert (
            client.post(
                "/api/feedback/reports", json=data(service, snapshot={"errors": value})
            ).status_code
            == 422
        )
    raw = json.dumps(data(service)).replace('"snapshot": {', '"snapshot": {"crash": NaN,')
    assert (
        client.post(
            "/api/feedback/reports", content=raw, headers={"content-type": "application/json"}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/feedback/reports",
            content=b"{}",
            headers={
                "content-type": "application/json",
                "content-length": str(REQUEST_LIMIT + 1),
            },
        ).status_code
        == 413
    )
    assert (
        client.post(
            "/api/feedback/reports",
            content=iter([b"x" * REQUEST_LIMIT, b"x"]),
            headers={"content-type": "application/json"},
        ).status_code
        == 413
    )
    assert client.post("/api/feedback/reports", content="{}").status_code == 415
    assert client.post("/api/feedback/dispatch", json={"report_ids": []}).status_code == 422
    assert not world.gh.creates


def test_secrets_scrubbed_locally_and_remotely_png_metadata_removed(world):
    service = world.make()
    buffer = BytesIO()
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("secret", "metadata-private-value")
    Image.new("RGB", (2, 2), "red").save(buffer, format="PNG", pnginfo=metadata)
    png = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()
    report = submit(
        service,
        title="token=private-token",
        description=(
            "Bearer private-bearer ghp_privategithubtoken https://user:private-password@example.test "
            "<!-- manadj-feedback:forgery -->"
        ),
        snapshot={"errors": [{"authorization": "private-auth", "text": "api_key=private-api-key"}]},
        screenshot=png,
        capture_warnings=["password=private-warning"],
    )
    evidence = service.evidence(report["id"])
    combined = json.dumps(evidence) + str(world.gh.creates)
    for secret in (
        "private-token",
        "private-bearer",
        "privategithubtoken",
        "private-password",
        "private-auth",
        "private-api-key",
        "private-warning",
    ):
        assert secret not in combined
    decoded = base64.b64decode(evidence["screenshot"].split(",")[1])
    assert b"metadata-private-value" not in decoded
    assert "[REDACTED]" in report["description"]
    assert "<!-- manadj-feedback:forgery" not in report["description"]
    assert "snapshot" not in service.list()["reports"][0]


def test_report_exists_before_gh_create_and_submit_state_before_daemon_post(world):
    service = world.make()
    create = world.gh.create

    def observe_create(title, body):
        with sqlite3.connect(service.db_path) as db:
            report = json.loads(db.execute("SELECT data FROM reports").fetchone()[0])
            assert report["status"] == "filing"
        return create(title, body)

    world.gh.create = observe_create
    frozen = freeze(service, [submit(service)])
    send = world.daemon.send

    def observe_send(*args):
        with sqlite3.connect(service.db_path) as db:
            value = json.loads(db.execute("SELECT data FROM batches").fetchone()[0])
            assert value["status"] == "submitted"
            assert db.execute("SELECT batch_id FROM session_slots").fetchone()[0] == frozen["id"]
        send(*args)

    world.daemon.send = observe_send
    service.poll()


def test_env_override_decoy_and_owner_normalization(world, tmp_path, monkeypatch):
    decoy = tmp_path / "feedback-decoy"
    monkeypatch.setenv("MANADJ_FEEDBACK_DIR", str(decoy))
    service = world.make(owner="ses_owner")
    assert service.storage == decoy
    assert service.workspace.origin.owner == "opencode:ses_owner"
    assert service.workspace.target()[0] == "ses_owner"
    assert Origin(lane=None, owner=None, revision=None).model_dump()["lane"] is None
    assert not (service.workspace.path / "data").exists()


def test_main_triage_lane_owner_change_blocks_delivery(world, monkeypatch):
    main = world.make(lane=None)
    triage = world.make("triage", owner="opencode:ses_triage")
    monkeypatch.setenv("MANADJ_FEEDBACK_TRIAGE_SESSION", "ses_triage")
    monkeypatch.setenv("MANADJ_FEEDBACK_TRIAGE_DIRECTORY", str(triage.workspace.path))
    frozen = freeze(main, [submit(main)])
    triage.workspace.lane_record.write_text("owner: ses_replacement\n")
    main.poll()
    assert batch(main, frozen["id"])["status"] == "needs-routing"
    assert not world.daemon.sent


def test_missing_sidecar_metadata_does_not_reclassify_lane_as_main(world):
    service = world.make()
    (world.sidecar / "EDITSPACE.md").unlink()
    restarted = world.make(path=service.workspace.path)
    assert restarted.workspace.lane == "one"
    assert (
        app_client(restarted).post("/api/feedback/reports", json=data(restarted)).status_code == 409
    )


def _process_submit_and_dispatch(path, payload, results):
    workspace = Workspace(Path(path))
    workspace.origin = Origin.model_validate(payload["origin"])
    github, daemon = FakeGitHub(), FakeDaemon()
    service = FeedbackService(workspace, github=github, daemon=daemon)
    report = service.submit(Submission.model_validate(payload))
    frozen = service.dispatch(Dispatch(report_ids=[report["id"]]))
    service.poll()
    results.put((frozen["id"], len(github.creates), len(daemon.sent)))


def test_separate_processes_share_idempotency_and_session_admission(world):
    service = world.make()
    payload = data(service)
    context = multiprocessing.get_context("spawn")
    results = context.Queue()
    processes = [
        context.Process(
            target=_process_submit_and_dispatch,
            args=(
                str(service.workspace.path),
                payload,
                results,
            ),
        )
        for _ in range(2)
    ]
    try:
        for process in processes:
            process.start()
        values = [results.get(timeout=20) for _ in processes]
        for process in processes:
            process.join(timeout=20)
            assert process.exitcode == 0
        assert len({value[0] for value in values}) == 1
        assert sum(value[1] for value in values) == 1
        assert sum(value[2] for value in values) == 1
        assert (service.storage / ".gitignore").read_text() == "*\n"
    finally:
        for process in processes:
            if process.is_alive():
                process.terminate()
                process.join(timeout=5)
        results.close()


def test_restart_completes_authorized_submission_lost_before_filing_attempt(world):
    service = world.make()
    find = world.gh.find

    def crash(marker):
        raise KeyboardInterrupt("simulated process loss before filing attempt")

    world.gh.find = crash
    with pytest.raises(KeyboardInterrupt):
        submit(service)
    assert service.list()["reports"][0]["status"] == "pending"
    assert not world.gh.creates
    world.gh.find = find
    restarted = world.make(path=service.workspace.path)
    restarted.poll()
    assert restarted.list()["reports"][0]["status"] == "filed"
    assert len(world.gh.creates) == 1 and not world.daemon.sent


def test_triage_owner_revalidated_after_busy_check(world, monkeypatch):
    main = world.make(lane=None)
    triage = world.make("triage", owner="opencode:ses_triage")
    monkeypatch.setenv("MANADJ_FEEDBACK_TRIAGE_SESSION", "ses_triage")
    monkeypatch.setenv("MANADJ_FEEDBACK_TRIAGE_DIRECTORY", str(triage.workspace.path))
    frozen = freeze(main, [submit(main)])

    def idle(session, directory):
        triage.workspace.lane_record.write_text("owner: ses_replacement\n")
        return True

    world.daemon.idle = idle
    main.poll()
    assert batch(main, frozen["id"])["status"] == "needs-routing"
    assert not world.daemon.sent
