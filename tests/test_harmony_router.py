"""GET /api/harmony/loops (chord-match #388): moving loops only, int8 residuals."""

import base64

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend import harmony as h
from backend.database import get_db
from backend.harmony_tasks import store_result
from backend.routers import harmony as harmony_router


@pytest.fixture
def client(db_session: Session) -> TestClient:
    app = FastAPI()
    app.include_router(harmony_router.router, prefix="/api/harmony")
    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


def _chord(*pcs: int) -> np.ndarray:
    v = np.zeros(12)
    v[list(pcs)] = 1.0
    return v / np.linalg.norm(v)


G, D, A, Bm = _chord(7, 11, 2), _chord(2, 6, 9), _chord(9, 1, 4), _chord(11, 2, 6)


def _result(bars: np.ndarray) -> h.HarmonyResult:
    return h.HarmonyResult("mix", np.arange(len(bars)) * 2.0, bars, (0, len(bars)), h.fold_loop(bars))


def test_loops_serve_moving_loops_as_int8_residuals(client, db_session, make_track) -> None:
    melodic, drone, nodrop = make_track(), make_track(), make_track()
    prog = np.array([G, G, D, D, A, A, Bm, Bm] * 2)
    store_result(db_session, melodic.id, _result(prog))
    store_result(db_session, drone.id, _result(np.array([Bm] * 16)))
    store_result(db_session, nodrop.id, h.HarmonyResult("mix", np.zeros(0), np.zeros((0, 12)), None, None))

    body = client.get("/api/harmony/loops").json()
    assert body["bars"] == 8
    assert set(body["loops"]) == {str(melodic.id)}
    q = np.frombuffer(base64.b64decode(body["loops"][str(melodic.id)]), dtype=np.int8)
    assert q.shape == (96,)
    residual = q.reshape(8, 12) / 127
    expected = h.chord_residual(prog[:8])
    assert np.allclose(residual, expected, atol=0.01)


def test_chord_match_reference_is_rotation_invariant() -> None:
    prog = np.array([G, G, D, D, A, A, Bm, Bm])
    assert h.chord_match(prog, np.roll(prog, 3, 0)) == pytest.approx(1.0)
    assert h.chord_match(prog, np.array([Bm, G] * 4)) < 0.7
