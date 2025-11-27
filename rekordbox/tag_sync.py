"""Tag structure and assignment syncing to Rekordbox MyTag."""

from dataclasses import dataclass

from pyrekordbox.db6 import Rekordbox6Database
from pyrekordbox.db6.tables import DjmdMyTag, DjmdSongMyTag

from backend.models import Tag, TagCategory, Track, TrackTag
from rekordbox.sync import index_rekordbox_tracks, match_track_rekordbox


@dataclass
class TagSyncStats:
    """Statistics for tag sync operations."""
    manadj_categories: int = 0
    manadj_tags: int = 0
    rb_categories_created: int = 0
    rb_tags_created: int = 0
    rb_categories_existing: int = 0
    rb_tags_existing: int = 0
    tracks_processed: int = 0
    tracks_updated: int = 0
    tracks_unmatched: int = 0
    tracks_warned: int = 0
    tracks_colored: int = 0
    tracks_color_cleared: int = 0


class RekordboxTagSyncer:
    """Manages tag structure and assignment syncing to Rekordbox."""

    def __init__(self, rb_db: Rekordbox6Database, manadj_session):
        self.rb_db = rb_db
        self.rb_session = rb_db.session
        self.manadj_session = manadj_session

    def sync_tag_structure(
        self,
        dry_run: bool = True
    ) -> tuple[dict[int, str], dict[int, str], TagSyncStats]:
        """
        Sync manadj tag structure (categories + tags) to Rekordbox MyTag.

        Args:
            dry_run: If True, don't write to database

        Returns:
            (rb_category_map, rb_tag_map, stats)
            Maps: manadj ID -> Rekordbox MyTag ID (as string)
        """
        stats = TagSyncStats()
        rb_category_map = {}  # manadj category.id -> DjmdMyTag.ID
        rb_tag_map = {}       # manadj tag.id -> DjmdMyTag.ID

        # Get manadj structure
        categories = self.manadj_session.query(TagCategory).order_by(TagCategory.display_order).all()
        stats.manadj_categories = len(categories)

        all_tags = self.manadj_session.query(Tag).all()
        stats.manadj_tags = len(all_tags)

        # Get existing Rekordbox structure
        # NOTE: ParentID is a string, not an integer! Use "root" for categories
        rb_categories = {c.Name: c for c in self.rb_session.query(DjmdMyTag).filter_by(ParentID="root").all()}
        rb_tags_by_parent = {}
        for tag in self.rb_session.query(DjmdMyTag).filter(DjmdMyTag.ParentID != "root").all():
            if tag.ParentID not in rb_tags_by_parent:
                rb_tags_by_parent[tag.ParentID] = {}
            rb_tags_by_parent[tag.ParentID][tag.Name] = tag

        # Sync categories
        for category in categories:
            if category.name in rb_categories:
                # Category exists - update sequence if needed
                rb_category = rb_categories[category.name]
                rb_category_map[category.id] = rb_category.ID

                if not dry_run and rb_category.Seq != category.display_order:
                    rb_category.Seq = category.display_order

                stats.rb_categories_existing += 1
            else:
                # Create category
                if not dry_run:
                    new_id = str(self.rb_db.generate_unused_id(DjmdMyTag))
                    rb_category = DjmdMyTag(
                        ID=new_id,
                        Name=category.name,
                        ParentID="root",
                        Seq=category.display_order,
                        Attribute=0
                    )
                    self.rb_session.add(rb_category)
                    rb_category_map[category.id] = rb_category.ID
                else:
                    # In dry run, use a dummy ID for counting purposes
                    rb_category_map[category.id] = -category.id
                stats.rb_categories_created += 1

        # Sync tags
        for category in categories:
            rb_parent_id = rb_category_map.get(category.id)
            if not rb_parent_id:
                continue  # Category not synced yet (shouldn't happen)

            tags = self.manadj_session.query(Tag).filter_by(category_id=category.id).order_by(Tag.display_order).all()

            # Get existing tags for this parent (skip in dry run for new categories)
            rb_existing_tags = {}
            # In dry run, negative IDs are used as placeholders; skip querying for those
            if not (isinstance(rb_parent_id, int) and rb_parent_id < 0):
                rb_existing_tags = rb_tags_by_parent.get(rb_parent_id, {})

            for tag in tags:
                if tag.name in rb_existing_tags:
                    # Tag exists - update sequence if needed
                    rb_tag = rb_existing_tags[tag.name]
                    rb_tag_map[tag.id] = rb_tag.ID

                    if not dry_run and rb_tag.Seq != tag.display_order:
                        rb_tag.Seq = tag.display_order

                    stats.rb_tags_existing += 1
                else:
                    # Create tag
                    if not dry_run:
                        new_id = str(self.rb_db.generate_unused_id(DjmdMyTag))
                        rb_tag = DjmdMyTag(
                            ID=new_id,
                            Name=tag.name,
                            ParentID=rb_parent_id,
                            Seq=tag.display_order,
                            Attribute=0
                        )
                        self.rb_session.add(rb_tag)
                        rb_tag_map[tag.id] = rb_tag.ID
                    else:
                        # In dry run, use a dummy ID for counting purposes
                        rb_tag_map[tag.id] = -(1000 + tag.id)
                    stats.rb_tags_created += 1

        return rb_category_map, rb_tag_map, stats

    def sync_track_tags_and_colors(
        self,
        rb_tag_map: dict[int, str],
        energy_to_color_id: dict[int, str],
        dry_run: bool = True
    ) -> TagSyncStats:
        """
        Sync track tag assignments and colors from manadj to Rekordbox.

        Args:
            rb_tag_map: Mapping of manadj tag ID -> Rekordbox MyTag ID
            energy_to_color_id: Mapping of energy value -> Rekordbox ColorID
            dry_run: If True, don't write to database

        Returns:
            TagSyncStats with operation results
        """
        stats = TagSyncStats()

        # Build energy value -> Rekordbox MyTag ID mapping
        # Energy is NOT stored as tags in manadj, but we need to map to Rekordbox Energy tags
        energy_value_to_rb_id = {}
        energy_tag_names = {
            1: "Background",
            2: "Chill",
            3: "Warm",
            4: "Hot",
            5: "Banger"
        }

        # Find Energy MyTags in Rekordbox by querying directly
        rb_energy_category = self.rb_session.query(DjmdMyTag).filter_by(
            ParentID="root",
            Name="Energy"
        ).first()

        if rb_energy_category:
            for energy_value, tag_name in energy_tag_names.items():
                rb_energy_tag = self.rb_session.query(DjmdMyTag).filter_by(
                    ParentID=rb_energy_category.ID,
                    Name=tag_name
                ).first()
                if rb_energy_tag:
                    energy_value_to_rb_id[energy_value] = rb_energy_tag.ID

        # Index Rekordbox tracks
        rb_contents = list(self.rb_db.get_content())
        rb_tracks_by_path, rb_tracks_by_filename = index_rekordbox_tracks(rb_contents)

        # Get all manadj tracks with tags OR energy values
        tracks = self.manadj_session.query(Track).filter(
            (Track.energy.isnot(None)) | (Track.id.in_(
                self.manadj_session.query(TrackTag.track_id).distinct()
            ))
        ).all()
        stats.tracks_processed = len(tracks)

        for track in tracks:
            # Match to Rekordbox track
            rb_track = match_track_rekordbox(track, rb_tracks_by_path, rb_tracks_by_filename)
            if not rb_track:
                stats.tracks_unmatched += 1
                print(f"  ⚠️  Unmatched: {track.title} - {track.artist}")
                continue

            # Get manadj tags
            manadj_tag_ids = [tt.tag_id for tt in track.track_tags]

            # Map to Rekordbox MyTag IDs
            rb_mytag_ids = [rb_tag_map[tag_id] for tag_id in manadj_tag_ids if tag_id in rb_tag_map]

            # Add energy tag if track has energy value
            if track.energy and track.energy in energy_value_to_rb_id:
                rb_energy_tag_id = energy_value_to_rb_id[track.energy]
                if rb_energy_tag_id not in rb_mytag_ids:
                    rb_mytag_ids.append(rb_energy_tag_id)

            # Check existing Rekordbox tags
            existing_rb_tags = self.rb_session.query(DjmdSongMyTag).filter_by(ContentID=rb_track.ID).all()
            if existing_rb_tags and not manadj_tag_ids:
                stats.tracks_warned += 1
                print(f"  ⚠️  Track tagged in Rekordbox but not manadj: {track.title}")

            # Update tags
            if not dry_run:
                # Clear existing
                self.rb_session.query(DjmdSongMyTag).filter_by(ContentID=rb_track.ID).delete()

                # Set new
                for mytag_id in rb_mytag_ids:
                    new_id = str(self.rb_db.generate_unused_id(DjmdSongMyTag))
                    self.rb_session.add(DjmdSongMyTag(ID=new_id, ContentID=rb_track.ID, MyTagID=mytag_id))

            # Apply color based on energy value
            if track.energy and track.energy in energy_to_color_id:
                target_color_id = energy_to_color_id[track.energy]

                if not dry_run:
                    rb_track.ColorID = target_color_id

                stats.tracks_colored += 1
            elif track.energy and not dry_run:
                # Energy exists but no color mapping - clear color
                rb_track.ColorID = "0"
                stats.tracks_color_cleared += 1

            stats.tracks_updated += 1

        return stats

    def get_mytag_structure_preview(self) -> list[tuple[str, str, int, list[tuple[str, str, int]]]]:
        """
        Get current Rekordbox MyTag structure for preview.

        Returns:
            List of (category_name, category_id, category_seq,
                     [(tag_name, tag_id, tag_seq), ...])
        """
        structure = []
        rb_categories = self.rb_session.query(DjmdMyTag).filter_by(ParentID="root").order_by(DjmdMyTag.Seq).all()

        for cat in rb_categories:
            cat_tags = self.rb_session.query(DjmdMyTag).filter_by(ParentID=cat.ID).order_by(DjmdMyTag.Seq).all()
            tags = [(tag.Name, tag.ID, tag.Seq) for tag in cat_tags]
            structure.append((cat.Name, cat.ID, cat.Seq, tags))

        return structure
