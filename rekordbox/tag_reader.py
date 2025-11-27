"""Read Rekordbox MyTag structure."""

from pyrekordbox.db6 import Rekordbox6Database
from pyrekordbox.db6.tables import DjmdMyTag, DjmdSongMyTag
from backend.tags.models import TagStructure, CategoryInfo, TagInfo


class RekordboxTagReader:
    """Read Rekordbox MyTag structure."""

    def __init__(self, rb_db: Rekordbox6Database):
        self.db = rb_db
        self.session = rb_db.session

    def get_tag_structure(self) -> TagStructure:
        """Load complete MyTag structure from Rekordbox.

        Filters out the Energy category since it's not a manadj tag.

        Returns:
            TagStructure with all categories (ParentID="root") and nested tags
        """
        # Get all categories (ParentID="root")
        rb_categories = self.session.query(DjmdMyTag).filter_by(
            ParentID="root"
        ).order_by(DjmdMyTag.Seq).all()

        category_infos = []
        total_tags = 0

        for rb_category in rb_categories:
            # Skip Energy category - not a manadj tag
            if rb_category.Name == "Energy":
                continue
            # Get all tags for this category
            rb_tags = self.session.query(DjmdMyTag).filter_by(
                ParentID=rb_category.ID
            ).order_by(DjmdMyTag.Seq).all()

            tag_infos = []
            for rb_tag in rb_tags:
                # Count tracks assigned to this tag
                track_count = self.session.query(DjmdSongMyTag).filter_by(
                    MyTagID=rb_tag.ID
                ).count()

                tag_info = TagInfo(
                    name=rb_tag.Name,
                    category_name=rb_category.Name,
                    source='rekordbox',
                    tag_id=rb_tag.ID,
                    category_id=rb_category.ID,
                    display_order=rb_tag.Seq,
                    color=None,
                    track_count=track_count
                )
                tag_infos.append(tag_info)
                total_tags += 1

            category_info = CategoryInfo(
                name=rb_category.Name,
                source='rekordbox',
                category_id=rb_category.ID,
                display_order=rb_category.Seq,
                color=None,
                tags=tag_infos
            )
            category_infos.append(category_info)

        return TagStructure(
            source='rekordbox',
            categories=category_infos,
            total_tags=total_tags
        )
