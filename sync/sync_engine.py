"""Synchronization engine for Rekordbox MyTags to Engine DJ playlists."""

from pathlib import Path
from collections import defaultdict
from enginedj import EngineDJDatabase
from enginedj.models.track import Track
from enginedj.models.playlist import Playlist
from rekordbox import RekordboxReader
from .matcher import TrackMatcher


class SyncEngine:
    """Synchronize Rekordbox MyTags to Engine DJ playlists."""

    def __init__(self, engine_db_path: Path):
        """
        Initialize sync engine.

        Args:
            engine_db_path: Path to Engine DJ Database2 directory
        """
        self.engine_db = EngineDJDatabase(engine_db_path)
        self.rekordbox = RekordboxReader()
        self.matcher = TrackMatcher()

    def _find_or_create_playlist(
        self,
        title: str,
        parent_id: int = 0
    ) -> Playlist:
        """
        Find existing playlist or create new one.

        Args:
            title: Playlist title
            parent_id: Parent playlist ID

        Returns:
            Playlist object (existing or newly created)
        """
        # Query existing playlists
        with self.engine_db.session_m() as session:
            existing = session.query(Playlist).filter(
                Playlist.title == title,
                Playlist.parentListId == parent_id
            ).first()

            if existing:
                return existing

        # Create new playlist (empty for now)
        return self.engine_db.create_playlist(title, [], parent_id)

    def _update_playlist_tracks(
        self,
        playlist: Playlist,
        tracks: list[Track]
    ):
        """
        Update playlist with new track list.

        Clears existing tracks and adds new ones.

        Args:
            playlist: Playlist to update
            tracks: List of tracks to add
        """
        from enginedj.models.playlist_entity import PlaylistEntity
        from enginedj.models.information import Information

        with self.engine_db.session_m_write() as session:
            # Get database UUID
            info = session.query(Information).first()
            db_uuid = info.uuid if info else None

            # Delete existing entities
            session.query(PlaylistEntity).filter(
                PlaylistEntity.listId == playlist.id
            ).delete()

            # Add new tracks (deduplicate by track ID)
            if tracks:
                # Remove duplicates while preserving order
                seen = set()
                unique_tracks = []
                for track in tracks:
                    if track.id not in seen:
                        seen.add(track.id)
                        unique_tracks.append(track)

                entities = []
                for track in unique_tracks:
                    entity = PlaylistEntity(
                        listId=playlist.id,
                        trackId=track.id,
                        databaseUuid=db_uuid,
                        nextEntityId=0,
                        membershipReference=0
                    )
                    entities.append(entity)
                    session.add(entity)

                session.flush()

                # Link entities in order
                for i in range(len(entities) - 1):
                    entities[i].nextEntityId = entities[i + 1].id

    def sync(self, dry_run: bool = False, show_preview: bool = True) -> dict:
        """
        Synchronize Rekordbox MyTags to Engine DJ playlists.

        Creates 3-level structure:
        - Root: "Rekordbox My Tag"
        - Level 2: Categories (Genre, Vibe, Energy, etc.)
        - Level 3: Tags (Drum & Bass, Vocal, etc.)

        Args:
            dry_run: If True, only report what would be done
            show_preview: If True, show structure preview before syncing

        Returns:
            Statistics dictionary
        """
        stats = {
            'total_rb_tracks': 0,
            'matched_tracks': 0,
            'unmatched_tracks': 0,
            'playlists_created': 0,
            'playlists_updated': 0
        }

        # Get all Engine DJ tracks
        with self.engine_db.session_m() as session:
            edj_tracks = session.query(Track).all()

        # Get Rekordbox tracks with MyTags
        rb_tracks = self.rekordbox.get_tracks_with_mytags()
        stats['total_rb_tracks'] = len(rb_tracks)

        # Match tracks
        track_matches = {}
        for rb_track in rb_tracks:
            edj_track = self.matcher.match(rb_track, edj_tracks)
            if edj_track:
                track_matches[rb_track] = edj_track
                stats['matched_tracks'] += 1
            else:
                stats['unmatched_tracks'] += 1
                print(f"⚠️  No match: {rb_track.artist} - {rb_track.title}")

        # Get MyTag structure
        mytag_structure = self.rekordbox.get_mytag_structure()

        # Build track lists per category/tag
        playlist_tracks = defaultdict(list)

        for rb_track, edj_track in track_matches.items():
            for category, tag in rb_track.mytags:
                key = (category, tag)
                playlist_tracks[key].append(edj_track)

        # Show preview if requested
        if show_preview:
            print("\n📋 Playlist Structure Preview:")
            print("=" * 60)
            print("Rekordbox My Tag")

            for category in sorted(mytag_structure.categories.keys()):
                tags_in_category = []
                for tag in mytag_structure.categories[category]:
                    key = (category, tag)
                    track_count = len(playlist_tracks.get(key, []))
                    if track_count > 0:
                        tags_in_category.append((tag, track_count))

                if tags_in_category:
                    print(f"├── {category}")
                    for i, (tag, count) in enumerate(tags_in_category):
                        prefix = "└──" if i == len(tags_in_category) - 1 else "├──"
                        print(f"│   {prefix} {tag}: {count} tracks")
                else:
                    print(f"├── {category} (empty)")

            print("=" * 60)
            print()

        if dry_run:
            print("📊 Dry run complete:")
            print(f"  Total Rekordbox tracks with MyTags: {stats['total_rb_tracks']}")
            print(f"  Matched: {stats['matched_tracks']}")
            print(f"  Unmatched: {stats['unmatched_tracks']}")
            return stats

        # Create root playlist
        root_playlist = self._find_or_create_playlist("Rekordbox My Tag", parent_id=0)

        # Create category and tag playlists
        for category in mytag_structure.categories.keys():
            # Create category playlist
            category_playlist = self._find_or_create_playlist(
                category,
                parent_id=root_playlist.id
            )
            stats['playlists_created'] += 1

            # Create tag playlists under category
            for tag in mytag_structure.categories[category]:
                key = (category, tag)
                tracks = playlist_tracks.get(key, [])

                if tracks:
                    tag_playlist = self._find_or_create_playlist(
                        tag,
                        parent_id=category_playlist.id
                    )

                    # Update tracks
                    self._update_playlist_tracks(tag_playlist, tracks)
                    stats['playlists_updated'] += 1

                    print(f"✓ {category} → {tag}: {len(tracks)} tracks")

        return stats
