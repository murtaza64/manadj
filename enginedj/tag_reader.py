"""Read Engine DJ tag structure from flat playlist structure."""

from enginedj.connection import EngineDJDatabase
from enginedj.models.playlist import Playlist
from enginedj.models.playlist_entity import PlaylistEntity
from backend.tags.models import TagStructure, CategoryInfo, TagInfo


class EngineTagReader:
    """Read Engine DJ tag structure from flat playlist structure.

    Reads the "manaDJ Tags" > Tag1, Tag2, ... flat structure created
    by the tag sync process.
    """

    def __init__(self, engine_db: EngineDJDatabase):
        self.db = engine_db

    def get_tag_structure(self) -> TagStructure:
        """Load tag structure from Engine DJ playlists.

        Looks for "manaDJ Tags" root playlist and reads all tag playlists
        directly beneath it (flat structure, no categories).

        Returns:
            TagStructure with a single "Tags" category containing all tags
        """
        with self.db.session_m() as session:
            # Find "manaDJ Tags" root playlist
            root = self._find_tag_root(session)
            if not root:
                return TagStructure(
                    source='engine',
                    categories=[],
                    total_tags=0
                )

            # Get all tag playlists directly under root
            tags = session.query(Playlist).filter_by(
                parentListId=root.id
            ).order_by(Playlist.title).all()

            tag_infos = []
            for tag in tags:
                # Count tracks in this tag playlist
                track_count = session.query(PlaylistEntity).filter_by(
                    listId=tag.id
                ).count()

                tag_info = TagInfo(
                    name=tag.title or "",
                    category_name="",  # No category in flat structure
                    source='engine',
                    tag_id=tag.id,
                    category_id=root.id,
                    display_order=None,
                    color=None,
                    track_count=track_count
                )
                tag_infos.append(tag_info)

            # Wrap all tags in a single pseudo-category for API compatibility
            category_infos = []
            if tag_infos:
                category_infos.append(CategoryInfo(
                    name="",  # Empty category name for flat structure
                    source='engine',
                    category_id=root.id,
                    display_order=None,
                    color=None,
                    tags=tag_infos
                ))

            return TagStructure(
                source='engine',
                categories=category_infos,
                total_tags=len(tag_infos)
            )

    def _find_tag_root(self, session) -> Playlist | None:
        """Find the "manaDJ Tags" root playlist.

        Args:
            session: SQLAlchemy session

        Returns:
            Playlist object or None if not found
        """
        return session.query(Playlist).filter_by(
            title="manaDJ Tags",
            parentListId=0
        ).first()
