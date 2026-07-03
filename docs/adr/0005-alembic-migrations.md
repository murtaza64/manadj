# Alembic migrations, baseline at the pre-acquisition schema

Schema used to come from `Base.metadata.create_all` at startup plus one-shot scripts in `backend/migrations/` — workable while changes only added tables, but the acquisition feature (`.scratch/soundcloud-acquisition/`) alters existing tables across several slices, including `tracks` on the real library. We adopted Alembic: revision `0001` reconstructs the pre-acquisition schema as the baseline, `0002` adds `source_items`, and each schema-touching slice adds its own revision. Startup now runs `alembic upgrade head` instead of `create_all`, and test fixtures build their in-memory schema through the migration path.

## Conventions

- Revisions are generated with an explicit rev-id carrying the jj change short ID: `alembic revision --rev-id <NNNN>_<jj-short-id> -m "<slug>"` (alembic forbids `-` in rev-ids). Numbers are sequential; if parallel agents collide on a number, the differing suffixes keep the files distinct and alembic reports multiple heads — re-parent one.
- `alembic/env.py` resolves the target: injected connection (tests) > `MANADJ_DB_URL` env var (scratch DBs) > the app database.
- `backend/migrations/` scripts are pre-Alembic historical artifacts; do not add to them.
