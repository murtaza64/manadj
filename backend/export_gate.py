"""Export gate (ADR 0043): External-library writes are opt-in.

FastAPI dependency for endpoints that WRITE to Rekordbox/Engine libraries.
Imports are never gated. Toggle lives in the settings file ([export] enabled),
surfaced in Settings -> Library.
"""

from fastapi import HTTPException

from backend.config import get_config

EXPORT_DISABLED_DETAIL = (
    "Export to external libraries is turned off. Enable it in Settings → Library."
)


def require_export_enabled() -> None:
    if not get_config().export.enabled:
        raise HTTPException(status_code=403, detail=EXPORT_DISABLED_DETAIL)
