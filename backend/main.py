"""Main FastAPI application."""

import os
from pathlib import Path

from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import tracks, tags, waveforms, playlists, beatgrids, hotcues, sync_playlists, sync_status, sync_performance, sync_tags, sync_tracks, sync_library, analyze, transitions, transition_templates
from .acquisition import models as acquisition_models  # noqa: F401  (registers tables on Base)
from .acquisition.router import router as acquisition_router
from .tasks import models as task_models  # noqa: F401  (registers tables on Base)
from .tasks.worker import TaskWorker
from .logging_config import setup_logging

# Configure logging with colors and override uvicorn handlers
setup_logging()

# Migrate the database to the latest revision (replaces Base.metadata.create_all)
_alembic_cfg = AlembicConfig(str(Path(__file__).parent.parent / "alembic.ini"))
_alembic_cfg.attributes["configure_logger"] = False  # don't clobber app logging
alembic_command.upgrade(_alembic_cfg, "head")

app = FastAPI(title="Music Library Manager", version="1.0.0")

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    # Any localhost port: lanes run vite on per-lane port offsets
    # (docs/agents/parallel-work.md), so a fixed port list fights the setup.
    allow_origin_regex=r"http://localhost:\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(tracks.router, prefix="/api/tracks", tags=["tracks"])
app.include_router(tags.router, prefix="/api/tags", tags=["tags"])
app.include_router(waveforms.router, prefix="/api/waveforms", tags=["waveforms"])
app.include_router(playlists.router, prefix="/api/playlists", tags=["playlists"])
app.include_router(beatgrids.router, prefix="/api/beatgrids", tags=["beatgrids"])
app.include_router(hotcues.router, prefix="/api/hotcues", tags=["hotcues"])
app.include_router(analyze.router, prefix="/api/analyze", tags=["analyze"])
app.include_router(transitions.router, prefix="/api/transitions", tags=["transitions"])
app.include_router(sync_playlists.router, prefix="/api")
app.include_router(sync_tags.router, prefix="/api")
app.include_router(sync_tracks.router, prefix="/api")
app.include_router(sync_status.router, prefix="/api")
app.include_router(sync_performance.router, prefix="/api")
app.include_router(sync_library.router, prefix="/api")
app.include_router(acquisition_router, prefix="/api/acquisition", tags=["acquisition"])
app.include_router(transition_templates.router, prefix="/api/transition-templates", tags=["transition-templates"])



def _waveform_generation_enabled() -> bool:
    return os.getenv("DISABLE_WAVEFORM_WORKER", "").lower() not in ("true", "1", "yes")


def _build_task_worker() -> "TaskWorker | None":
    """The task worker (ADR-0003): waveform generation always, downloads if configured."""
    import logging

    from .config import get_config
    from .database import SessionLocal

    handlers = {}

    if _waveform_generation_enabled():
        from .waveform_tasks import WAVEFORM_TASK_TYPE, make_waveform_handler
        handlers[WAVEFORM_TASK_TYPE] = make_waveform_handler()
    else:
        logging.getLogger("backend.main").info(
            "waveform generation disabled via DISABLE_WAVEFORM_WORKER"
        )

    config = get_config()
    if config.soundcloud.oauth_token and config.library.tracks_directory:
        from .acquisition.download import download_handler
        from .acquisition.source import SoundCloudSource

        source = SoundCloudSource(config.soundcloud.oauth_token)
        handlers["download"] = download_handler(
            source, Path(config.library.tracks_directory), config.acquisition.cleanup
        )
    else:
        logging.getLogger("backend.main").warning(
            "download handler not registered: soundcloud oauth_token or tracks_directory missing"
        )

    if not handlers:
        return None
    return TaskWorker(SessionLocal, handlers)


_task_worker: "TaskWorker | None" = None


@app.on_event("startup")
async def startup_event():
    """Start background workers on server startup."""
    global _task_worker

    # Waveform data generation (ADR 0014) requires ffmpeg; fail loudly at startup.
    from .waveform_data import ensure_ffmpeg
    ensure_ffmpeg()
    if os.getenv("DISABLE_TASK_WORKER", "").lower() not in ("true", "1", "yes"):
        _task_worker = _build_task_worker()
        if _task_worker is not None:
            _task_worker.start()

        # Sweep: any Track still lacking Waveform data gets a task.
        if _waveform_generation_enabled():
            from .database import SessionLocal
            from .waveform_tasks import enqueue_missing_waveforms

            db = SessionLocal()
            try:
                enqueue_missing_waveforms(db)
            finally:
                db.close()


@app.on_event("shutdown")
async def shutdown_event():
    """Stop background workers on server shutdown."""
    if _task_worker is not None:
        _task_worker.stop()


@app.get("/")
def root():
    return {"message": "Music Library Manager API"}
