"""Rate-limit backoff at the task-system interface (acquisition issue 08).

Module-interface tests (ADR-0002): real in-memory DB + real run_pending; the
handler is a fake that raises RateLimitedError on cue. No live threads, no
network, no real waiting — the pacing `sleep` is injected.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from sqlalchemy.orm import Session

from backend.acquisition.source import RateLimitedError, is_rate_limit
from backend.tasks.manager import (
    BACKOFF_MINUTES,
    MAX_ATTEMPTS,
    create_task,
    run_pending,
)
from backend.tasks.models import Task


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def rate_limited_handler(fail_times: int = 10_000):
    """A handler that raises RateLimitedError its first `fail_times` calls."""
    calls = {"n": 0}

    def handle(db: Session, payload: dict[str, Any]) -> None:
        calls["n"] += 1
        if calls["n"] <= fail_times:
            raise RateLimitedError("HTTP Error 429: Too Many Requests")

    handle.calls = calls  # type: ignore[attr-defined]
    return handle


class TestIsRateLimit:
    def test_detects_429_and_phrase(self) -> None:
        assert is_rate_limit(Exception("HTTP Error 429: Too Many Requests"))
        assert is_rate_limit(Exception("too many requests, slow down"))

    def test_ignores_other_errors(self) -> None:
        assert not is_rate_limit(Exception("HTTP Error 403: geo-blocked"))
        assert not is_rate_limit(Exception("no info returned"))


class TestNotBeforeGate:
    def test_future_not_before_is_not_picked_up(self, db_session: Session) -> None:
        task = create_task(db_session, "download", {}, ref="source_item:1")
        task.not_before = _now() + timedelta(minutes=30)
        db_session.commit()

        ran: list[dict[str, Any]] = []
        processed = run_pending(db_session, {"download": lambda db, p: ran.append(p)})

        assert processed == 0
        assert ran == []
        db_session.refresh(task)
        assert task.state == "pending"

    def test_past_not_before_is_picked_up(self, db_session: Session) -> None:
        task = create_task(db_session, "download", {}, ref="source_item:1")
        task.not_before = _now() - timedelta(minutes=1)
        db_session.commit()

        processed = run_pending(db_session, {"download": lambda db, p: None})

        assert processed == 1
        db_session.refresh(task)
        assert task.state == "done"


class TestBackoffProgression:
    def test_each_429_advances_attempts_and_backoff(self, db_session: Session) -> None:
        task = create_task(db_session, "download", {}, ref="source_item:1")
        handler = rate_limited_handler()

        # Each run_pending call picks the task once, is rate-limited, defers it.
        for expected_attempt in range(1, MAX_ATTEMPTS):
            before = _now()
            run_pending(db_session, {"download": handler})
            db_session.refresh(task)

            assert task.attempts == expected_attempt
            assert task.state == "pending"
            assert task.error is None  # deferral is not a failure
            expected_delay = timedelta(minutes=BACKOFF_MINUTES[expected_attempt - 1])
            # not_before lands ~expected_delay in the future (allow slack)
            gap = task.not_before - before
            assert expected_delay - timedelta(seconds=5) <= gap <= expected_delay + timedelta(minutes=1)

            # Clear the gate so the next run_pending re-picks it.
            task.not_before = _now() - timedelta(seconds=1)
            db_session.commit()

    def test_exhausted_attempts_become_failed(self, db_session: Session) -> None:
        task = create_task(db_session, "download", {}, ref="source_item:1")
        handler = rate_limited_handler()

        for _ in range(MAX_ATTEMPTS):
            run_pending(db_session, {"download": handler})
            db_session.refresh(task)
            if task.state == "pending":
                task.not_before = _now() - timedelta(seconds=1)
                db_session.commit()

        assert task.attempts == MAX_ATTEMPTS
        assert task.state == "failed"
        assert task.error is not None and "rate-limited" in task.error

    def test_recovers_when_limit_clears(self, db_session: Session) -> None:
        task = create_task(db_session, "download", {}, ref="source_item:1")
        handler = rate_limited_handler(fail_times=1)

        run_pending(db_session, {"download": handler})
        db_session.refresh(task)
        assert task.state == "pending" and task.attempts == 1

        task.not_before = _now() - timedelta(seconds=1)
        db_session.commit()
        run_pending(db_session, {"download": handler})
        db_session.refresh(task)
        assert task.state == "done"


class TestQueueDeferral:
    def test_429_defers_whole_download_queue(self, db_session: Session) -> None:
        # Three queued downloads; the first is rate-limited.
        tasks = [
            create_task(db_session, "download", {}, ref=f"source_item:{i}")
            for i in range(3)
        ]
        handler = rate_limited_handler(fail_times=1)

        before = _now()
        processed = run_pending(db_session, {"download": handler})

        # Only the first task was attempted (1 processed); the rest are held.
        assert processed == 1
        assert handler.calls["n"] == 1  # type: ignore[attr-defined]

        for task in tasks:
            db_session.refresh(task)
            assert task.state == "pending"
            assert task.not_before is not None
            assert task.not_before > before  # every task deferred into future

    def test_deferral_does_not_pull_later_tasks_forward(self, db_session: Session) -> None:
        first = create_task(db_session, "download", {}, ref="source_item:1")
        # A task already parked far in the future must not be dragged earlier.
        far = create_task(db_session, "download", {}, ref="source_item:2")
        far_when = _now() + timedelta(hours=6)
        far.not_before = far_when
        db_session.commit()

        run_pending(db_session, {"download": rate_limited_handler(fail_times=1)})

        db_session.refresh(far)
        # unchanged (within storage precision)
        assert abs((far.not_before - far_when).total_seconds()) < 1
        db_session.refresh(first)
        assert first.not_before < far_when

    def test_cooldown_scoped_to_type(self, db_session: Session) -> None:
        download = create_task(db_session, "download", {}, ref="source_item:1")
        other = create_task(db_session, "waveform", {}, ref="track:1")

        run_pending(db_session, {"download": rate_limited_handler(fail_times=1)})

        db_session.refresh(other)
        # A different task type keeps its clean slate.
        assert other.not_before is None
        assert other.state == "pending"


class TestPacing:
    def test_sleeps_between_delayed_tasks(self, db_session: Session) -> None:
        for i in range(3):
            create_task(db_session, "download", {}, ref=f"source_item:{i}")
        slept: list[float] = []

        run_pending(
            db_session,
            {"download": lambda db, p: None},
            delays={"download": 3.0},
            sleep=slept.append,
        )

        # One pace-sleep after each of the three tasks.
        assert slept == [3.0, 3.0, 3.0]

    def test_no_sleep_without_configured_delay(self, db_session: Session) -> None:
        create_task(db_session, "download", {}, ref="source_item:1")
        slept: list[float] = []

        run_pending(
            db_session,
            {"download": lambda db, p: None},
            sleep=slept.append,
        )

        assert slept == []
