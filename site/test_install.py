#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["jinja2", "markdown", "pyyaml"]
# ///
"""Run with uv run site/test_install.py. Broken-file fixtures are temporary decoys."""

import tempfile
import unittest
from html.parser import HTMLParser
from pathlib import Path

from build import SITE, render_pages, validate_pages, validate_site


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.links = []
        self.ids = []
        self.chapters = []
        self.text = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a":
            self.links.append(attrs.get("href"))
        if "id" in attrs:
            self.ids.append(attrs["id"])
        if "data-slug" in attrs:
            self.chapters.append(attrs["data-slug"])

    def handle_data(self, data):
        self.text.append(data)


class LinkValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "decoy.png").write_bytes(b"decoy asset")

    def check(self, pages):
        validate_pages(pages, self.root)

    def test_cross_page_links_work_before_output_exists(self):
        self.check({
            "index.html": '<a href="install.html?from=home#setup">Install</a><img src="decoy.png">',
            "install.html": '<h1 id="setup">Setup</h1><a href="index.html">Home</a>',
        })

    def test_nested_relative_paths_and_encoded_fragments(self):
        self.check({
            "index.html": '<h1 id="first-run">Welcome</h1><a href="guide/install.html#cue%2Dmode">Guide</a>',
            "guide/install.html": '<h1 id="cue-mode">Cue</h1><a href="../index.html#first-run">Home</a><img src="../decoy.png">',
        })

    def test_cross_page_anchor_checked_against_destination(self):
        with self.assertRaisesRegex(SystemExit, "index.html: missing anchor install.html#setup"):
            self.check({
                "index.html": '<h1 id="setup">Local ID must not match</h1><a href="install.html#setup">Install</a>',
                "install.html": '<h1 id="other">Guide</h1>',
            })

    def test_same_page_anchor_checked(self):
        with self.assertRaisesRegex(SystemExit, "missing anchor #absent"):
            self.check({"index.html": '<a href="#absent">Missing</a>'})

    def test_duplicate_ids_checked_on_every_page(self):
        with self.assertRaisesRegex(SystemExit, "install.html: duplicate"):
            self.check({"index.html": "", "install.html": '<h1 id="setup"></h1><h2 id="setup"></h2>'})

    def test_missing_assets_in_all_supported_attributes(self):
        for element in ('<img src="missing.png">', '<video poster="missing.png"></video>', '<link href="missing.css">'):
            with self.subTest(element=element), self.assertRaisesRegex(SystemExit, "missing target/media"):
                self.check({"install.html": element})

    def test_stale_output_cannot_hide_unbuilt_page(self):
        (self.root / "stale.html").write_text('<h1 id="setup">Old guide</h1>')
        with self.assertRaisesRegex(SystemExit, "missing target/media stale.html"):
            self.check({"index.html": '<a href="stale.html#setup">Old page</a>'})

    def test_root_relative_and_escaping_links_rejected(self):
        for href in ("/install.html", "/decoy.png", "../outside.png", "%2Fdecoy.png"):
            with self.subTest(href=href), self.assertRaisesRegex(SystemExit, "not subpath safe|escapes site"):
                self.check({"index.html": f'<a href="{href}">Bad path</a>'})

    def test_directory_urls_and_fragments_agree_between_validators(self):
        pages = {
            "index.html": '<a href="guide/?from=home#cue%2Dmode">Guide</a>',
            "guide/index.html": '<h1 id="cue-mode">Cue</h1><a href="../#home">Home</a>',
        }
        for anchor in ("home", "other"):
            rendered = {**pages, "index.html": pages["index.html"] + f'<h1 id="{anchor}"></h1>'}
            for name, html in rendered.items():
                path = self.root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(html)
            for validate in (lambda rendered=rendered: self.check(rendered), lambda: validate_site(self.root)):
                with self.subTest(anchor=anchor, validate=validate):
                    if anchor == "home":
                        validate()
                    else:
                        with self.assertRaisesRegex(SystemExit, "missing anchor ../#home"):
                            validate()

    def test_external_navigation_does_not_require_local_files(self):
        self.check({"index.html": '<a href="https://github.com/murtaza64/manadj/releases/latest">Release</a>'})


class InstallBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pages = render_pages()

    def test_generated_pages_are_current_and_links_resolve(self):
        validate_pages(self.pages)
        for name, html in self.pages.items():
            with self.subTest(name=name):
                self.assertIn("GENERATED by site/build.py", html)
                self.assertEqual((SITE / name).read_text(encoding="utf-8"), html, "Run uv run site/build.py")

    def test_domain(self):
        self.assertEqual((SITE / "CNAME").read_text(), "manadj.murt.dev\n")

    def test_workflow_and_retired_glossary(self):
        html = self.pages["index.html"]
        page = Page(html)
        self.assertEqual(page.chapters, ["acquire", "curate", "perform", "follow", "capture", "editor", "sets", "sync"])
        self.assertIn("07 · ARRANGE", html)
        for alias in ["analysis", "controllers", "start"]:
            self.assertIn(alias, page.ids)
        self.assertNotIn("words", page.ids)
        self.assertFalse(any(id.startswith("term-") for id in page.ids))
        self.assertNotIn('class="chips"', html)
        self.assertFalse(any(link.startswith(("#term-", "#words")) for link in page.links))

    def test_both_pages_offer_pinned_installers_and_distinct_release_links(self):
        releases = "https://github.com/murtaza64/manadj/releases"
        for name in ("index.html", "install.html"):
            html = self.pages[name]
            with self.subTest(name=name):
                page = Page(html)
                for asset in ("manaDJ-0.1.0-rc.3-arm64.dmg", "manaDJ-0.1.0-rc.3-x64-setup.exe"):
                    self.assertIn(f"{releases}/download/v0.1.0-rc.3/{asset}", page.links)
                self.assertIn(f"{releases}/tag/v0.1.0-rc.3", page.links)
                self.assertIn(f"{releases}/latest", page.links)
                text = " ".join(page.text)
                self.assertIn("untested on Windows hardware", text)
                self.assertIn("excludes prereleases", text)

    def test_setup_sequence_and_home_round_trip(self):
        page = Page(self.pages["install.html"])
        sequence = ["welcome", "rekordbox-import", "music-folder", "cue-mode", "soundcloud", "soulseek", "controller-check"]
        self.assertEqual([id for id in page.ids if id in sequence], sequence)
        for id in sequence + ["rerun-setup", "data", "updates", "uninstall", "troubleshooting"]:
            self.assertIn(f"#{id}", page.links, "Guide heading must be reachable from the contents")
        self.assertIn("index.html#perform", page.links)
        self.assertIn("install.html", Page(self.pages["index.html"]).links)


if __name__ == "__main__":
    unittest.main()
