"""Read-only manadj tag structure queries."""

from sqlalchemy.orm import Session

from backend.crud import get_tag_categories, get_tags_by_category
from backend.models import TrackTag
from .models import TagStructure, CategoryInfo, TagInfo


class ManAdjTagReader:
    """Read-only manadj tag structure queries."""

    def __init__(self, session: Session):
        self.session = session

    def get_tag_structure(self) -> TagStructure:
        """Load complete tag structure from manadj.

        Returns:
            TagStructure with all categories and nested tags
        """
        categories = get_tag_categories(self.session)
        category_infos = []

        total_tags = 0

        for category in categories:
            tags = get_tags_by_category(self.session, category.id)
            tag_infos = []

            for tag in tags:
                # Count tracks for this tag
                track_count = self.session.query(TrackTag).filter_by(tag_id=tag.id).count()

                tag_info = TagInfo(
                    name=tag.name,
                    category_name=category.name,
                    source='manadj',
                    tag_id=tag.id,
                    category_id=category.id,
                    display_order=tag.display_order,
                    color=tag.color,
                    track_count=track_count
                )
                tag_infos.append(tag_info)
                total_tags += 1

            category_info = CategoryInfo(
                name=category.name,
                source='manadj',
                category_id=category.id,
                display_order=category.display_order,
                color=category.color,
                tags=tag_infos
            )
            category_infos.append(category_info)

        return TagStructure(
            source='manadj',
            categories=category_infos,
            total_tags=total_tags
        )
