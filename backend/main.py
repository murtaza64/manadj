"""Main FastAPI application."""

import os
from pathlib import Path

from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from .routers import tracks, tags, waveforms, playlists, beatgrids, hotcues, sync_playlists, sync_status, sync_performance, sync_tags, sync_tracks, sync_library, analyze
from .acquisition import models as acquisition_models  # noqa: F401  (registers tables on Base)
from .acquisition.router import router as acquisition_router
from .tasks import models as task_models  # noqa: F401  (registers tables on Base)
from .tasks.worker import TaskWorker
from .waveform_worker import start_waveform_worker, stop_waveform_worker
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
    allow_origins=[
        "http://localhost:5173",  # Vite dev server
        "http://localhost:5174",  # Vite dev server
    ],
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
app.include_router(sync_playlists.router, prefix="/api")
app.include_router(sync_tags.router, prefix="/api")
app.include_router(sync_tracks.router, prefix="/api")
app.include_router(sync_status.router, prefix="/api")
app.include_router(sync_performance.router, prefix="/api")
app.include_router(sync_library.router, prefix="/api")
app.include_router(acquisition_router, prefix="/api/acquisition", tags=["acquisition"])

# Mount static files for PNG waveforms (create the dir if absent — it is
# gitignored, so fresh checkouts/workspaces don't have it)
Path("waveforms").mkdir(exist_ok=True)
app.mount("/waveforms", StaticFiles(directory="waveforms"), name="waveforms")


def _build_task_worker() -> "TaskWorker | None":
    """The task worker (ADR-0003) with the download handler, if configured."""
    from .acquisition.download import download_handler
    from .acquisition.source import SoundCloudSource
    from .config import get_config
    from .database import SessionLocal

    config = get_config()
    if not config.soundcloud.oauth_token or not config.library.tracks_directory:
        import logging
        logging.getLogger("backend.main").warning(
            "task worker not started: soundcloud oauth_token or tracks_directory missing"
        )
        return None
    source = SoundCloudSource(config.soundcloud.oauth_token)
    handlers = {
        "download": download_handler(
            source, Path(config.library.tracks_directory), config.acquisition.cleanup
        )
    }
    return TaskWorker(SessionLocal, handlers)


_task_worker: "TaskWorker | None" = None


@app.on_event("startup")
async def startup_event():
    """Start background workers on server startup."""
    global _task_worker
    if os.getenv("DISABLE_TASK_WORKER", "").lower() not in ("true", "1", "yes"):
        _task_worker = _build_task_worker()
        if _task_worker is not None:
            _task_worker.start()

    # Check if waveform worker is disabled via environment variable
    if os.getenv("DISABLE_WAVEFORM_WORKER", "").lower() in ("true", "1", "yes"):
        import logging
        logging.getLogger("backend.main").info("Waveform worker disabled via DISABLE_WAVEFORM_WORKER environment variable")
        return

    start_waveform_worker()


@app.on_event("shutdown")
async def shutdown_event():
    """Stop background workers on server shutdown."""
    if _task_worker is not None:
        _task_worker.stop()
    if os.getenv("DISABLE_WAVEFORM_WORKER", "").lower() not in ("true", "1", "yes"):
        stop_waveform_worker()


@app.get("/")
def root():
    return {"message": "Music Library Manager API"}
