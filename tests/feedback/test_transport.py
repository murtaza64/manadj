"""Exercise gh arguments and the real HTTP adapter against a decoy daemon."""

import json
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest

from backend import feedback_transport
from backend.feedback_transport import Daemon, GitHub, RoutingError, Unavailable, Uncertain


def test_gh_fixed_destination_label_no_shell_and_bounded_errors(monkeypatch):
    calls = []

    def run(args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(
            returncode=0,
            stdout=("https://github.com/murtaza64/manadj/issues/123\n" if "create" in args else ""),
        )

    monkeypatch.setattr(subprocess, "run", run)
    gh = GitHub()
    assert gh.create("$(not a command)", "body") == "https://github.com/murtaza64/manadj/issues/123"
    args, kwargs = calls[-1]
    assert args == [
        "gh",
        "issue",
        "create",
        "--repo",
        "murtaza64/manadj",
        "--label",
        "needs-human",
        "--title",
        "$(not a command)",
        "--body",
        "body",
    ]
    assert kwargs["timeout"] == 25 and not kwargs.get("shell")
    assert kwargs["env"]["GH_PROMPT_DISABLED"] == "1"

    def fail(*args, **kwargs):
        return SimpleNamespace(
            returncode=1, stdout="private response", stderr="private credential" * 10000
        )

    monkeypatch.setattr(subprocess, "run", fail)
    with pytest.raises(Uncertain) as error:
        gh._run(["issue", "create"], writing=True)
    assert len(str(error.value)) < 200 and "private" not in str(error.value)
    with pytest.raises(Unavailable):
        gh.create("title", "body")  # Authentication fails before a write.


@pytest.mark.parametrize("missing", [True, False])
def test_gh_missing_binary_is_retryable_but_write_timeout_is_uncertain(monkeypatch, missing):
    def fail(*args, **kwargs):
        if missing:
            raise FileNotFoundError
        raise subprocess.TimeoutExpired("gh", 25, stderr="secret")

    monkeypatch.setattr(subprocess, "run", fail)
    with pytest.raises(Unavailable if missing else Uncertain):
        GitHub()._run(["issue", "create"], writing=True)


def test_gh_reconcile_paginates_all_states_ignores_prs_and_rejects_duplicates(monkeypatch):
    marker = f"<!-- manadj-feedback:{uuid4()} -->"
    url = "https://github.com/murtaza64/manadj/issues/123"
    pages = [
        [{"body": "unrelated"}] * 99 + [{"body": marker, "pull_request": {}}],
        [{"body": marker, "html_url": url}],
    ]
    paths = []

    def run(args, **kwargs):
        paths.append(args[1])
        return json.dumps(pages.pop(0))

    gh = GitHub()
    monkeypatch.setattr(gh, "_run", run)
    assert gh.find(marker) == url
    assert paths == [
        f"repos/murtaza64/manadj/issues?state=all&per_page=100&page={n}" for n in (1, 2)
    ]
    pages.append([{"body": marker, "html_url": url}] * 2)
    with pytest.raises(Unavailable, match="Multiple issues"):
        gh.find(marker)


@pytest.mark.parametrize(
    "raw", ["not JSON", "{}", '[{"body": 1}]', '[{"body":"MARKER","html_url":"https://evil.test"}]']
)
def test_invalid_gh_reconciliation_response_defers(monkeypatch, raw):
    gh = GitHub()
    monkeypatch.setattr(gh, "_run", lambda args, **kwargs: raw)
    with pytest.raises(Unavailable):
        gh.find("MARKER")


@pytest.fixture
def daemon_server(tmp_path):
    directory = str((tmp_path / "workspace with spaces").resolve())
    state = SimpleNamespace(
        session="ses_owner",
        directory=directory,
        status={"ses_owner": {"type": "idle"}},
        questions=[],
        permissions=[],
        messages=[],
        requests=[],
        sent=[],
        code=None,
        agent="yolo",
        model={"id": "gpt-6-astra", "providerID": "openai"},
        pages=None,
        time={},
    )

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.respond()

        def do_POST(self):
            self.respond()

        def log_message(self, *args):
            pass

        def respond(self):
            url = urlsplit(self.path)
            state.requests.append((self.command, url.path, parse_qs(url.query)))
            values = {
                "/session/ses_owner": {
                    "id": state.session,
                    "directory": state.directory,
                    "agent": state.agent,
                    "model": state.model,
                    "time": state.time,
                },
                "/session/status": state.status,
                "/question": state.questions,
                "/permission": state.permissions,
                "/session/ses_owner/message": state.messages,
            }
            next_cursor = None
            value = values.get(url.path)
            if url.path.startswith("/session/ses_owner/message/"):
                value = next(
                    (
                        item
                        for item in state.messages
                        if item["info"]["id"] == url.path.split("/")[-1]
                    ),
                    None,
                )
            if url.path == "/session/ses_owner/message" and state.pages is not None:
                cursor = parse_qs(url.query).get("before", [None])[0]
                value, next_cursor = (
                    state.pages(parse_qs(url.query))
                    if callable(state.pages)
                    else state.pages[cursor]
                )
            if self.command == "POST":
                state.sent.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
                code, body = 204, b""
            else:
                code, body = 200, json.dumps(value).encode()
            self.send_response(state.code or code)
            if state.code == 302:
                self.send_header("Location", "/must-not-follow")
            if next_cursor:
                self.send_header("X-Next-Cursor", next_cursor)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    state.adapter = Daemon(f"http://127.0.0.1:{server.server_port}")
    yield state
    server.shutdown()
    server.server_close()
    thread.join()


def test_daemon_correct_directory_agent_and_http_acceptance_not_ack(daemon_server):
    state = daemon_server
    daemon = state.adapter
    recipient = daemon.inspect("ses_owner", state.directory)
    assert daemon.idle("ses_owner", state.directory)
    batch_id = str(uuid4())
    daemon.send(
        "ses_owner", state.directory, f"MANADJ_FEEDBACK_BATCH:{batch_id}", **recipient["options"]
    )
    assert state.sent == [
        {
            "agent": "yolo",
            "model": {"modelID": "gpt-6-astra", "providerID": "openai"},
            "parts": [
                {
                    "type": "text",
                    "text": f"MANADJ_FEEDBACK_BATCH:{batch_id}",
                }
            ],
        }
    ]
    assert not daemon.acknowledged("ses_owner", state.directory, batch_id)[0]
    assert all(query["directory"] == [state.directory] for _, _, query in state.requests)
    assert state.requests[-1][2]["limit"] == ["10"]
    assert not any(path == "/session" and method == "POST" for method, path, _ in state.requests)


@pytest.mark.parametrize(
    "status",
    [
        {"ses_owner": {"type": "busy"}},
        {"ses_owner": {"type": "retry"}},
        {"ses_owner": None},
        [],
    ],
)
def test_busy_retry_unknown_status_defer(daemon_server, status):
    daemon_server.status = status
    assert not daemon_server.adapter.idle("ses_owner", daemon_server.directory)
    assert not daemon_server.sent


@pytest.mark.parametrize("field", ["questions", "permissions"])
@pytest.mark.parametrize("pending", [[{"sessionID": "ses_owner"}], [{}], None])
def test_pending_question_permission_or_unknown_shape_defer(daemon_server, field, pending):
    setattr(daemon_server, field, pending)
    assert not daemon_server.adapter.idle("ses_owner", daemon_server.directory)


def test_daemon_ack_requires_matching_user_parent_and_standalone_assistant_line(daemon_server):
    state = daemon_server
    batch_id = str(uuid4())
    marker = f"MANADJ_FEEDBACK_BATCH:{batch_id}"
    ack = f"MANADJ_FEEDBACK_ACK:{batch_id}"
    state.messages = [
        {"info": {"id": "msg_user", "role": "user"}, "parts": [{"type": "text", "text": marker}]},
        {
            "info": {"id": "msg_assistant", "role": "assistant", "parentID": "other"},
            "parts": [{"type": "text", "text": ack}],
        },
    ]
    assert not state.adapter.acknowledged("ses_owner", state.directory, batch_id)[0]
    state.messages[1]["info"]["parentID"] = "msg_user"
    state.messages[1]["parts"][0]["text"] = f"quoted {ack}"
    assert not state.adapter.acknowledged("ses_owner", state.directory, batch_id)[0]
    state.messages[1]["parts"][0]["text"] = ack
    assert state.adapter.acknowledged("ses_owner", state.directory, batch_id)[0]


def test_daemon_identity_and_directory_mismatch_require_routing(daemon_server):
    state = daemon_server
    with pytest.raises(RoutingError):
        state.adapter.inspect("ses_owner", str(Path(state.directory).parent))
    state.session = "ses_other"
    with pytest.raises(RoutingError):
        state.adapter.inspect("ses_owner", state.directory)


@pytest.mark.parametrize("code", [302, 403, 404, 500])
def test_daemon_http_failure_is_not_acceptance_and_never_follows_redirect(daemon_server, code):
    state = daemon_server
    state.code = code
    with pytest.raises(RoutingError if code == 404 else Unavailable):
        state.adapter.inspect("ses_owner", state.directory)
    with pytest.raises(Uncertain):
        state.adapter.send("ses_owner", state.directory, "prompt", agent="yolo")
    assert not any(path == "/must-not-follow" for _, path, _ in state.requests)


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.test:4096",
        "http://localhost.evil:4096",
        "http://user:secret@localhost:4096",
        "http://localhost:99999",
    ],
)
def test_daemon_url_override_is_loopback_only(url):
    with pytest.raises(ValueError):
        Daemon(url)


@pytest.mark.parametrize("anchor", ["root", "sidecar", "lane"])
def test_sparse_idle_uses_verified_root_or_sidecar_anchored_owner_directory(
    daemon_server, tmp_path, anchor
):
    root = tmp_path / "repo"
    lane = root / ".editspace/lanes/owned/repos/murtaza64/manadj"
    lane.mkdir(parents=True)
    actual = {"root": root, "sidecar": root / ".editspace", "lane": lane}[anchor]
    state = daemon_server
    state.directory = str(actual)
    state.status = {}
    recipient = state.adapter.inspect("ses_owner", str(lane))
    assert recipient["directory"] == str(actual)
    assert recipient["options"] == {
        "agent": "yolo",
        "model": {"modelID": "gpt-6-astra", "providerID": "openai"},
    }
    assert state.adapter.idle("ses_owner", recipient["directory"])
    collections = [
        (path, query)
        for _, path, query in state.requests
        if path in {"/session/status", "/question", "/permission"}
    ]
    assert len(collections) == 3
    assert all(query == {"directory": [str(actual)]} for _, query in collections)
    state.adapter.send("ses_owner", recipient["directory"], "decoy prompt", **recipient["options"])
    assert state.sent[0]["agent"] == "yolo"
    assert state.sent[0]["model"] == {"modelID": "gpt-6-astra", "providerID": "openai"}


def test_root_anchor_exception_never_accepts_unrelated_directory(daemon_server, tmp_path):
    lane = tmp_path / "repo/.editspace/lanes/owned/repos/murtaza64/manadj"
    lane.mkdir(parents=True)
    daemon_server.directory = str(tmp_path / "another-repo")
    with pytest.raises(RoutingError):
        daemon_server.adapter.inspect("ses_owner", str(lane))
    daemon_server.directory = str(tmp_path / "repo/.editspace/lanes/other/repos/murtaza64/manadj")
    with pytest.raises(RoutingError):
        daemon_server.adapter.inspect("ses_owner", str(lane))


@pytest.mark.parametrize("fault", ["missing", "archived", "agent", "bad-model", "wrong-directory"])
def test_sparse_idle_requires_verified_existing_unarchived_session(daemon_server, fault):
    state = daemon_server
    expected = state.directory
    state.status = {}
    if fault == "missing":
        state.code = 404
    elif fault == "archived":
        state.time = {"archived": 123}
    elif fault == "agent":
        state.agent = None
    elif fault == "bad-model":
        state.model = {"id": "some-model"}
    else:
        state.directory = str(Path(expected).parent)
    with pytest.raises(RoutingError):
        state.adapter.idle("ses_owner", expected)
    assert not any(path == "/session/status" for _, path, _ in state.requests)


def test_optional_model_absence_omits_override_and_variant_is_preserved(daemon_server):
    state = daemon_server
    state.model = None
    assert state.adapter.inspect("ses_owner", state.directory)["options"] == {"agent": "yolo"}
    state.model = {"id": "model", "providerID": "provider", "variant": "high"}
    options = state.adapter.inspect("ses_owner", state.directory)["options"]
    state.adapter.send("ses_owner", state.directory, "decoy", **options)
    assert state.sent[-1] == {
        "agent": "yolo",
        "model": {"modelID": "model", "providerID": "provider"},
        "variant": "high",
        "parts": [{"type": "text", "text": "decoy"}],
    }


def test_paginated_ack_after_large_history_verifies_parent_via_single_message(daemon_server):
    state = daemon_server
    batch_id = str(uuid4())
    parent = {
        "info": {"id": "msg_batch", "role": "user"},
        "parts": [
            {"type": "text", "text": f"MANADJ_FEEDBACK_BATCH:{batch_id}"},
        ],
    }
    ack = {
        "info": {"id": "msg_ack", "role": "assistant", "parentID": "msg_batch"},
        "parts": [
            {"type": "text", "text": f"MANADJ_FEEDBACK_ACK:{batch_id}"},
        ],
    }
    filler = [
        {
            "info": {"id": f"msg_later{i}", "role": "assistant", "parentID": "msg_unrelated"},
            "parts": [{"type": "text", "text": "x" * 220000}],
        }
        for i in range(30)
    ]
    state.messages = [parent, ack, *filler]
    assert len(json.dumps(state.messages)) > 4 * 1024 * 1024
    state.pages = {
        None: (filler[:10], "older +/1"),
        "older +/1": (filler[10:20], "older2"),
        "older2": (filler[20:], "older3"),
        "older3": ([ack], None),
    }
    cursor = None
    for expected_cursor in ("older +/1", "older2", "older3"):
        acknowledged, cursor = state.adapter.acknowledged(
            "ses_owner", state.directory, batch_id, cursor=cursor
        )
        assert not acknowledged and cursor == expected_cursor
    assert state.adapter.acknowledged("ses_owner", state.directory, batch_id, cursor=cursor) == (
        True,
        None,
    )
    assert state.requests[-1][1] == "/session/ses_owner/message/msg_batch"
    pages = [query for _, path, query in state.requests if path.endswith("/message")]
    assert all(query["limit"] == ["10"] for query in pages)
    assert pages[1]["before"] == ["older +/1"]
    parent["parts"][0]["text"] = f"MANADJ_FEEDBACK_BATCH:{uuid4()}"
    assert state.adapter.acknowledged("ses_owner", state.directory, batch_id, cursor=cursor) == (
        False,
        None,
    )


def test_github_reconciliation_has_total_time_budget(monkeypatch):
    ticks = iter([0, 0, 29, 31])
    monkeypatch.setattr(feedback_transport, "time", SimpleNamespace(monotonic=lambda: next(ticks)))
    github = GitHub()
    timeouts = []

    def run(args, *, timeout):
        timeouts.append(timeout)
        return json.dumps([{"body": "unrelated"}] * 100)

    monkeypatch.setattr(github, "_run", run)
    with pytest.raises(Unavailable, match="time budget"):
        github.find("marker")
    assert timeouts == [25, 1]


def test_history_page_over_limit_retries_one_message_not_unbounded_history(daemon_server):
    state = daemon_server
    item = {
        "info": {"id": "msg_large", "role": "assistant"},
        "parts": [
            {"type": "text", "text": "x" * (600 * 1024)},
        ],
    }
    state.pages = lambda query: ([item] * int(query["limit"][0]), "next-page")
    assert state.adapter.acknowledged("ses_owner", state.directory, str(uuid4())) == (
        False,
        "next-page",
    )
    assert [query["limit"] for _, path, query in state.requests if path.endswith("/message")] == [
        ["10"],
        ["1"],
    ]
