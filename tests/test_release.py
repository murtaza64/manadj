"""Release tooling (scripts/release/release.py, #298): version single-sourcing,
changelog roll, release notes."""

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
_spec = importlib.util.spec_from_file_location("release", ROOT / "scripts" / "release" / "release.py")
assert _spec and _spec.loader
release = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(release)

CHANGELOG = """# Changelog

## [Unreleased]

### Added
- Thing one.

## [0.1.0] - 2026-10-07

First release.

[Unreleased]: https://github.com/murtaza64/manadj/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/murtaza64/manadj/releases/tag/v0.1.0
"""


def test_desktop_version_mirrors_pyproject():
    py = release.read_pyproject_version((ROOT / "pyproject.toml").read_text())
    pkg = json.loads((ROOT / "desktop" / "package.json").read_text())["version"]
    assert py == pkg, "desktop/package.json must mirror pyproject.toml's version"


def test_committed_changelog_has_current_version():
    py = release.read_pyproject_version((ROOT / "pyproject.toml").read_text())
    assert release.changelog_section((ROOT / "CHANGELOG.md").read_text(), py)


def test_set_versions():
    assert release.read_pyproject_version(
        release.set_pyproject_version('[project]\nname = "x"\nversion = "0.1.0"\n', "0.2.0")
    ) == "0.2.0"
    assert json.loads(release.set_package_json_version('{"version": "0.1.0"}', "0.2.0"))["version"] == "0.2.0"


def test_changelog_section():
    assert release.changelog_section(CHANGELOG, "0.1.0") == "First release."
    assert release.changelog_section(CHANGELOG, "Unreleased") == "### Added\n- Thing one."
    assert release.changelog_section(CHANGELOG, "9.9.9") is None


def test_roll_changelog():
    rolled = release.roll_changelog(CHANGELOG, "0.2.0", "2026-11-01")
    assert release.changelog_section(rolled, "0.2.0") == "### Added\n- Thing one."
    assert release.changelog_section(rolled, "Unreleased") == ""
    assert "compare/v0.2.0...HEAD" in rolled
    assert "[0.2.0]: https://github.com/murtaza64/manadj/releases/tag/v0.2.0" in rolled
    # idempotent
    assert release.roll_changelog(rolled, "0.2.0", "2026-11-02") == rolled


def test_prerelease_notes_use_base_section_and_install_doc():
    notes = release.release_notes(CHANGELOG, "# Installing\n\n1. Drag.\n", "0.1.0-rc.1")
    assert "Prerelease 0.1.0-rc.1" in notes
    assert "First release." in notes
    assert "## Install\n\n1. Drag." in notes
    assert "# Installing" not in notes


def test_is_prerelease():
    assert release.is_prerelease("0.1.0-rc.1")
    assert not release.is_prerelease("0.1.0")
    assert release.base_version("0.1.0-rc.1") == "0.1.0"
