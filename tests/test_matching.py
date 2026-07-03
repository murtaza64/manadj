"""Tests for backend.sync_common.matching.TrackIndex — the single home of Match.

Match is the identity function of the whole Sync domain (see CONTEXT.md):
the association between a Track and its counterpart in an external library,
established by file path, falling back to filename. These tests pin the
canonical semantics that five duplicated implementations used to disagree on.
"""

from dataclasses import dataclass

import pytest

from backend.sync_common.matching import TrackIndex, find_unmatched


@dataclass
class Row:
    path: str | None
    label: str = ""


def path_of(row: Row) -> str | None:
    return row.path


@pytest.fixture
def index() -> TrackIndex[Row]:
    return TrackIndex.build(
        [
            Row("/music/a.mp3", "a"),
            Row("/music/sub/b.flac", "b"),
            Row(None, "pathless"),
        ],
        path_of,
    )


class TestMatch:
    def test_full_path_match_wins(self, index):
        assert index.match("/music/a.mp3").label == "a"

    def test_filename_fallback(self, index):
        """Tier 2: same basename, different directory."""
        assert index.match("/elsewhere/b.flac").label == "b"

    def test_path_tier_beats_filename_tier(self):
        idx = TrackIndex.build(
            [Row("/x/t.mp3", "by-path"), Row("/y/other/t.mp3", "decoy")],
            path_of,
        )
        assert idx.match("/x/t.mp3").label == "by-path"

    def test_no_match(self, index):
        assert index.match("/music/zzz.wav") is None

    def test_case_sensitive(self, index):
        """Canonical semantics: case-sensitive (the dead gen-1 matcher was
        case-insensitive; that fork dies here)."""
        assert index.match("/music/A.MP3") is None

    def test_pathless_rows_skipped(self, index):
        # the None-path row is silently excluded from both tiers
        assert index.match("pathless") is None

    def test_duplicate_paths_last_wins(self):
        idx = TrackIndex.build([Row("/m/t.mp3", "first"), Row("/m/t.mp3", "second")], path_of)
        assert idx.match("/m/t.mp3").label == "second"


class TestFindUnmatched:
    def test_partitions_by_match(self, index):
        rows = [Row("/music/a.mp3", "hit"), Row("/nowhere/new.wav", "miss")]
        missing = find_unmatched(rows, path_of, index)
        assert [r.label for r in missing] == ["miss"]

    def test_filename_fallback_counts_as_matched(self, index):
        rows = [Row("/other/dir/b.flac", "hit-by-name")]
        assert find_unmatched(rows, path_of, index) == []

    def test_pathless_source_rows_are_unmatched(self, index):
        rows = [Row(None, "pathless")]
        assert [r.label for r in find_unmatched(rows, path_of, index)] == ["pathless"]
