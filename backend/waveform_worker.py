"""Background worker for generating waveforms."""

import threading
import time
import logging
from pathlib import Path
from sqlalchemy.orm import Session
from .database import SessionLocal
from . import crud, models

logger = logging.getLogger(__name__)


class WaveformWorker:
    """Background worker that generates waveforms for tracks."""

    def __init__(self, check_interval: float = 5.0):
        """
        Initialize waveform worker.

        Args:
            check_interval: Seconds to wait between checking for new tracks
        """
        self.check_interval = check_interval
        self.running = False
        self.thread = None

    def start(self):
        """Start the background worker thread."""
        if self.running:
            logger.warning("Waveform worker already running")
            return

        self.running = True
        self.thread = threading.Thread(target=self._worker_loop, daemon=True)
        self.thread.start()
        logger.info("Waveform worker started")

    def stop(self):
        """Stop the background worker thread."""
        self.running = False
        if self.thread:
            self.thread.join(timeout=10)
        logger.info("Waveform worker stopped")

    def _worker_loop(self):
        """Main worker loop - runs continuously."""
        while self.running:
            try:
                self._process_next_track()
            except Exception as e:
                logger.error(f"Error in waveform worker: {e}", exc_info=True)

            # Sleep before checking for next track
            time.sleep(self.check_interval)

    def _process_next_track(self):
        """Find and process one track without a waveform."""
        db = SessionLocal()
        try:
            # Find tracks without waveforms
            track = (
                db.query(models.Track)
                .outerjoin(models.Waveform, models.Track.id == models.Waveform.track_id)
                .filter(models.Waveform.id == None)
                .first()
            )

            if not track:
                # No tracks to process
                return

            # Verify file exists
            file_path = Path(track.filename)
            if not file_path.exists():
                logger.warning(f"Track {track.id} file not found: {file_path}")
                return

            # Generate waveform
            logger.info(f"Generating waveform for track {track.id}: {track.title}")
            crud.create_waveform(db, track.id, str(file_path))
            logger.info(f"Successfully generated waveform for track {track.id}")

        except Exception as e:
            logger.error(f"Failed to generate waveform for track {track.id if track else 'unknown'}: {e}")
            db.rollback()
        finally:
            db.close()


# Global worker instance
_worker = None


def start_waveform_worker():
    """Start the global waveform worker."""
    print("Starting waveform worker...")
    global _worker
    if _worker is None:
        _worker = WaveformWorker(check_interval=5.0)
        _worker.start()


def stop_waveform_worker():
    """Stop the global waveform worker."""
    global _worker
    if _worker:
        _worker.stop()
        _worker = None
