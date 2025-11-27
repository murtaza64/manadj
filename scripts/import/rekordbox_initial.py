#!/usr/bin/env python3
"""Import tracks and tags from Rekordbox into our library database."""

import sys
from pathlib import Path
from sqlalchemy.orm import Session
from rekordbox import RekordboxReader
from backend.database import SessionLocal, engine
from backend.models import Base, Track, TagCategory, Tag, TrackTag

# Create tables
Base.metadata.create_all(bind=engine)

def seed_categories(db: Session):
    """Create initial tag categories (Genre, Vibe, Role only)."""
    categories = [
        {"name": "Genre", "display_order": 1, "color": "#3b82f6"},
        {"name": "Vibe", "display_order": 2, "color": "#8b5cf6"},
        {"name": "Role", "display_order": 3, "color": "#10b981"},
    ]

    for cat_data in categories:
        existing = db.query(TagCategory).filter(
            TagCategory.name == cat_data["name"]
        ).first()

        if not existing:
            category = TagCategory(**cat_data)
            db.add(category)

    db.commit()


def import_from_rekordbox():
    """Import tracks and tags from Rekordbox."""
    print("Reading Rekordbox database...")
    reader = RekordboxReader()

    # Get MyTag structure
    mytag_structure = reader.get_mytag_structure()

    # Get tracks with MyTags
    rb_tracks = reader.get_tracks_with_mytags()

    print(f"Found {len(rb_tracks)} tracks with MyTags")

    db = SessionLocal()

    try:
        # Seed categories
        print("Creating tag categories...")
        seed_categories(db)

        # Get category mapping
        categories = {cat.name: cat for cat in db.query(TagCategory).all()}

        # Create tags
        print("Creating tags...")
        tag_map = {}  # (category_name, tag_name) -> Tag

        for category_name, tag_names in mytag_structure.categories.items():
            if category_name not in categories:
                continue

            category = categories[category_name]

            for tag_name in tag_names:
                existing = db.query(Tag).filter(
                    Tag.category_id == category.id,
                    Tag.name == tag_name
                ).first()

                if not existing:
                    tag = Tag(
                        category_id=category.id,
                        name=tag_name
                    )
                    db.add(tag)
                    db.flush()
                    tag_map[(category_name, tag_name)] = tag
                else:
                    tag_map[(category_name, tag_name)] = existing

        db.commit()

        # Import tracks
        print(f"Importing {len(rb_tracks)} tracks...")

        for rb_track in rb_tracks:
            # Extract energy value if present
            energy_value = None
            tags_to_add = []

            for category, tag_name in rb_track.mytags:
                if category == "Energy":
                    # Convert energy tag to integer (1-5)
                    try:
                        energy_value = int(tag_name)
                        if not 1 <= energy_value <= 5:
                            energy_value = None
                    except ValueError:
                        pass
                else:
                    # Regular tags (Genre, Vibe, Role)
                    tags_to_add.append((category, tag_name))

            # Create track with energy
            track = Track(filename=str(rb_track.file_path), energy=energy_value)
            db.add(track)
            db.flush()

            # Add tags (Genre, Vibe, Role only)
            for category, tag_name in tags_to_add:
                tag = tag_map.get((category, tag_name))
                if tag:
                    track_tag = TrackTag(track_id=track.id, tag_id=tag.id)
                    db.add(track_tag)

        db.commit()
        print("✓ Import complete!")

    except Exception as e:
        print(f"Error: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    import_from_rekordbox()
