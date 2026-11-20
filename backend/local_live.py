"""Ephemeral, opt-in own-device live state mirror. No Session/library writes.

Publisher is the loopback desktop UI. LAN readers use the existing paired
listener, never a friend/public endpoint. Five-Hz anchors are a prototype,
not lossless gesture replay or a promise of audio-clock synchronization.
"""
from __future__ import annotations

import threading
import time
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Track
from backend.routers.device_sync import audio_rev


class DeckAnchor(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    track_id: int | None = Field(default=None, gt=0)
    position: float = Field(ge=0, le=172800)
    playing: bool
    pitch: float = Field(ge=-25, le=25)
    bend: float = Field(ge=-25, le=25)
    fader: float = Field(ge=0, le=1)
    trim: float = Field(ge=0, le=1)
    low: float = Field(ge=0, le=1)
    mid: float = Field(ge=0, le=1)
    high: float = Field(ge=0, le=1)
    filter: float = Field(ge=-1, le=1)
    key_lock: bool
    unsupported: list[str] = Field(default_factory=list, max_length=16)


class LiveAnchor(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    stream_id: UUID
    seq: int = Field(ge=0)
    decks: list[DeckAnchor] = Field(min_length=4, max_length=4)
    unsupported: list[str] = Field(default_factory=list, max_length=16)


class LiveMailbox:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.lock = threading.Lock()
        self.current = None
        self.published = 0.0

    def publish(self, anchor: dict):
        with self.lock:
            age = self.clock() - self.published
            if self.current and age <= 2:
                if self.current["stream_id"] != anchor["stream_id"]:
                    raise HTTPException(409, "Another desktop window is live. Stop it first.")
                if anchor["seq"] <= self.current["seq"]:
                    raise HTTPException(409, "Out-of-order live anchor")
            self.current = anchor
            self.published = self.clock()

    def read(self):
        with self.lock:
            age = max(0, self.clock() - self.published)
            if not self.current or age > 2:
                return {"version": 1, "state": "offline", "age": age if self.current else 0, "anchor": None}
            return {"version": 1, "state": "live", "age": age, "anchor": self.current}

    def stop(self, stream_id):
        with self.lock:
            if self.current and self.current["stream_id"] == stream_id:
                self.current = None


mailbox = LiveMailbox()
publisher = APIRouter()
reader = APIRouter()


def loopback(request: Request):
    if request.client is None or request.client.host not in ("127.0.0.1", "::1", "testclient"):
        raise HTTPException(403, "Live publishing is local desktop only")


@publisher.post("/anchor", dependencies=[Depends(loopback)])
def publish(anchor: LiveAnchor, db: Session = Depends(get_db)):
    body = anchor.model_dump(mode="json")
    for row in body["decks"]:
        track = db.get(Track, row["track_id"]) if row["track_id"] else None
        row["audio_rev"] = audio_rev(track.filename) if track else None
        if row["track_id"] and row["audio_rev"] is None:
            row["unsupported"].append("Audio unavailable")
    mailbox.publish(body)
    return {"published": anchor.seq}


@publisher.delete("/{stream_id}", dependencies=[Depends(loopback)])
def stop(stream_id: UUID):
    mailbox.stop(str(stream_id))
    return {"stopped": True}


@reader.get("/live")
def read_live():
    return mailbox.read()
