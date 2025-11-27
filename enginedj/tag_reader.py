"""Read Engine DJ tag structure from playlist hierarchy."""

from enginedj.connection import EngineDJDatabase
from enginedj.models.playlist import Playlist
from enginedj.models.playlist_entity import PlaylistEntity
from backend.tags.models import TagStructure, CategoryInfo, TagInfo


class EngineTagReader:
    """Read Engine DJ tag structure from playlist hierarchy.

    Reads the "manadj Tags" > Categories > Tags hierarchy created
    by the tag sync process.
    """

    def __init__(self, engine_db: EngineDJDatabase):
        self.db = engine_db

    def get_tag_structure(self) -> TagStructure:
        """Load tag structure from Engine DJ playlists.

        Looks for "manadj Tags" root playlist and reads 2-level
        hierarchy beneath it (Category > Tag).

        Returns:
            TagStructure or empty structure if "manadj Tags" doesn't exist
        """
        with self.db.session_m() as session:
            # Find "manadj Tags" root playlist
            root = self._find_tag_root(session)
            if not root:
                # Return empty structure
                return TagStructure(
                    source='engine',
                    categories=[],
                    total_tags=0
                )

            # Get all category playlists (children of root)
            categories = session.query(Playlist).filter_by(
                parentListId=root.id
            ).order_by(Playlist.id).all()

            category_infos = []
            total_tags = 0

            for category in categories:
                # Get all tag playlists (children of category)
                tags = session.query(Playlist).filter_by(
                    parentListId=category.id
                ).order_by(Playlist.id).all()

                tag_infos = []
                for tag in tags:
                    # Count tracks in this tag playlist
                    track_count = session.query(PlaylistEntity).filter_by(
                        listId=tag.id
                    ).count()

                    tag_info = TagInfo(
                        name=tag.title or "",
                        category_name=category.title or "",
                        source='engine',
                        tag_id=tag.id,
                        category_id=category.id,
                        display_order=None,  # Engine uses linked list, not display_order
                        color=None,
                        track_count=track_count
                    )
                    tag_infos.append(tag_info)
                    total_tags += 1

                category_info = CategoryInfo(
                    name=category.title or "",
                    source='engine',
                    category_id=category.id,
                    display_order=None,
                    color=None,
                    tags=tag_infos
                )
                category_infos.append(category_info)

            return TagStructure(
                source='engine',
                categories=category_infos,
                total_tags=total_tags
            )

    def _find_tag_root(self, session) -> Playlist | None:
        """Find the "manadj Tags" root playlist.

        Args:
            session: SQLAlchemy session

        Returns:
            Playlist object or None if not found
        """
        return session.query(Playlist).filter_by(
            title="manadj Tags",
            parentListId=0
        ).first()
