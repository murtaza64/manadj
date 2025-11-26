"""Read Rekordbox database and extract MyTag data."""

from pathlib import Path
from pyrekordbox import Rekordbox6Database
from pyrekordbox.db6.tables import DjmdMyTag
from .models import RekordboxTrack, MyTagStructure


class RekordboxReader:
    """Read Rekordbox database and extract MyTag data."""

    def __init__(self):
        """Initialize Rekordbox database connection."""
        self.db = Rekordbox6Database()

    def get_mytag_structure(self) -> MyTagStructure:
        """
        Get complete MyTag hierarchy.

        Returns:
            MyTagStructure with categories and their tags
        """
        # Query all root categories (ParentID == "root")
        categories = self.db.query(DjmdMyTag).filter(
            DjmdMyTag.ParentID == "root"
        ).order_by(DjmdMyTag.Seq).all()

        # Build structure
        structure = {}
        for category in categories:
            # Get all child tags for this category
            tags = self.db.query(DjmdMyTag).filter(
                DjmdMyTag.ParentID == category.ID
            ).order_by(DjmdMyTag.Seq).all()

            structure[category.Name] = [tag.Name for tag in tags]

        return MyTagStructure(categories=structure)

    def get_tracks_with_mytags(self) -> list[RekordboxTrack]:
        """
        Get all tracks that have MyTags assigned.

        Returns:
            List of RekordboxTrack objects
        """
        tracks = []
        all_content = self.db.get_content()

        for content in all_content:
            if not content.MyTags:
                continue

            # Extract category -> tag pairs
            mytags = []
            for song_mytag in content.MyTags:
                tag = song_mytag.MyTag
                if tag and tag.Parent:
                    category = tag.Parent.Name
                    tag_name = tag.Name
                    mytags.append((category, tag_name))

            if mytags:
                # Get file path
                file_path = Path(content.FolderPath) if content.FolderPath else None

                tracks.append(RekordboxTrack(
                    title=content.Title or "",
                    artist=content.Artist.Name if content.Artist else "",
                    file_path=file_path,
                    bpm=content.BPM,
                    key=content.Key.ScaleName if content.Key else None,
                    mytags=tuple(mytags)
                ))

        return tracks
