"""Alembic migration environment for manadj.

URL resolution order:
1. An injected connection via config.attributes["connection"] (used by tests)
2. The MANADJ_DB_URL environment variable (used for scratch/temp databases)
3. The app database (backend.database)

Conventions: revisions are generated with an explicit rev-id carrying the jj
change short ID — see AGENTS.md (Version control).
"""

import os
from logging.config import fileConfig

from sqlalchemy import create_engine
from sqlalchemy.engine import Connection

from alembic import context

from backend.models import Base

# Model modules that register tables on Base (autogenerate must see them all)
import backend.acquisition.models  # noqa: F401
import backend.tasks.models  # noqa: F401

config = context.config

if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    # Skipped when invoked programmatically (app startup, tests): alembic.ini's
    # logger config sets root to WARNING and would clobber the app's logging —
    # it silenced uvicorn access logs entirely.
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _database_url() -> str:
    url = os.environ.get("MANADJ_DB_URL")
    if url:
        return url
    from backend.database import SQLALCHEMY_DATABASE_URL

    return SQLALCHEMY_DATABASE_URL


def run_migrations_offline() -> None:
    """Emit SQL to stdout instead of running against a database."""
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def _run(connection: "Connection") -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=True,  # required for ALTER on SQLite
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:
        _run(connection)
        return

    engine = create_engine(_database_url())
    with engine.connect() as conn:
        _run(conn)
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
