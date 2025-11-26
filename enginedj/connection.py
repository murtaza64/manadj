"""Database connection management for Engine DJ databases."""

from pathlib import Path
from contextlib import contextmanager
from typing import Generator
import time

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker


class EngineDJDatabase:
    """Manages connections to Engine DJ database files."""

    def __init__(self, database_path: Path):
        """
        Initialize connection to Engine DJ database.

        Args:
            database_path: Path to Database2 directory containing m.db, hm.db, etc.
        """
        self.database_path = database_path
        self.m_db_path = database_path / "m.db"
        self.hm_db_path = database_path / "hm.db"

        if not self.m_db_path.exists():
            raise FileNotFoundError(f"Main database not found: {self.m_db_path}")

        # Create engines (read-only)
        self.m_engine = self._create_readonly_engine(self.m_db_path)
        self.hm_engine = self._create_readonly_engine(self.hm_db_path) \
                         if self.hm_db_path.exists() else None

        # Create writable engine for m.db
        self.m_engine_write = self._create_writable_engine(self.m_db_path)

        # Create session makers
        self.M_Session = sessionmaker(bind=self.m_engine)
        self.HM_Session = sessionmaker(bind=self.hm_engine) \
                          if self.hm_engine else None
        self.M_Session_Write = sessionmaker(bind=self.m_engine_write)

    @staticmethod
    def _create_readonly_engine(db_path: Path) -> Engine:
        """Create a read-only SQLAlchemy engine."""
        engine = create_engine(
            f"sqlite:///{db_path}",
            echo=False,
            connect_args={"check_same_thread": False}
        )

        # Set read-only mode
        @event.listens_for(engine, "connect")
        def set_readonly(dbapi_conn, connection_record):
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA query_only = ON")
            cursor.close()

        return engine

    @staticmethod
    def _create_writable_engine(db_path: Path) -> Engine:
        """Create a writable SQLAlchemy engine."""
        return create_engine(
            f"sqlite:///{db_path}",
            echo=False,
            connect_args={"check_same_thread": False}
        )

    @contextmanager
    def session_m(self) -> Generator[Session, None, None]:
        """Context manager for m.db sessions."""
        session = self.M_Session()
        try:
            yield session
        finally:
            session.close()

    @contextmanager
    def session_hm(self) -> Generator[Session, None, None]:
        """Context manager for hm.db sessions."""
        if not self.HM_Session:
            raise RuntimeError("History database (hm.db) not available")
        session = self.HM_Session()
        try:
            yield session
        finally:
            session.close()

    @contextmanager
    def session_m_write(self) -> Generator[Session, None, None]:
        """Context manager for writable m.db sessions."""
        session = self.M_Session_Write()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def get_database_info(self) -> dict:
        """Get database metadata from Information table."""
        with self.session_m() as session:
            from .models.information import Information
            info = session.query(Information).first()
            if info:
                return {
                    "uuid": info.uuid,
                    "version": f"{info.schemaVersionMajor}.{info.schemaVersionMinor}."
                              f"{info.schemaVersionPatch}",
                }
            return {}

    def create_playlist(
        self,
        title: str,
        tracks: list,
        parent_id: int = 0
    ):
        """
        Create a new playlist with the given tracks.

        Args:
            title: Playlist title
            tracks: List of Track objects to add to playlist
            parent_id: Parent playlist ID (0 for root, default)

        Returns:
            Created Playlist object
        """
        from .models.information import Information
        from .models.playlist import Playlist
        from .models.playlist_entity import PlaylistEntity

        with self.session_m_write() as session:
            # Get database UUID
            info = session.query(Information).first()
            db_uuid = info.uuid if info else None

            # Create Playlist object
            playlist = Playlist(
                title=title,
                parentListId=parent_id,
                nextListId=0,
                isPersisted=True,
                isExplicitlyExported=False,
                lastEditTime=int(time.time())
            )
            session.add(playlist)
            session.flush()  # Get the ID

            # Capture the ID before session closes
            playlist_id = playlist.id

            # Update previous playlist's nextListId
            prev_playlist = session.query(Playlist).filter(
                Playlist.parentListId == parent_id,
                Playlist.nextListId == 0,
                Playlist.id != playlist_id
            ).first()

            if prev_playlist:
                prev_playlist.nextListId = playlist_id

            # Create PlaylistEntity records (linked list for tracks)
            if tracks:
                entities = []
                for track in tracks:
                    entity = PlaylistEntity(
                        listId=playlist_id,
                        trackId=track.id,
                        databaseUuid=db_uuid,
                        nextEntityId=0,
                        membershipReference=0
                    )
                    entities.append(entity)
                    session.add(entity)

                session.flush()  # Get all entity IDs

                # Link entities in order
                for i in range(len(entities) - 1):
                    entities[i].nextEntityId = entities[i + 1].id

        # Return the playlist (re-query to get fresh state)
        with self.session_m() as session:
            return session.query(Playlist).filter(Playlist.id == playlist_id).first()
