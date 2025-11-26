#!/usr/bin/env python3
"""Sync key information from Engine DJ database to our application database."""

import sys
import argparse
from pathlib import Path
from enginedj import EngineDJDatabase, Track as EDJTrack
from backend.database import SessionLocal
from backend.models import Track as DBTrack
from backend.key import Key


class SyncStats:
    """Track sync statistics."""

    def __init__(self):
        self.scanned = 0
        self.new_keys = 0
        self.updated_keys = 0
        self.matching = 0
        self.conflicts = 0
        self.skipped = 0
        self.not_in_engine = 0


def prompt_conflict(db_track: DBTrack, db_key: Key, edj_key: Key, auto_mode: str | None) -> str:
    """Prompt user to resolve a key conflict.

    Returns: 'keep', 'engine', 'skip', 'keep_all', or 'engine_all'
    """
    if auto_mode == "keep_all":
        return "keep"
    if auto_mode == "engine_all":
        return "engine"

    print(f"\nConflict for: {db_track.artist or 'Unknown'} - {db_track.title or 'Unknown'}")
    print(f"  File: {Path(db_track.filename).name}")
    print(f"  Current DB key: {db_key.camelot} / {db_key.musical}")
    print(f"  Engine DJ key:  {edj_key.camelot} / {edj_key.musical}")
    print()
    print("Options:")
    print("  [k] Keep current key")
    print("  [e] Use Engine DJ key")
    print("  [s] Skip this track")
    print("  [ka] Keep all (no more prompts)")
    print("  [ea] Use Engine DJ for all (no more prompts)")
    print()

    while True:
        choice = input("Choice: ").strip().lower()
        if choice in ["k", "e", "s", "ka", "ea"]:
            return choice
        print("Invalid choice. Please enter k, e, s, ka, or ea.")


def sync_keys(engine_db_path: str, apply: bool = False, verbose: bool = False):
    """Sync keys from Engine DJ to our database."""

    # Connect to Engine DJ
    try:
        edj_db = EngineDJDatabase(Path(engine_db_path))
    except Exception as e:
        print(f"Error connecting to Engine DJ database: {e}")
        print(f"Path: {engine_db_path}")
        sys.exit(1)

    # Connect to our database
    db = SessionLocal()

    try:
        stats = SyncStats()
        updates = []  # (track, new_key_str)
        conflicts = []  # (track, db_key, edj_key)
        auto_mode = None  # None, 'keep_all', or 'engine_all'

        print("Scanning tracks...")

        with edj_db.session_m() as edj_session:
            # Get all tracks from our database
            db_tracks = db.query(DBTrack).all()
            stats.scanned = len(db_tracks)

            for db_track in db_tracks:
                # Extract filename
                filename = Path(db_track.filename).name

                # Find in Engine DJ
                edj_track = edj_session.query(EDJTrack).filter(
                    EDJTrack.filename == filename
                ).first()

                if edj_track is None:
                    stats.not_in_engine += 1
                    if verbose:
                        print(f"Not in Engine DJ: {filename}")
                    continue

                # Engine DJ has no key
                if edj_track.key is None:
                    # Keep existing key if we have one
                    if db_track.key is not None:
                        if verbose:
                            print(f"Engine DJ has no key, keeping: {filename}")
                    continue

                # Convert keys
                edj_key = Key.from_engine_id(edj_track.key)
                if edj_key is None:
                    print(f"Warning: Invalid Engine DJ key {edj_track.key} for {filename}")
                    continue

                db_key = Key.from_engine_id(db_track.key) if db_track.key is not None else None

                if db_key is None:
                    # DB has no key - add new key
                    stats.new_keys += 1
                    updates.append((db_track, edj_key.engine_id, None, edj_key))
                    if verbose:
                        print(f"[+] {filename}: None → {edj_key.musical} ({edj_key.camelot})")

                elif edj_key == db_key:
                    # Keys match
                    stats.matching += 1
                    if verbose:
                        print(f"[=] {filename}: {db_key.musical} (matching)")

                else:
                    # CONFLICT
                    stats.conflicts += 1
                    conflicts.append((db_track, db_key, edj_key))

        # Handle conflicts
        print(f"\nFound {stats.conflicts} conflict(s)")

        if conflicts and not apply:
            print("\nConflicts found, but running in dry-run mode.")
            print("Re-run with --apply to resolve conflicts interactively.")
            print("\nConflict summary:")
            for db_track, db_key, edj_key in conflicts[:10]:  # Show first 10
                print(f"  {Path(db_track.filename).name}: {db_key.musical} → {edj_key.musical}")
            if len(conflicts) > 10:
                print(f"  ... and {len(conflicts) - 10} more")

        elif conflicts and apply:
            print("\nResolving conflicts...")
            try:
                for db_track, db_key, edj_key in conflicts:
                    choice = prompt_conflict(db_track, db_key, edj_key, auto_mode)

                    if choice == "keep":
                        stats.skipped += 1
                    elif choice == "engine":
                        stats.updated_keys += 1
                        updates.append((db_track, edj_key.engine_id, db_key, edj_key))
                    elif choice == "skip":
                        stats.skipped += 1
                    elif choice == "ka":
                        auto_mode = "keep_all"
                        stats.skipped += 1
                    elif choice == "ea":
                        auto_mode = "engine_all"
                        stats.updated_keys += 1
                        updates.append((db_track, edj_key.engine_id, db_key, edj_key))

            except KeyboardInterrupt:
                print("\n\nInterrupted by user. Showing partial statistics...")

        # Apply updates
        if apply and updates:
            print(f"\nApplying {len(updates)} update(s)...")
            for db_track, new_key_id, old_key, new_key in updates:
                db_track.key = new_key_id
            db.commit()
            print("✓ Changes committed to database")

        # Print summary
        print("\n" + "=" * 70)
        print("Engine DJ Key Sync Report")
        print("=" * 70)
        print(f"Tracks scanned: {stats.scanned}")
        print(f"  - Not in Engine DJ: {stats.not_in_engine}")
        print(f"  - Matching keys: {stats.matching}")
        print(f"  - New keys added: {stats.new_keys}")
        print(f"  - Keys updated: {stats.updated_keys}")
        print(f"  - Conflicts: {stats.conflicts}")
        print(f"  - Skipped: {stats.skipped}")

        if not apply and (updates or conflicts):
            print(f"\nMode: DRY RUN (use --apply to commit changes)")
            print(f"\nProposed changes ({len(updates)} total):")
            for db_track, new_key_id, old_key, new_key in updates[:20]:
                artist = db_track.artist or "Unknown"
                title = db_track.title or "Unknown"
                if old_key is None:
                    print(f"  [+] {artist} - {title}: None → {new_key.musical} ({new_key.camelot})")
                else:
                    print(f"  [*] {artist} - {title}: {old_key.musical} → {new_key.musical} ({new_key.camelot})")
            if len(updates) > 20:
                print(f"  ... and {len(updates) - 20} more")
        elif apply and updates:
            print(f"\nApplied changes:")
            for db_track, new_key_id, old_key, new_key in updates[:20]:
                artist = db_track.artist or "Unknown"
                title = db_track.title or "Unknown"
                if old_key is None:
                    print(f"  [+] {artist} - {title}: None → {new_key.musical} ({new_key.camelot})")
                else:
                    print(f"  [*] {artist} - {title}: {old_key.musical} → {new_key.musical} ({new_key.camelot})")
            if len(updates) > 20:
                print(f"  ... and {len(updates) - 20} more")

        print("=" * 70)

    except Exception as e:
        print(f"Error during sync: {e}")
        db.rollback()
        raise
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(
        description="Sync key information from Engine DJ to application database."
    )
    parser.add_argument(
        "engine_db_path",
        help="Path to Engine DJ Database2 directory"
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply changes (default is dry-run mode)"
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Show detailed output for all tracks"
    )

    args = parser.parse_args()

    # Validate path exists
    if not Path(args.engine_db_path).exists():
        print(f"Error: Path does not exist: {args.engine_db_path}")
        sys.exit(1)

    sync_keys(args.engine_db_path, args.apply, args.verbose)


if __name__ == "__main__":
    main()
