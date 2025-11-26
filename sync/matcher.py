"""Track matching logic between Rekordbox and Engine DJ."""

from pathlib import Path
from enginedj.models.track import Track
from rekordbox.models import RekordboxTrack


class TrackMatcher:
    """Match tracks between Rekordbox and Engine DJ."""

    @staticmethod
    def match_by_path(rb_track: RekordboxTrack, edj_tracks: list[Track]) -> Track | None:
        """
        Match by file path (filename comparison).

        Args:
            rb_track: Rekordbox track
            edj_tracks: List of Engine DJ tracks

        Returns:
            Matched Track or None
        """
        if not rb_track.file_path:
            return None

        # Compare by filename (since paths differ between Rekordbox and Engine DJ)
        rb_filename = rb_track.file_path.name.lower()

        for track in edj_tracks:
            if track.path:
                edj_filename = Path(track.path).name.lower()
                if rb_filename == edj_filename:
                    return track

        return None

    @staticmethod
    def match_by_metadata(
        rb_track: RekordboxTrack,
        edj_tracks: list[Track],
        tolerance_bpm: float = 0.5
    ) -> Track | None:
        """
        Match by metadata (artist, title, BPM).

        Args:
            rb_track: Rekordbox track
            edj_tracks: List of Engine DJ tracks
            tolerance_bpm: BPM matching tolerance

        Returns:
            Matched Track or None
        """
        rb_artist = rb_track.artist.lower() if rb_track.artist else ""
        rb_title = rb_track.title.lower() if rb_track.title else ""

        for track in edj_tracks:
            # Match artist and title
            edj_artist = track.artist.lower() if track.artist else ""
            edj_title = track.title.lower() if track.title else ""

            if edj_artist != rb_artist or edj_title != rb_title:
                continue

            # If BPM available, verify it matches
            if rb_track.bpm and track.bpm:
                if abs(rb_track.bpm - track.bpm) > tolerance_bpm:
                    continue

            return track

        return None

    @classmethod
    def match(
        cls,
        rb_track: RekordboxTrack,
        edj_tracks: list[Track]
    ) -> Track | None:
        """
        Match track using file path first, fallback to metadata.

        Args:
            rb_track: Rekordbox track
            edj_tracks: List of Engine DJ tracks

        Returns:
            Matched Track or None
        """
        # Try path match first
        match = cls.match_by_path(rb_track, edj_tracks)
        if match:
            return match

        # Fallback to metadata match
        return cls.match_by_metadata(rb_track, edj_tracks)
