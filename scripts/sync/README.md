# Sync Scripts

External Import scripts for data that was analyzed downstream first. Track
export/import flows live in the API (`backend/tracks/`) and the SyncView UI;
tag/playlist exports live in `scripts/export/`.

## engine_keys.py

One-way sync of musical keys from Engine DJ to manadj.

```bash
uv run scripts/sync/engine_keys.py                # Dry-run
uv run scripts/sync/engine_keys.py --apply        # Apply changes
```

## engine_bpm.py

One-way sync of BPM values from Engine DJ to manadj.

```bash
uv run scripts/sync/engine_bpm.py                 # Dry-run
uv run scripts/sync/engine_bpm.py --apply         # Apply changes
```

## Tips

- Always dry-run first (`--apply` is required to write)
- Close Engine DJ before running
