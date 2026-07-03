"""Cleanup: normalizing raw Source metadata into Track title/artist.

Pure-logic unit tests (see CONTEXT.md: Cleanup).
"""

from backend.acquisition.cleanup import CleanupConfig, clean_metadata, safe_basename

CFG = CleanupConfig()


class TestCleanMetadata:
    def test_artist_title_split(self) -> None:
        meta = clean_metadata("Hoax - Wake Up", "hoaxdnb", CFG)
        assert (meta.artist, meta.title) == ("Hoax", "Wake Up")

    def test_uploader_fallback_when_no_dash(self) -> None:
        meta = clean_metadata("GLUE", "Bicep", CFG)
        assert (meta.artist, meta.title) == ("Bicep", "GLUE")

    def test_strips_junk_tokens(self) -> None:
        meta = clean_metadata("Kessler - Lucid [FREE DL]", "Kessler", CFG)
        assert (meta.artist, meta.title) == ("Kessler", "Lucid")

    def test_strips_free_download_and_out_now(self) -> None:
        meta = clean_metadata("Fractal - Gravity (FREE DOWNLOAD) OUT NOW", "Fractal", CFG)
        assert (meta.artist, meta.title) == ("Fractal", "Gravity")

    def test_strips_empty_brackets_left_behind(self) -> None:
        meta = clean_metadata("TANTRON - CERBERUS [NCS Release]", "NCS", CFG)
        assert (meta.artist, meta.title) == ("TANTRON", "CERBERUS")

    def test_strips_emoji(self) -> None:
        meta = clean_metadata("Kessler - Lucid ⚡", "Kessler", CFG)
        assert (meta.artist, meta.title) == ("Kessler", "Lucid")

    def test_preserves_meaningful_parentheses(self) -> None:
        meta = clean_metadata("Sub Focus - Rock It (Wilkinson Remix)", "UKF", CFG)
        assert (meta.artist, meta.title) == ("Sub Focus", "Rock It (Wilkinson Remix)")

    def test_only_first_dash_splits(self) -> None:
        meta = clean_metadata("A - B - C", "up", CFG)
        assert (meta.artist, meta.title) == ("A", "B - C")

    def test_strips_orphaned_trailing_separators(self) -> None:
        """Regression: 'PENDULUM - WATERCOLOUR [BENNIE EDIT] // FREE DL' kept '//'."""
        meta = clean_metadata("PENDULUM - WATERCOLOUR [BENNIE EDIT] // FREE DL", "Bennie", CFG)
        assert (meta.artist, meta.title) == ("PENDULUM", "WATERCOLOUR [BENNIE EDIT]")


class TestSafeBasename:
    def test_joins_artist_and_title(self) -> None:
        assert safe_basename("Hoax", "Wake Up") == "Hoax - Wake Up"

    def test_no_artist(self) -> None:
        assert safe_basename(None, "Wake Up") == "Wake Up"

    def test_strips_path_hostile_characters(self) -> None:
        assert safe_basename("AC/DC", "Back: In Black?") == "AC-DC - Back- In Black"
