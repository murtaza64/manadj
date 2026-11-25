from sqlalchemy import Column, Integer, String, Text, UniqueConstraint
from backend.models import Base


class Operation(Base):
    __tablename__ = 'continuous_sync_operations'
    id = Column(Integer, primary_key=True, autoincrement=True)
    group_id = Column(String(36), nullable=False)
    origin_id = Column(String(36), nullable=False)
    sequence = Column(Integer, nullable=False)
    operation_id = Column(String(36), nullable=False)
    sha256 = Column(String(64), nullable=False)
    body = Column(Text, nullable=False)
    signature = Column(String(88), nullable=False)
    state = Column(String(40), nullable=False)
    __table_args__ = (UniqueConstraint('group_id', 'origin_id', 'sequence'),
                     UniqueConstraint('group_id', 'operation_id'), {'sqlite_autoincrement': True})


class Cursor(Base):
    __tablename__ = 'continuous_sync_cursors'
    group_id = Column(String(36), primary_key=True)
    origin_id = Column(String(36), primary_key=True)
    sequence = Column(Integer, nullable=False, default=0)


class Head(Base):
    __tablename__ = 'continuous_sync_heads'
    group_id = Column(String(36), primary_key=True)
    entity = Column(String(120), primary_key=True)
    field = Column(String(40), primary_key=True)
    heads_json = Column(Text, nullable=False)


class SessionOwner(Base):
    __tablename__ = 'continuous_sync_session_owners'
    group_id = Column(String(36), primary_key=True)
    session_uuid = Column(String(36), primary_key=True)
    origin_id = Column(String(36), nullable=False)


class CaptureState(Base):
    __tablename__ = 'continuous_sync_capture_state'
    group_id = Column(String(36), primary_key=True)
    entity = Column(String(120), primary_key=True)
    field = Column(String(40), primary_key=True)
    value_json = Column(Text, nullable=False)


class RelayCheckpoint(Base):
    __tablename__ = 'continuous_sync_relay_checkpoints'
    group_id = Column(String(36), primary_key=True)
    origin_id = Column(String(36), primary_key=True)
    sequence = Column(Integer, nullable=False)
