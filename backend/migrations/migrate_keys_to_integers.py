#!/usr/bin/env python3
"""Migrate key storage from strings to Engine DJ integer IDs (0-23)."""

import sys
from sqlalchemy import create_engine, text
from backend.database import SessionLocal, SQLALCHEMY_DATABASE_URL
from backend.models import Track
from backend.key import Key


def migrate_keys(dry_run: bool = True):
    """Migrate keys from string format to Engine DJ integer IDs."""

    db = SessionLocal()

    try:
        stats = {
            "total": 0,
            "with_keys": 0,
            "converted": 0,
            "invalid": 0,
            "null": 0,
        }

        invalid_keys = []

        # Get all tracks
        tracks = db.query(Track).all()
        stats["total"] = len(tracks)

        print(f"Processing {stats['total']} tracks...")
        print()

        # First pass: analyze what we have
        for track in tracks:
            if track.key is None:
                stats["null"] += 1
                continue

            stats["with_keys"] += 1

            # Try to convert
            key_obj = Key.from_musical(track.key)
            if key_obj is None:
                stats["invalid"] += 1
                invalid_keys.append((track.id, track.filename, track.key))
            else:
                stats["converted"] += 1

        # Show statistics
        print("Analysis:")
        print(f"  Total tracks: {stats['total']}")
        print(f"  Tracks with keys: {stats['with_keys']}")
        print(f"  Can be converted: {stats['converted']}")
        print(f"  Invalid keys: {stats['invalid']}")
        print(f"  Null keys: {stats['null']}")
        print()

        if invalid_keys:
            print("Invalid keys found:")
            for track_id, filename, key_str in invalid_keys[:20]:
                print(f"  Track {track_id} ({filename}): '{key_str}'")
            if len(invalid_keys) > 20:
                print(f"  ... and {len(invalid_keys) - 20} more")
            print()

        if dry_run:
            print("DRY RUN - No changes made")
            print("Re-run with --apply to perform migration")
            return

        # Perform migration
        print("Performing migration...")

        # Create new column
        engine = create_engine(SQLALCHEMY_DATABASE_URL)
        with engine.connect() as conn:
            # Add new column
            print("  Adding key_id column...")
            conn.execute(text("ALTER TABLE tracks ADD COLUMN key_id INTEGER"))
            conn.commit()

            # Migrate data
            print("  Migrating key data...")
            for track in tracks:
                if track.key is None:
                    continue

                key_obj = Key.from_musical(track.key)
                if key_obj is not None:
                    conn.execute(
                        text("UPDATE tracks SET key_id = :key_id WHERE id = :id"),
                        {"key_id": key_obj.engine_id, "id": track.id}
                    )
            conn.commit()

            # Drop old column and rename new one
            print("  Dropping old key column...")
            conn.execute(text("ALTER TABLE tracks DROP COLUMN key"))
            conn.commit()

            print("  Renaming key_id to key...")
            conn.execute(text("ALTER TABLE tracks RENAME COLUMN key_id TO key"))
            conn.commit()

        print()
        print("✓ Migration complete!")
        print(f"  Converted {stats['converted']} keys from strings to integers")

    except Exception as e:
        print(f"Error during migration: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    dry_run = "--apply" not in sys.argv
    skip_confirm = "--yes" in sys.argv

    if not dry_run and not skip_confirm:
        response = input("This will modify the database schema. Are you sure? (yes/no): ")
        if response.lower() != "yes":
            print("Migration cancelled")
            sys.exit(0)

    migrate_keys(dry_run)
