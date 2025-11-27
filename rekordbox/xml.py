"""Rekordbox XML export utilities."""

from pathlib import Path

from pyrekordbox.rbxml import RekordboxXml

from backend.models import Track as ManAdjTrack
from backend.key import Key


def manadj_track_to_rekordbox_xml_fields(track: ManAdjTrack) -> dict:
    """
    Convert a manadj Track to Rekordbox XML fields.

    Args:
        track: manadj Track to convert

    Returns:
        dict with keys: Name, Artist, AverageBpm, Tonality
        Handles conversions:
        - BPM: centiBPM → float (bpm / 100.0)
        - Key: Engine DJ ID → musical notation (via Key.rekordbox)
        - Title: track.title or filename stem
    """
    file_path = Path(track.filename)

    # Convert BPM from centiBPM to float
    average_bpm = track.bpm / 100.0 if track.bpm else None

    # Convert key from Engine DJ ID to Rekordbox musical notation
    tonality = None
    if track.key is not None:
        key_obj = Key.from_engine_id(track.key)
        tonality = key_obj.rekordbox if key_obj else None

    # Get title (use filename stem as fallback)
    name = track.title if track.title else file_path.stem

    return {
        'Name': name,
        'Artist': track.artist,
        'AverageBpm': average_bpm,
        'Tonality': tonality
    }


def create_rekordbox_xml_from_tracks(
    tracks: list[ManAdjTrack],
    output_path: Path,
    playlist_name: str,
    validate_paths: bool = True
) -> int:
    """
    Create a Rekordbox XML file from a list of manadj tracks.

    Args:
        tracks: List of manadj tracks to export
        output_path: Path to save the XML file
        playlist_name: Name of the playlist to create
        validate_paths: Whether to skip tracks with missing files

    Returns:
        Number of tracks successfully exported
    """
    # Create Rekordbox XML instance
    xml = RekordboxXml(name="manadj", version="1.0", company="manadj")

    # Add tracks and collect TrackIDs
    exported = 0
    track_ids = []

    for track in tracks:
        # Get file path
        file_path = Path(track.filename)

        # Validate path if requested
        if validate_paths and not file_path.exists():
            continue

        # Get Rekordbox fields
        fields = manadj_track_to_rekordbox_xml_fields(track)

        # Add track to XML (location is positional, rest are kwargs)
        rb_track = xml.add_track(
            str(file_path.absolute()),
            **fields
        )
        track_ids.append(rb_track.TrackID)
        exported += 1

    # Create playlist
    playlist = xml.add_playlist(playlist_name, keytype="TrackID")

    # Add all tracks to the playlist
    for track_id in track_ids:
        playlist.add_track(track_id)

    # Save XML file
    xml.save(str(output_path), indent="\t", encoding="utf-8")

    # Postprocess: Fix double slash in file:// URIs
    # pyrekordbox generates file://localhost//Users/... but should be file://localhost/Users/...
    with open(output_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Replace file://localhost// with file://localhost/
    content = content.replace('file://localhost//', 'file://localhost/')

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(content)

    return exported
