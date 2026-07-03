"""Tests for the RBXML export (rekordbox/xml.py).

Regression: fields with no value were passed as Python None and stringified
into the XML as the literal word "None" — Engine DJ then imported 14 tracks
with artist "None".
"""

import xml.etree.ElementTree as ET

from backend.models import Track
from rekordbox.xml import create_rekordbox_xml_from_tracks


def _export_single(tmp_path, track):
    out = tmp_path / "out.xml"
    exported = create_rekordbox_xml_from_tracks(
        [track], out, playlist_name="test", validate_paths=False
    )
    assert exported == 1
    return ET.parse(out).getroot()


def _track_elem(root):
    tracks = root.findall(".//TRACK")
    # playlist entries are also TRACK elements (keyed by TrackID only)
    return next(t for t in tracks if "Location" in t.attrib)


class TestEmptyFields:
    def test_no_artist_means_no_artist_attribute(self, tmp_path):
        track = Track(filename="/m/fx.mp3", title="Correct Answer", artist=None)
        elem = _track_elem(_export_single(tmp_path, track))
        assert elem.get("Artist") in (None, ""), f"Artist={elem.get('Artist')!r}"
        assert elem.get("Artist") != "None"

    def test_no_bpm_no_key_do_not_stringify(self, tmp_path):
        track = Track(filename="/m/fx.mp3", title="T", artist=None, bpm=None, key=None)
        elem = _track_elem(_export_single(tmp_path, track))
        for attr in ("Artist", "AverageBpm", "Tonality"):
            assert elem.get(attr) != "None", f"{attr} stringified None"

    def test_populated_fields_still_exported(self, tmp_path):
        track = Track(
            filename="/m/t.mp3", title="Song", artist="Someone", bpm=17400, key=1
        )
        elem = _track_elem(_export_single(tmp_path, track))
        assert elem.get("Name") == "Song"
        assert elem.get("Artist") == "Someone"
        assert float(elem.get("AverageBpm")) == 174.0
        assert elem.get("Tonality") == "Am"
