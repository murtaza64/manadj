"""Managed slskd: binary contract, stored credentials, generated config.

Modes (precedence top-down):
- external: `[soulseek] slskd_url` + `SLSKD_API_KEY` set — a user-run slskd
  (Murtaza's launchd daemon). manadj supervises nothing.
- managed: the Soulseek guide stored credentials — manadj generates the
  slskd config + API key in the data root and runs the bundled binary.
- unconfigured: neither; the Soulseek Supplier is absent.

Binary contract (packaging #280): an unpacked, unmodified slskd release
directory (`slskd` executable + `wwwroot/`), located by
1. `MANADJ_SLSKD_BIN` (absolute path to the executable) — the packaged app
   sets this to `<App>/Contents/Resources/slskd/slskd`;
2. `<backend root>/../slskd/slskd` — the DMG layout (#280): the backend
   tree is `Resources/backend/`, slskd goes in the reserved
   `Resources/slskd/`, so no shell env var is needed;
3. `<repo>/vendor/slskd/slskd` — dev, via scripts/slskd/fetch_slskd.py.

Storage: credentials + generated values live behind `ManagedSoulseekStore`;
`DotenvManagedSoulseekStore` keeps them in the data root's .env (the
secrets half of the settings file, ADR 0043) as SOULSEEK_* / SLSKD_MANAGED_*
keys. slskd's own state lives in `<data root>/data/slskd/`.
"""

from __future__ import annotations

import json
import os
import sys
import secrets
import socket
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from backend.data_root import REPO_ROOT, data_root

SLSKD_BIN_ENV = "MANADJ_SLSKD_BIN"
SLSKD_VERSION = "0.26.0"  # keep in sync with scripts/slskd/fetch_slskd.py
SLSKD_SOURCE_URL = f"https://github.com/slskd/slskd/tree/{SLSKD_VERSION}"
SLSKD_LICENSE = "AGPL-3.0"

# Ports preferred for the managed instance; offset from slskd's defaults
# (5030 / 50300) so a user-run slskd on the same machine never collides.
PREFERRED_WEB_PORT = 5130
PREFERRED_LISTEN_PORT = 50310


def slskd_app_dir() -> Path:
    """slskd's app directory (config, its DB, logs, downloads) under the data root."""
    return data_root() / "data" / "slskd"


def resolve_binary() -> Path | None:
    """The slskd executable per the binary contract, or None when not shipped."""
    env = os.environ.get(SLSKD_BIN_ENV)
    candidates = [Path(env)] if env else []
    name = "slskd.exe" if sys.platform == "win32" else "slskd"
    candidates.append(REPO_ROOT.parent / "slskd" / name)
    candidates.append(REPO_ROOT / "vendor" / "slskd" / name)
    for candidate in candidates:
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate
    return None


@dataclass
class ManagedSoulseek:
    """Everything manadj needs to run its own slskd.

    username/password: the user's Soulseek account (new usernames register
    on first login). api_key / web_* / ports: generated once, stable across
    restarts so the URL manadj talks to never moves.
    """

    username: str
    password: str
    api_key: str
    web_username: str
    web_password: str
    web_port: int
    listen_port: int

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.web_port}"


class ManagedSoulseekStore(Protocol):
    def load(self) -> ManagedSoulseek | None: ...
    def save(self, managed: ManagedSoulseek) -> None: ...
    def clear(self) -> None: ...


# .env keys (SOULSEEK_* = the user's account; SLSKD_MANAGED_* = generated)
_ENV_KEYS = {
    "username": "SOULSEEK_USERNAME",
    "password": "SOULSEEK_PASSWORD",
    "api_key": "SLSKD_MANAGED_API_KEY",
    "web_password": "SLSKD_MANAGED_WEB_PASSWORD",
    "web_port": "SLSKD_MANAGED_WEB_PORT",
    "listen_port": "SLSKD_MANAGED_LISTEN_PORT",
}


class DotenvManagedSoulseekStore:
    """The data root's .env (via the process env load_config populates)."""

    def load(self) -> ManagedSoulseek | None:
        values = {field: os.environ.get(key) for field, key in _ENV_KEYS.items()}
        if not all(values.values()):
            return None
        try:
            return ManagedSoulseek(
                username=str(values["username"]),
                password=str(values["password"]),
                api_key=str(values["api_key"]),
                web_username="manadj",
                web_password=str(values["web_password"]),
                web_port=int(str(values["web_port"])),
                listen_port=int(str(values["listen_port"])),
            )
        except ValueError:
            return None

    def save(self, managed: ManagedSoulseek) -> None:
        from backend.settings_file import update_secrets

        update_secrets({key: str(getattr(managed, field)) for field, key in _ENV_KEYS.items()})

    def clear(self) -> None:
        from backend.settings_file import update_secrets

        update_secrets({key: None for key in _ENV_KEYS.values()})


def get_store() -> ManagedSoulseekStore:
    return DotenvManagedSoulseekStore()


def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def pick_port(preferred: int, avoid: frozenset[int] | set[int] = frozenset()) -> int:
    """`preferred` or the next free port above it (bounded), skipping `avoid`."""
    for port in range(preferred, preferred + 200):
        if port not in avoid and _port_free(port):
            return port
    raise RuntimeError(f"no free port near {preferred}")


def new_managed(username: str, password: str, previous: ManagedSoulseek | None = None) -> ManagedSoulseek:
    """Credentials + generated secrets/ports; reuses `previous`'s generated
    values so re-entering credentials does not move the instance."""
    if previous is not None:
        return ManagedSoulseek(
            username=username,
            password=password,
            api_key=previous.api_key,
            web_username=previous.web_username,
            web_password=previous.web_password,
            web_port=previous.web_port,
            listen_port=previous.listen_port,
        )
    web_port = pick_port(PREFERRED_WEB_PORT)
    return ManagedSoulseek(
        username=username,
        password=password,
        api_key=secrets.token_hex(24),
        web_username="manadj",
        web_password=secrets.token_urlsafe(18),
        web_port=web_port,
        listen_port=pick_port(PREFERRED_LISTEN_PORT, avoid={web_port}),
    )


def _q(value: str | int | bool) -> str:
    """A YAML scalar; JSON strings are valid YAML double-quoted scalars."""
    return json.dumps(value)


def render_slskd_config(managed: ManagedSoulseek, app_dir: Path) -> str:
    """slskd.yml for the managed instance.

    Loopback-only web API (HTTPS off), one administrator API key for manadj
    (the Supplier reads /options), no shares — manadj downloads, it does not
    serve a library (soulseek-supplier PRD non-goal).
    """
    downloads = app_dir / "downloads"
    incomplete = app_dir / "incomplete"
    return "\n".join([
        "# Generated by manadj (setup-guides #291). Edits are overwritten.",
        "remote_configuration: false",
        "flags:",
        "  no_version_check: true",
        "  no_share_scan: true",
        "directories:",
        f"  downloads: {_q(str(downloads))}",
        f"  incomplete: {_q(str(incomplete))}",
        "shares:",
        "  directories: []",
        "web:",
        f"  port: {managed.web_port}",
        "  ip_address: \"127.0.0.1\"",
        "  https:",
        "    disabled: true",
        "  authentication:",
        f"    username: {_q(managed.web_username)}",
        f"    password: {_q(managed.web_password)}",
        "    api_keys:",
        "      manadj:",
        f"        key: {_q(managed.api_key)}",
        "        role: administrator",
        "        cidr: \"127.0.0.1/32,::1/128\"",
        "soulseek:",
        f"  username: {_q(managed.username)}",
        f"  password: {_q(managed.password)}",
        f"  listen_port: {managed.listen_port}",
        "  description: \"manaDJ\"",
        "",
    ])


def write_slskd_config(managed: ManagedSoulseek, app_dir: Path) -> Path:
    app_dir.mkdir(parents=True, exist_ok=True)
    for sub in ("downloads", "incomplete"):
        (app_dir / sub).mkdir(exist_ok=True)
    path = app_dir / "slskd.yml"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(render_slskd_config(managed, app_dir))
    tmp.chmod(0o600)
    tmp.replace(path)
    return path
