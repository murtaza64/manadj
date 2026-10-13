"""Packaged-app backend launcher with a graceful-shutdown hook (#314).

The Electron shell (desktop/backend.js) runs `python -m backend.serve`
instead of `python -m uvicorn`. POSIX signals give uvicorn a clean shutdown
on macOS/Linux, but on Windows `child.kill()` is TerminateProcess: no
lifespan shutdown, no task-worker stop, no SQLite checkpoint. So the shell
asks politely first:

    POST /api/_shell/shutdown   header X-Manadj-Shell-Token: <token>

The token comes from MANADJ_SHELL_TOKEN (random per launch, set by the
shell), so nothing else on the machine can stop the backend. No token in the
environment = no route. If the request fails or the backend doesn't exit in
time, the shell falls back to a process-tree kill.

MANADJ_SHELL_LIFELINE=1: the shell holds our stdin open and never writes;
EOF (shell crashed or was force-quit) stops the server.
"""

from __future__ import annotations

import argparse
import hmac
import os
import sys
import threading

import uvicorn
from fastapi import Header, HTTPException, Response

SHUTDOWN_PATH = "/api/_shell/shutdown"
TOKEN_ENV = "MANADJ_SHELL_TOKEN"
LIFELINE_ENV = "MANADJ_SHELL_LIFELINE"


def install_shutdown_route(app, server: uvicorn.Server, token: str) -> None:
    """Register the token-guarded shutdown route on `app` for `server`.

    POST-only, so the SPA's GET catch-all (backend/spa.py) never shadows it.
    """

    def shutdown(x_manadj_shell_token: str = Header(default="")) -> Response:
        if not hmac.compare_digest(x_manadj_shell_token, token):
            raise HTTPException(status_code=403, detail="bad shell token")
        server.should_exit = True  # uvicorn finishes in-flight requests, runs shutdown
        return Response(status_code=202)

    app.add_api_route(SHUTDOWN_PATH, shutdown, methods=["POST"], include_in_schema=False)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, required=True)
    args = ap.parse_args(argv)

    from backend.main import app  # heavy import (migrations, routers) after arg parsing

    # log_config=None: keep backend.logging_config's handlers (set up when
    # backend.main imported); uvicorn's default dictConfig would clobber them.
    server = uvicorn.Server(
        uvicorn.Config(app, host=args.host, port=args.port, log_config=None)
    )
    token = os.environ.get(TOKEN_ENV)
    if token:
        install_shutdown_route(app, server, token)
    if os.environ.get(LIFELINE_ENV):
        watch_lifeline(server, sys.stdin)
    server.run()


def watch_lifeline(server: uvicorn.Server, stream) -> threading.Thread:
    """Exit when the shell's end of our stdin closes (shell crashed/killed).

    The shell never writes to the pipe; EOF means it is gone, so don't
    linger as an orphan holding the DB and port.
    """

    def wait() -> None:
        try:
            while stream.read(1024):
                pass
        except (OSError, ValueError):
            pass
        server.should_exit = True

    thread = threading.Thread(target=wait, name="shell-lifeline", daemon=True)
    thread.start()
    return thread


if __name__ == "__main__":
    main()
