#!/usr/bin/env python3
"""
Import playlists from Engine DJ into manadj.

Prompts user to confirm before importing each playlist.
"""

import sys
from pathlib import Path
from typing import Optional
import requests

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from enginedj import EngineDJDatabase


class PlaylistImporter:
    def __init__(
        self,
        engine_db_path: Path,
        manadj_base_url: str = "http://localhost:8000"
    ):
        self.engine_db = EngineDJDatabase(engine_db_path)
        self.manadj_base_url = manadj_base_url.rstrip('/')

        # Cache for track filename mappings
        self.engine_track_cache: dict[int, str] = {}
        self.manadj_track_cache: dict[str, int] = {}

    def _load_manadj_tracks(self):
        """Load all manadj tracks and build filename -> track_id mapping."""
        print("Loading manadj tracks...")

        # Use manadj API to get all tracks
        response = requests.get(
            f"{self.manadj_base_url}/api/tracks",
            params={"page": 1, "per_page": 10000}
        )
        response.raise_for_status()

        tracks = response.json()["items"]

        # Build cache: filename -> manadj track ID
        for track in tracks:
            # Extract just the filename from full path
            filename = Path(track["filename"]).name
            self.manadj_track_cache[filename] = track["id"]

        print(f"Loaded {len(self.manadj_track_cache)} tracks from manadj")

    def _match_track(self, engine_track_id: int) -> Optional[int]:
        """Match Engine DJ track to manadj track by filename.

        Returns manadj track ID or None if not found.
        """
        # Get Engine DJ track filename
        if engine_track_id not in self.engine_track_cache:
            with self.engine_db.session_m() as session:
                from enginedj.models import Track
                track = session.get(Track, engine_track_id)
                if track:
                    self.engine_track_cache[engine_track_id] = Path(track.path).name

        engine_filename = self.engine_track_cache.get(engine_track_id)
        if not engine_filename:
            return None

        # Match to manadj track
        return self.manadj_track_cache.get(engine_filename)

    def _check_playlist_exists(self, name: str) -> Optional[dict]:
        """Check if a playlist with the given name exists in manadj.

        Returns playlist dict if exists, None otherwise.
        """
        try:
            response = requests.get(f"{self.manadj_base_url}/api/playlists")
            response.raise_for_status()
            playlists = response.json()

            for playlist in playlists:
                if playlist["name"] == name:
                    return playlist
            return None
        except requests.RequestException:
            return None

    def _handle_duplicate(self, playlist_name: str) -> Optional[str]:
        """Handle duplicate playlist name by prompting user.

        Returns:
        - New name to use (if user chose rename)
        - Original name (if user chose overwrite)
        - None (if user chose skip)
        """
        print(f"\n⚠ WARNING: Playlist '{playlist_name}' already exists in manadj")
        print("Options:")
        print("  s - Skip this playlist")
        print("  r - Rename (add suffix)")
        print("  o - Overwrite existing")

        while True:
            choice = input("Choose [s/r/o]: ").strip().lower()

            if choice == 's':
                return None
            elif choice == 'r':
                # Find available suffix
                suffix = 2
                while self._check_playlist_exists(f"{playlist_name}-{suffix}"):
                    suffix += 1
                new_name = f"{playlist_name}-{suffix}"
                print(f"Will create as: {new_name}")
                return new_name
            elif choice == 'o':
                # Will delete existing and recreate
                return playlist_name
            else:
                print("Invalid choice. Please enter s, r, or o.")

    def import_playlist(self, engine_playlist_id: int) -> bool:
        """Import a single playlist from Engine DJ.

        Returns True if successful, False otherwise.
        """
        # Get playlist info with full hierarchical name
        with self.engine_db.session_m() as session:
            from enginedj.models import Playlist
            playlist = session.get(Playlist, engine_playlist_id)
            if not playlist:
                print(f"ERROR: Playlist {engine_playlist_id} not found")
                return False

        # Build hierarchical name
        playlist_name = self.engine_db.get_playlist_hierarchy_name(engine_playlist_id)

        # Get tracks in playlist
        engine_tracks = self.engine_db.get_playlist_tracks(engine_playlist_id)

        if not engine_tracks:
            print(f"WARNING: Playlist '{playlist_name}' is empty")
            return False

        # Match tracks
        matched_track_ids = []
        unmatched_tracks = []

        for engine_track in engine_tracks:
            manadj_track_id = self._match_track(engine_track.id)
            if manadj_track_id:
                matched_track_ids.append(manadj_track_id)
            else:
                unmatched_tracks.append({
                    'title': engine_track.title,
                    'artist': engine_track.artist,
                    'filename': Path(engine_track.path).name
                })

        unmatched_count = len(unmatched_tracks)

        if not matched_track_ids:
            print(f"ERROR: No tracks could be matched for playlist '{playlist_name}'")
            return False

        # Show summary
        print(f"\nPlaylist: {playlist_name}")
        print(f"  Engine DJ tracks: {len(engine_tracks)}")
        print(f"  Matched tracks: {len(matched_track_ids)}")
        if unmatched_count:
            print(f"  Unmatched tracks: {unmatched_count}")

        # Confirm import
        response = input(f"Import playlist '{playlist_name}'? [y/N]: ").strip().lower()
        if response not in ('y', 'yes'):
            print("Skipped")
            return False

        # Check for duplicates
        existing = self._check_playlist_exists(playlist_name)
        if existing:
            final_name = self._handle_duplicate(playlist_name)
            if final_name is None:
                print("Skipped")
                return False

            # If overwriting, delete existing playlist first
            if final_name == playlist_name:
                try:
                    response = requests.delete(
                        f"{self.manadj_base_url}/api/playlists/{existing['id']}"
                    )
                    response.raise_for_status()
                    print(f"Deleted existing playlist (ID: {existing['id']})")
                except requests.RequestException as e:
                    print(f"ERROR: Failed to delete existing playlist: {e}")
                    return False

            playlist_name = final_name

        # Create playlist in manadj
        try:
            response = requests.post(
                f"{self.manadj_base_url}/api/playlists",
                json={"name": playlist_name}
            )
            response.raise_for_status()
            playlist_data = response.json()
            manadj_playlist_id = playlist_data["id"]

            print(f"Created playlist (ID: {manadj_playlist_id})")

            # Add tracks to playlist
            for position, track_id in enumerate(matched_track_ids):
                response = requests.post(
                    f"{self.manadj_base_url}/api/playlists/{manadj_playlist_id}/tracks",
                    json={"track_id": track_id, "position": position}
                )
                response.raise_for_status()

            print(f"Added {len(matched_track_ids)} tracks")
            print("✓ Import successful")

            # Warn about unmatched tracks
            if unmatched_tracks:
                print(f"\n⚠ WARNING: {len(unmatched_tracks)} tracks could not be matched:")
                for track in unmatched_tracks[:5]:  # Show first 5
                    print(f"  - {track['artist']} - {track['title']} ({track['filename']})")
                if len(unmatched_tracks) > 5:
                    print(f"  ... and {len(unmatched_tracks) - 5} more")

            return True

        except requests.RequestException as e:
            print(f"ERROR: Failed to create playlist: {e}")
            return False

    def run(self, skip_nested: bool = False):
        """Main entry point - import all playlists interactively.

        Args:
            skip_nested: If True, only import root-level playlists
        """
        print("=== Engine DJ Playlist Importer ===\n")

        # Load manadj tracks
        try:
            self._load_manadj_tracks()
        except Exception as e:
            print(f"ERROR: Failed to load manadj tracks: {e}")
            print("Make sure manadj backend is running at http://localhost:8000")
            return

        # Get playlists from Engine DJ
        print("\nScanning Engine DJ playlists...")
        if skip_nested:
            all_playlists = self.engine_db.get_root_playlists()
            print(f"Found {len(all_playlists)} root playlists\n")
        else:
            all_playlists = self.engine_db.get_all_playlists()
            print(f"Found {len(all_playlists)} playlists (including nested)\n")

        if not all_playlists:
            print("No playlists found in Engine DJ database")
            return

        # Import each playlist
        imported = 0
        skipped = 0
        failed = 0

        for playlist in all_playlists:
            success = self.import_playlist(playlist.id)
            if success:
                imported += 1
            elif success is False:
                failed += 1
            else:
                skipped += 1

        # Summary
        print("\n" + "="*50)
        print(f"Import complete:")
        print(f"  Imported: {imported}")
        print(f"  Skipped: {skipped}")
        print(f"  Failed: {failed}")


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Import playlists from Engine DJ into manadj"
    )
    parser.add_argument(
        "engine_db_path",
        type=Path,
        help="Path to Engine DJ Database2 directory"
    )
    parser.add_argument(
        "--url",
        default="http://localhost:8000",
        help="manadj backend URL (default: http://localhost:8000)"
    )
    parser.add_argument(
        "--skip-nested",
        action="store_true",
        help="Only import root-level playlists (skip nested playlists)"
    )

    args = parser.parse_args()

    if not args.engine_db_path.exists():
        print(f"ERROR: Engine DJ database path not found: {args.engine_db_path}")
        sys.exit(1)

    importer = PlaylistImporter(args.engine_db_path, args.url)
    importer.run(skip_nested=args.skip_nested)


if __name__ == "__main__":
    main()
