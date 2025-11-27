#!/usr/bin/env python3
"""
Debug script to check tags in a Rekordbox database.

Usage:
    python scripts/debug/check_rekordbox_tags.py                           # Use auto-detected location
    python scripts/debug/check_rekordbox_tags.py --db ~/Library/Pioneer/rekordbox
    python scripts/debug/check_rekordbox_tags.py --db data/rekordbox
    python scripts/debug/check_rekordbox_tags.py --search Trash            # Search for specific tag
"""

import argparse
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from pyrekordbox.db6.tables import DjmdMyTag, DjmdSongMyTag
from rekordbox.connection import get_rekordbox_db


def main():
    parser = argparse.ArgumentParser(description='Check tags in Rekordbox database')
    parser.add_argument(
        '--db',
        type=Path,
        help='Path to Rekordbox database directory (default: auto-detect)'
    )
    parser.add_argument(
        '--search',
        type=str,
        help='Search for tags matching this name'
    )
    parser.add_argument(
        '--category',
        type=str,
        help='Show all tags in this category'
    )
    args = parser.parse_args()

    # Connect to database
    rb_db = get_rekordbox_db(args.db)
    print(f"Database: {rb_db.db_directory}")
    print("=" * 70)
    print()

    try:
        # Get all categories
        categories = rb_db.session.query(DjmdMyTag).filter_by(ParentID="root").order_by(DjmdMyTag.Seq).all()

        if args.search:
            # Search for specific tag
            print(f"Searching for tags matching '{args.search}':")
            search_tags = rb_db.session.query(DjmdMyTag).filter(
                DjmdMyTag.Name.like(f'%{args.search}%')
            ).all()

            if search_tags:
                for tag in search_tags:
                    # Get parent category
                    parent = rb_db.session.query(DjmdMyTag).filter_by(ID=tag.ParentID).first()
                    parent_name = parent.Name if parent else "Unknown"

                    # Count tracks
                    track_count = rb_db.session.query(DjmdSongMyTag).filter_by(MyTagID=tag.ID).count()

                    print(f"  {parent_name}/{tag.Name}")
                    print(f"    ID: {tag.ID}")
                    print(f"    ParentID: {tag.ParentID}")
                    print(f"    Seq: {tag.Seq}")
                    print(f"    Tracks: {track_count}")
                    print()
            else:
                print(f"  No tags found matching '{args.search}'")

        elif args.category:
            # Show all tags in specific category
            cat = rb_db.session.query(DjmdMyTag).filter_by(
                ParentID="root",
                Name=args.category
            ).first()

            if cat:
                print(f"Tags in {args.category} category:")
                tags = rb_db.session.query(DjmdMyTag).filter_by(
                    ParentID=cat.ID
                ).order_by(DjmdMyTag.Seq).all()

                for tag in tags:
                    track_count = rb_db.session.query(DjmdSongMyTag).filter_by(MyTagID=tag.ID).count()
                    print(f"  {tag.Name} (ID={tag.ID}, Tracks={track_count})")
            else:
                print(f"Category '{args.category}' not found")

        else:
            # Show all categories and their tag counts
            print("Categories:")
            for cat in categories:
                tag_count = rb_db.session.query(DjmdMyTag).filter_by(ParentID=cat.ID).count()
                print(f"  {cat.Name} (ID={cat.ID}): {tag_count} tags")

            print("\n" + "=" * 70)
            print("All tags:")

            for cat in categories:
                tags = rb_db.session.query(DjmdMyTag).filter_by(
                    ParentID=cat.ID
                ).order_by(DjmdMyTag.Seq).all()

                if tags:
                    print(f"\n{cat.Name}:")
                    for tag in tags:
                        track_count = rb_db.session.query(DjmdSongMyTag).filter_by(MyTagID=tag.ID).count()
                        print(f"  {tag.Name} (ID={tag.ID}, Tracks={track_count})")

    finally:
        rb_db.close()


if __name__ == '__main__':
    main()
