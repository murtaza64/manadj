from sqlalchemy import CheckConstraint, Column, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import backref, relationship

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


class PeerHistory(Base):
    __tablename__ = "peer_history"
    session_id = Column(Integer, ForeignKey("sessions.id", ondelete="CASCADE"), primary_key=True)
    source_sha256 = Column(String(64), nullable=False)
    binding_sha256 = Column(String(64), nullable=False)
    session = relationship("Session", backref=backref("peer_history", uselist=False, passive_deletes="all"))


class FolderRoot(Base):
    __tablename__ = "peer_folder_roots"
    id = Column(Integer, primary_key=True)
    root = Column(Text, nullable=False, unique=True)
    token = Column(String(32), nullable=False, unique=True)
    archived = Column(Integer, nullable=False, default=0)
    cursor = Column(String(160), nullable=False, default="")
    last_success = Column(String(40), nullable=True)
    entries = Column(Integer, nullable=True)


class FolderConfig(Base):
    __tablename__ = "peer_folder_config"
    id = Column(Integer, primary_key=True)
    root = Column(Text, nullable=False)
    token = Column(String(32), nullable=False)
    enabled = Column(Integer, nullable=False, default=0)
    state = Column(String(80), nullable=False, default="disabled")
    cursor = Column(String(160), nullable=False, default="")
    generation = Column(Integer, nullable=False, default=0)
    root_id = Column(Integer, ForeignKey("peer_folder_roots.id"), nullable=False)
    __table_args__ = (CheckConstraint("id = 1"),)


class FolderPublication(Base):
    __tablename__ = "peer_folder_publications"
    root_id = Column(Integer, ForeignKey("peer_folder_roots.id"), primary_key=True)
    session_uuid = Column(String(36), ForeignKey("peer_sync_sessions.session_uuid"), primary_key=True)
    published = Column(Integer, nullable=False, default=0)
    state = Column(String(80), nullable=False, default="pending")


class FolderReceipt(Base):
    __tablename__ = "peer_folder_receipts"
    root_id = Column(Integer, ForeignKey("peer_folder_roots.id"), primary_key=True)
    artifact = Column(String(160), primary_key=True)
    received = Column(Integer, nullable=False, default=0)
    state = Column(String(80), nullable=False)
    readiness = Column(String(80), nullable=True)


class DeviceGroup(Base):
    __tablename__ = "device_groups"
    group_id = Column(String(36), primary_key=True)
    device_id = Column(String(36), nullable=False)
    private_seed_b64 = Column(String(44), nullable=False)


class GroupMember(Base):
    __tablename__ = "device_group_members"
    group_id = Column(String(36), ForeignKey("device_groups.group_id"), primary_key=True)
    device_id = Column(String(36), primary_key=True)
    public_key_b64 = Column(String(44), nullable=False)
    revoked = Column(Integer, nullable=False, default=0)


class GroupOperation(Base):
    __tablename__ = "device_group_operations"
    cursor = Column(Integer, primary_key=True, autoincrement=True)
    group_id = Column(String(36), ForeignKey("device_groups.group_id"), nullable=False)
    operation_id = Column(String(36), nullable=False)
    origin_device_id = Column(String(36), nullable=False)
    session_uuid = Column(String(36), nullable=False)
    sha256 = Column(String(64), nullable=False)
    body_b64 = Column(Text, nullable=False)
    signature_b64 = Column(String(88), nullable=False)
    __table_args__ = (UniqueConstraint("group_id", "operation_id"), {"sqlite_autoincrement": True})


class GroupAck(Base):
    __tablename__ = "device_group_acks"
    group_id = Column(String(36), ForeignKey("device_groups.group_id"), primary_key=True)
    operation_id = Column(String(36), primary_key=True)
    device_id = Column(String(36), primary_key=True)
    sha256 = Column(String(64), nullable=False)
