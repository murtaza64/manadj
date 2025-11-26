"""Fix duplicate tags in the database by adding unique constraint and cleaning existing data."""

import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from sqlalchemy import text
from database import SessionLocal, engine
import models

def fix_duplicates():
    db = SessionLocal()

    try:
        # Step 1: Find and report duplicates
        print("Checking for duplicate track-tag associations...")
        result = db.execute(text("""
            SELECT track_id, tag_id, COUNT(*) as count
            FROM track_tags
            GROUP BY track_id, tag_id
            HAVING COUNT(*) > 1
        """))

        duplicates = result.fetchall()

        if duplicates:
            print(f"Found {len(duplicates)} duplicate track-tag combinations:")
            for track_id, tag_id, count in duplicates:
                print(f"  Track {track_id}, Tag {tag_id}: {count} entries")
        else:
            print("No duplicates found!")

        # Step 2: Remove duplicates, keeping only one entry per track-tag pair
        print("\nRemoving duplicates...")
        db.execute(text("""
            DELETE FROM track_tags
            WHERE id NOT IN (
                SELECT MIN(id)
                FROM track_tags
                GROUP BY track_id, tag_id
            )
        """))
        db.commit()
        print("Duplicates removed!")

        # Step 3: Check if unique constraint exists
        print("\nChecking for unique constraint...")
        result = db.execute(text("""
            SELECT sql FROM sqlite_master
            WHERE type='index' AND tbl_name='track_tags' AND sql LIKE '%UNIQUE%'
        """))

        existing_constraint = result.fetchone()

        if existing_constraint:
            print("Unique constraint already exists!")
        else:
            # Step 4: Add unique constraint
            print("Adding unique constraint...")
            db.execute(text("""
                CREATE UNIQUE INDEX idx_track_tags_unique
                ON track_tags(track_id, tag_id)
            """))
            db.commit()
            print("Unique constraint added!")

        # Step 5: Verify no duplicates remain
        result = db.execute(text("""
            SELECT track_id, tag_id, COUNT(*) as count
            FROM track_tags
            GROUP BY track_id, tag_id
            HAVING COUNT(*) > 1
        """))

        remaining = result.fetchall()
        if remaining:
            print(f"\nWARNING: {len(remaining)} duplicates still remain!")
        else:
            print("\nSuccess! No duplicates remain.")

    except Exception as e:
        print(f"Error: {e}")
        db.rollback()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    fix_duplicates()
