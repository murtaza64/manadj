"""File facts: codec, bitrate, filesize, duration owned by track_metadata.

Module-interface tests against real audio fixtures (ADR-0002), issue
.scratch/track-quality/issues/01-quality-columns-library-view.md.
"""

from collections.abc import Callable
from pathlib import Path

from sqlalchemy.orm import Session

from backend.models import Track
from backend.track_metadata.file_facts import read_file_facts, refresh_file_facts


class TestReadFileFacts:
    def test_mp3(self, audio_file: Callable[..., Path]) -> None:
        facts = read_file_facts(audio_file("mp3"))
        assert facts.codec == "mp3"
        assert facts.bitrate_kbps and facts.bitrate_kbps > 0
        assert facts.filesize_bytes > 0
        assert facts.duration_secs and 0 < facts.duration_secs < 2

    def test_m4a_is_aac(self, audio_file: Callable[..., Path]) -> None:
        facts = read_file_facts(audio_file("m4a"))
        assert facts.codec == "aac"
        assert facts.bitrate_kbps and facts.bitrate_kbps > 0

    def test_flac_is_lossless(self, audio_file: Callable[..., Path]) -> None:
        facts = read_file_facts(audio_file("flac"))
        assert facts.codec == "flac"

    def test_wav_is_pcm(self, audio_file: Callable[..., Path]) -> None:
        facts = read_file_facts(audio_file("wav"))
        assert facts.codec == "pcm"
        assert facts.bitrate_kbps and facts.bitrate_kbps > 0


class TestRefreshFileFacts:
    def test_fills_missing_facts(
        self,
        db_session: Session,
        make_track: Callable[..., Track],
        audio_file: Callable[..., Path],
    ) -> None:
        path = audio_file("mp3")
        track = make_track(filename=str(path))

        updated = refresh_file_facts(db_session)

        assert updated == 1
        db_session.refresh(track)
        assert track.codec == "mp3"
        assert track.bitrate_kbps and track.bitrate_kbps > 0
        assert track.filesize_bytes and track.filesize_bytes > 0
        assert track.duration_secs and track.duration_secs > 0

    def test_skips_already_filled_unless_forced(
        self,
        db_session: Session,
        make_track: Callable[..., Track],
        audio_file: Callable[..., Path],
    ) -> None:
        path = audio_file("mp3")
        track = make_track(
            filename=str(path), codec="mp3", bitrate_kbps=1, filesize_bytes=1, duration_secs=1.0
        )

        assert refresh_file_facts(db_session) == 0
        db_session.refresh(track)
        assert track.bitrate_kbps == 1  # untouched

        assert refresh_file_facts(db_session, force=True) == 1
        db_session.refresh(track)
        assert track.bitrate_kbps != 1  # recomputed from the file

    def test_missing_file_is_skipped(
        self, db_session: Session, make_track: Callable[..., Track]
    ) -> None:
        make_track(filename="/nowhere/gone.mp3")
        assert refresh_file_facts(db_session) == 0
