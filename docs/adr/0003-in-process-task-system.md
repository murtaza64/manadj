# In-process SQLite-backed task system, no external broker

manadj needs background work (SoundCloud downloads, and eventually waveform generation and Analysis). We chose a minimal generic task system — task rows in the app's SQLite DB (type, payload, state, error, timestamps), executed by an in-process worker inside the FastAPI app — over per-feature ad-hoc threads (the `waveform_worker.py` pattern) and over a real job queue (Celery/arq + broker). manadj is a single-user local app: an external broker is operational overhead with no payoff, while DB-backed tasks make in-progress work, failures, retries, and history observable through the normal API/UI.

## Consequences

- Tasks survive restarts; interrupted `running` tasks must be recovered (re-queued or failed) on startup.
- `waveform_worker.py` should eventually migrate onto the task system.
- Parallelism is bounded per task type (e.g. 1–2 concurrent SoundCloud downloads to respect rate limits).
