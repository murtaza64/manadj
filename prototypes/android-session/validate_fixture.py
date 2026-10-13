"""Validate fixture imports with the actual desktop HTTP schemas; no database access."""
import json
from pathlib import Path

from backend.schemas import PaginatedTracks, SessionDetail

assets = Path(__file__).parent / "app/src/main/assets"
session = SessionDetail.model_validate_json((assets / "session.json").read_text())
tracks = PaginatedTracks.model_validate_json((assets / "tracks.json").read_text()).items
assert len(session.events) >= 35
assert len(tracks) == 8
assert {event["channel"] for event in session.events if event["kind"] == "load"} == {"A", "B", "C", "D"}
print("Desktop SessionDetail and 8 Track schemas passed")
