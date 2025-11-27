#!/usr/bin/env python3
"""Sync BPM information from Engine DJ database to our application database."""

import sys
import argparse
from pathlib import Path
from enginedj import EngineDJDatabase
from enginedj.sync import match_manadj_track_to_engine
from backend.database import SessionLocal
from backend.models import Track as DBTrack


class SyncStats:
    """Track sync statistics."""

    def __init__(self):
        self.scanned = 0
        self.new_bpms = 0
        self.updated_bpms = 0
        self.matching = 0
        self.conflicts = 0
        self.skipped = 0
        self.not_in_engine = 0


def prompt_conflict(db_track: DBTrack, db_bpm: float, edj_bpm: float, auto_mode: str | None) -> str:
    """Prompt user to resolve a BPM conflict.

    Returns: 'keep', 'engine', 'skip', 'keep_all', or 'engine_all'
    """
    if auto_mode == "keep_all":
        return "keep"
    if auto_mode == "engine_all":
        return "engine"

    print(f"\nConflict for: {db_track.artist or 'Unknown'} - {db_track.title or 'Unknown'}")
    print(f"  File: {Path(db_track.filename).name}")
    print(f"  Current DB BPM: {db_bpm:.2f}")
    print(f"  Engine DJ BPM:  {edj_bpm:.2f}")
    print()
    print("Options:")
    print("  [k] Keep current BPM")
    print("  [e] Use Engine DJ BPM")
    print("  [s] Skip this track")
    print("  [ka] Keep all (no more prompts)")
    print("  [ea] Use Engine DJ for all (no more prompts)")
    print()

    while True:
        choice = input("Choice: ").strip().lower()
        if choice in ["k", "e", "s", "ka", "ea"]:
            return choice
        print("Invalid choice. Please enter k, e, s, ka, or ea.")


def sync_bpms(engine_db_path: str, apply: bool = False, verbose: bool = False, tolerance: float = 0.01):
    """Sync BPMs from Engine DJ to our database.

    Args:
        engine_db_path: Path to Engine DJ database
        apply: Whether to apply changes
        verbose: Show detailed output
        tolerance: BPM difference threshold to consider as matching (default 0.01)
    """

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
        updates = []  # (track, new_bpm_centi, old_bpm, new_bpm)
        conflicts = []  # (track, db_bpm, edj_bpm)
        auto_mode = None  # None, 'keep_all', or 'engine_all'

        print("Scanning tracks...")

        with edj_db.session_m() as edj_session:
            # Get all tracks from our database
            db_tracks = db.query(DBTrack).all()
            stats.scanned = len(db_tracks)

            for db_track in db_tracks:
                # Find matching Engine DJ track
                edj_track = match_manadj_track_to_engine(db_track, edj_session)

                if edj_track is None:
                    stats.not_in_engine += 1
                    if verbose:
                        print(f"Not in Engine DJ: {Path(db_track.filename).name}")
                    continue

                # Prefer bpmAnalyzed (more accurate) over bpm (rounded integer)
                # Engine DJ GUI displays bpmAnalyzed
                edj_bpm_raw = edj_track.bpmAnalyzed if hasattr(edj_track, 'bpmAnalyzed') and edj_track.bpmAnalyzed else edj_track.bpm

                # Engine DJ has no BPM
                if edj_bpm_raw is None or edj_bpm_raw == 0:
                    # Keep existing BPM if we have one
                    if db_track.bpm is not None and db_track.bpm != 0:
                        if verbose:
                            print(f"Engine DJ has no BPM, keeping: {Path(db_track.filename).name}")
                    continue

                # Get BPM values (Engine DJ stores as float, we store as centiBPM int)
                edj_bpm = float(edj_bpm_raw)
                edj_bpm_centi = int(edj_bpm * 100)

                db_bpm = float(db_track.bpm / 100.0) if db_track.bpm is not None and db_track.bpm != 0 else None

                # Check for non-integer BPM that rounds to existing integer BPM
                is_non_integer = abs(edj_bpm - round(edj_bpm)) > 0.01
                if is_non_integer and db_bpm is not None and abs(round(edj_bpm) - db_bpm) < 0.01:
                    # Non-integer BPM rounds to existing integer - consider equal but warn
                    stats.matching += 1
                    print(f"⚠️  Non-integer BPM (no change): {Path(db_track.filename).name}: Engine={edj_bpm:.2f} → rounds to {round(edj_bpm):.0f} = DB={db_bpm:.0f}")
                    continue

                # Warn for other non-integer BPMs (might indicate half-time/double-time issues)
                if is_non_integer:
                    print(f"⚠️  Non-integer BPM: {Path(db_track.filename).name}: {edj_bpm:.2f} BPM")

                if db_bpm is None:
                    # DB has no BPM - add new BPM
                    stats.new_bpms += 1
                    updates.append((db_track, edj_bpm_centi, None, edj_bpm))
                    if verbose:
                        print(f"[+] {Path(db_track.filename).name}: None → {edj_bpm:.2f} BPM")

                elif abs(edj_bpm - db_bpm) <= tolerance:
                    # BPMs match (within tolerance)
                    stats.matching += 1
                    if verbose:
                        print(f"[=] {Path(db_track.filename).name}: {db_bpm:.2f} BPM (matching)")

                else:
                    # CONFLICT
                    stats.conflicts += 1
                    conflicts.append((db_track, db_bpm, edj_bpm))

        # Handle conflicts
        print(f"\nFound {stats.conflicts} conflict(s)")

        if conflicts and not apply:
            print("\nConflicts found, but running in dry-run mode.")
            print("Re-run with --apply to resolve conflicts interactively.")
            print("\nConflict summary:")
            for db_track, db_bpm, edj_bpm in conflicts[:10]:  # Show first 10
                print(f"  {Path(db_track.filename).name}: {db_bpm:.2f} → {edj_bpm:.2f} BPM")
            if len(conflicts) > 10:
                print(f"  ... and {len(conflicts) - 10} more")

        elif conflicts and apply:
            print("\nResolving conflicts...")
            try:
                for db_track, db_bpm, edj_bpm in conflicts:
                    choice = prompt_conflict(db_track, db_bpm, edj_bpm, auto_mode)

                    if choice == "keep":
                        stats.skipped += 1
                    elif choice == "engine":
                        stats.updated_bpms += 1
                        edj_bpm_centi = int(edj_bpm * 100)
                        updates.append((db_track, edj_bpm_centi, db_bpm, edj_bpm))
                    elif choice == "skip":
                        stats.skipped += 1
                    elif choice == "ka":
                        auto_mode = "keep_all"
                        stats.skipped += 1
                    elif choice == "ea":
                        auto_mode = "engine_all"
                        stats.updated_bpms += 1
                        edj_bpm_centi = int(edj_bpm * 100)
                        updates.append((db_track, edj_bpm_centi, db_bpm, edj_bpm))

            except KeyboardInterrupt:
                print("\n\nInterrupted by user. Showing partial statistics...")

        # Apply updates
        if apply and updates:
            print(f"\nApplying {len(updates)} update(s)...")
            for db_track, new_bpm_centi, old_bpm, new_bpm in updates:
                db_track.bpm = new_bpm_centi
            db.commit()
            print("✓ Changes committed to database")

        # Print summary
        print("\n" + "=" * 70)
        print("Engine DJ BPM Sync Report")
        print("=" * 70)
        print(f"Tracks scanned: {stats.scanned}")
        print(f"  - Not in Engine DJ: {stats.not_in_engine}")
        print(f"  - Matching BPMs: {stats.matching}")
        print(f"  - New BPMs added: {stats.new_bpms}")
        print(f"  - BPMs updated: {stats.updated_bpms}")
        print(f"  - Conflicts: {stats.conflicts}")
        print(f"  - Skipped: {stats.skipped}")

        if not apply and (updates or conflicts):
            print(f"\nMode: DRY RUN (use --apply to commit changes)")
            print(f"\nProposed changes ({len(updates)} total):")
            for db_track, new_bpm_centi, old_bpm, new_bpm in updates[:20]:
                artist = db_track.artist or "Unknown"
                title = db_track.title or "Unknown"
                if old_bpm is None:
                    print(f"  [+] {artist} - {title}: None → {new_bpm:.2f} BPM")
                else:
                    print(f"  [*] {artist} - {title}: {old_bpm:.2f} → {new_bpm:.2f} BPM")
            if len(updates) > 20:
                print(f"  ... and {len(updates) - 20} more")
        elif apply and updates:
            print(f"\nApplied changes:")
            for db_track, new_bpm_centi, old_bpm, new_bpm in updates[:20]:
                artist = db_track.artist or "Unknown"
                title = db_track.title or "Unknown"
                if old_bpm is None:
                    print(f"  [+] {artist} - {title}: None → {new_bpm:.2f} BPM")
                else:
                    print(f"  [*] {artist} - {title}: {old_bpm:.2f} → {new_bpm:.2f} BPM")
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
        description="Sync BPM information from Engine DJ to application database."
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
    parser.add_argument(
        "--tolerance",
        type=float,
        default=0.01,
        help="BPM difference tolerance to consider as matching (default: 0.01)"
    )

    args = parser.parse_args()

    # Validate path exists
    if not Path(args.engine_db_path).exists():
        print(f"Error: Path does not exist: {args.engine_db_path}")
        sys.exit(1)

    sync_bpms(args.engine_db_path, args.apply, args.verbose, args.tolerance)


if __name__ == "__main__":
    main()
