from sqlalchemy import CheckConstraint, Column, ForeignKey, Integer, String, Text

from ..models import Base


class SyncLocal(Base):
    __tablename__ = "peer_sync_local"
    id = Column(Integer, primary_key=True)
    replica_id = Column(String(36), nullable=False, unique=True)
    __table_args__ = (CheckConstraint("id = 1"),)


class SyncSource(Base):
    __tablename__ = "peer_sync_sources"
    replica_id = Column(String(36), primary_key=True)
    label = Column(String(80), nullable=False)


class SyncTrack(Base):
    __tablename__ = "peer_sync_tracks"
    logical_track_id = Column(String(36), primary_key=True)
    track_id = Column(Integer, ForeignKey("tracks.id", ondelete="SET NULL"), nullable=True, unique=True)


class SyncSelection(Base):
    __tablename__ = "peer_sync_selections"
    track_id = Column(Integer, ForeignKey("tracks.id", ondelete="CASCADE"), primary_key=True)
    token = Column(String(32), nullable=False)


class SyncSession(Base):
    __tablename__ = "peer_sync_sessions"
    session_uuid = Column(String(36), primary_key=True)
    origin_replica_id = Column(String(36), nullable=False)
    direction = Column(String(8), nullable=False)
    manifest_sha256 = Column(String(64), nullable=False)
    manifest_json = Column(Text, nullable=False)


class SyncChunk(Base):
    __tablename__ = "peer_sync_chunks"
    session_uuid = Column(String(36), ForeignKey("peer_sync_sessions.session_uuid", ondelete="CASCADE"), primary_key=True)
    seq = Column(Integer, primary_key=True)
    events_json = Column(Text, nullable=False)


class SyncConflict(Base):
    __tablename__ = "peer_sync_conflicts"
    payload_sha256 = Column(String(64), primary_key=True)
    session_uuid = Column(String(36), nullable=False)
    existing_sha256 = Column(String(64), nullable=False)
    existing_kind = Column(String(32), nullable=False)
    existing_json = Column(Text, nullable=False)
    incoming_json = Column(Text, nullable=False)
