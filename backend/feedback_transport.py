"""Bounded, send-only feedback transports. No app DB or agent provisioning."""

import json
import os
import re
import subprocess
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlencode, urlsplit

REPOSITORY = "murtaza64/manadj"


class Unavailable(Exception):
    """No write attempted, or a read could not establish the outcome."""


class Uncertain(Exception):
    """A write may have reached the remote. Never blindly repeat it."""


class RoutingError(Exception):
    """The pinned recipient is no longer authoritative."""


def loopback_url(value: str) -> bool:
    try:
        parsed = urlsplit(value)
        port = parsed.port  # Validate malformed/out-of-range ports, even for default HTTP ports.
        return (
            parsed.scheme in {"http", "https"}
            and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
            and parsed.username is None
            and parsed.password is None
            and (port is None or port > 0)
            and not parsed.query
            and not parsed.fragment
            and parsed.path in {"", "/"}
        )
    except ValueError:
        return False


class GitHub:
    def _run(self, args: list[str], *, writing: bool = False) -> str:
        try:
            result = subprocess.run(
                ["gh", *args],
                capture_output=True,
                text=True,
                timeout=25,
                check=False,
                env={**os.environ, "GH_PROMPT_DISABLED": "1"},
            )
        except FileNotFoundError as exc:
            raise Unavailable("Install/authenticate gh, then retry filing.") from exc
        except (subprocess.TimeoutExpired, OSError) as exc:
            error = Uncertain if writing else Unavailable
            raise error("GitHub transport interrupted; reconciliation required.") from exc
        if result.returncode or len(result.stdout) > 2 * 1024 * 1024:
            error = Uncertain if writing else Unavailable
            # Never persist CLI stderr: it can contain credentials or request bodies.
            raise error("GitHub request failed; check gh authentication/connectivity.")
        return result.stdout

    def find(self, marker: str) -> str | None:
        # Enumerate rather than use GitHub's eventually indexed search. Even a
        # complete negative read is NOT proof that an uncertain create failed.
        matches = []
        for page in range(1, 101):
            raw = self._run(
                [
                    "api",
                    f"repos/{REPOSITORY}/issues?state=all&per_page=100&page={page}",
                ]
            )
            try:
                issues = json.loads(raw)
                if not isinstance(issues, list):
                    raise TypeError
                for issue in issues:
                    if "pull_request" not in issue and marker in (issue.get("body") or ""):
                        url = issue["html_url"]
                        if not re.fullmatch(
                            r"https://github\.com/murtaza64/manadj/issues/\d+", url
                        ):
                            raise ValueError
                        matches.append(url)
            except (ValueError, KeyError, TypeError, AttributeError) as exc:
                raise Unavailable("Invalid GitHub reconciliation response.") from exc
            if len(issues) < 100:
                if len(matches) > 1:
                    raise Unavailable("Multiple issues carry this report marker; review manually.")
                return matches[0] if matches else None
        raise Unavailable("GitHub reconciliation limit reached; review manually.")

    def create(self, title: str, body: str) -> str:
        self._run(["auth", "status"])
        output = self._run(
            [
                "issue",
                "create",
                "--repo",
                REPOSITORY,
                "--label",
                "needs-human",
                "--title",
                title,
                "--body",
                body,
            ],
            writing=True,
        ).strip()
        if not re.fullmatch(r"https://github\.com/murtaza64/manadj/issues/\d+", output):
            raise Uncertain("GitHub create returned no verified issue URL; reconcile before retry.")
        return output


class Daemon:
    def __init__(self, url: str | None = None):
        self.url = url or os.getenv("MANADJ_FEEDBACK_DAEMON_URL", "http://127.0.0.1:4096")
        if not loopback_url(self.url):
            raise ValueError("MANADJ_FEEDBACK_DAEMON_URL must be a loopback HTTP(S) URL")

    def _request(self, method: str, path: str, directory: str, body=None):
        url = f"{self.url.rstrip('/')}{path}?{urlencode({'directory': directory})}"

        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None

        try:
            # No redirects, proxy environment, credential/config reads, or shell.
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
            request = urllib.request.Request(
                url,
                method=method,
                data=json.dumps(body).encode() if body is not None else None,
                headers={"Content-Type": "application/json"},
            )
            with opener.open(request, timeout=10) as response:
                data = response.read(4 * 1024 * 1024 + 1)
                if len(data) > 4 * 1024 * 1024:
                    raise ValueError("response limit")
            return json.loads(data) if data else None
        except (urllib.error.URLError, OSError, ValueError) as exc:
            if (
                isinstance(exc, urllib.error.HTTPError)
                and exc.code == 404
                and method == "GET"
                and re.fullmatch(r"/session/ses_[A-Za-z0-9]+", path)
            ):
                raise RoutingError("Owning session is missing; route this batch manually.") from exc
            error = Uncertain if method == "POST" else Unavailable
            raise error(
                "Agent daemon unavailable or response unverified; delivery deferred."
            ) from exc

    def inspect(self, session: str, directory: str) -> None:
        info = self._request("GET", f"/session/{session}", directory)
        if not isinstance(info, dict) or info.get("id") != session:
            raise RoutingError("Owning session identity could not be verified.")
        time = info.get("time", {})
        if not isinstance(time, dict):
            raise Unavailable("Session metadata could not be verified.")
        if time.get("archived"):
            raise RoutingError("Owning session is archived; route this batch manually.")
        actual = info.get("directory")
        if not isinstance(actual, str) or Path(actual).resolve() != Path(directory).resolve():
            raise RoutingError("Owning session directory changed; route this batch manually.")

    def idle(self, session: str, directory: str) -> bool:
        status = self._request("GET", "/session/status", directory)
        if not isinstance(status, dict) or status.get(session) != {"type": "idle"}:
            return False
        for endpoint in ("/question", "/permission"):
            pending = self._request("GET", endpoint, directory)
            if not isinstance(pending, list) or any(
                not isinstance(item, dict)
                or not isinstance(item.get("sessionID"), str)
                or item["sessionID"] == session
                for item in pending
            ):
                return False
        return True

    def acknowledged(self, session: str, directory: str, batch_id: str) -> bool:
        messages = self._request("GET", f"/session/{session}/message", directory)
        if not isinstance(messages, list):
            raise Unavailable("Agent message history could not be verified.")
        marker = f"MANADJ_FEEDBACK_BATCH:{batch_id}"
        ack = f"MANADJ_FEEDBACK_ACK:{batch_id}"
        try:
            parents = {
                message["info"]["id"]
                for message in messages
                if message["info"]["role"] == "user"
                and any(
                    part.get("type") == "text" and marker in part.get("text", "").splitlines()
                    for part in message["parts"]
                )
            }
            return any(
                message["info"]["role"] == "assistant"
                and message["info"].get("parentID") in parents
                and any(
                    part.get("type") == "text" and ack in part.get("text", "").splitlines()
                    for part in message["parts"]
                )
                for message in messages
            )
        except (KeyError, TypeError, AttributeError) as exc:
            raise Unavailable("Agent message history could not be verified.") from exc

    def send(self, session: str, directory: str, prompt: str) -> None:
        self._request(
            "POST",
            f"/session/{session}/prompt_async",
            directory,
            {
                "agent": "lane",
                "parts": [{"type": "text", "text": prompt}],
            },
        )
