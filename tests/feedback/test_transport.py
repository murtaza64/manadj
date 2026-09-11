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

    def run(args):
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
    monkeypatch.setattr(gh, "_run", lambda args: raw)
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
                "/session/ses_owner": {"id": state.session, "directory": state.directory},
                "/session/status": state.status,
                "/question": state.questions,
                "/permission": state.permissions,
                "/session/ses_owner/message": state.messages,
            }
            if self.command == "POST":
                state.sent.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
                code, body = 204, b""
            else:
                code, body = 200, json.dumps(values.get(url.path)).encode()
            self.send_response(state.code or code)
            if state.code == 302:
                self.send_header("Location", "/must-not-follow")
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
    daemon.inspect("ses_owner", state.directory)
    assert daemon.idle("ses_owner", state.directory)
    batch_id = str(uuid4())
    daemon.send("ses_owner", state.directory, f"MANADJ_FEEDBACK_BATCH:{batch_id}")
    assert state.sent == [
        {
            "agent": "lane",
            "parts": [
                {
                    "type": "text",
                    "text": f"MANADJ_FEEDBACK_BATCH:{batch_id}",
                }
            ],
        }
    ]
    assert not daemon.acknowledged("ses_owner", state.directory, batch_id)
    assert all(query == {"directory": [state.directory]} for _, _, query in state.requests)
    assert not any(path == "/session" and method == "POST" for method, path, _ in state.requests)


@pytest.mark.parametrize(
    "status",
    [
        {},
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
    assert not state.adapter.acknowledged("ses_owner", state.directory, batch_id)
    state.messages[1]["info"]["parentID"] = "msg_user"
    state.messages[1]["parts"][0]["text"] = f"quoted {ack}"
    assert not state.adapter.acknowledged("ses_owner", state.directory, batch_id)
    state.messages[1]["parts"][0]["text"] = ack
    assert state.adapter.acknowledged("ses_owner", state.directory, batch_id)


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
        state.adapter.send("ses_owner", state.directory, "prompt")
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
