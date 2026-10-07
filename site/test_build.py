#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["jinja2", "markdown", "pyyaml"]
# ///
"""Build integration tests; all input mutations and output live in temp dirs."""

import json
import shutil
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from build import SITE, build, validate_site


class HelpBuildTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="manadj-help-test-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.source = self.root / "source"
        # Use the actual pitch, templates, fonts and media. Test articles are
        # isolated from concurrently authored manual content.
        for name in ("templates", "assets", "shots", "media"):
            shutil.copytree(SITE / name, self.source / name)
        shutil.copytree(SITE / "content", self.source / "content", ignore=shutil.ignore_patterns("help"))
        self.help = self.source / "content" / "help"
        self.help.mkdir()
        self.output = self.root / "pages" / "project-name"
        self.public = self.root / "frontend" / "public"
        self.public.mkdir(parents=True)
        (self.public / "keep.txt").write_text("unrelated public data", encoding="utf-8")
        self.article("curate", """## Local section {#local}

[Next](../perform/index.html#transport)
[Directory URL](../perform/#transport)
[Glossary](../../index.html#term-track)
[Same page](#local)

| Key | Action |
| --- | --- |
| D | Play |
""", related="[perform]")
        self.article("perform", "## Transport {#transport}\n\nPlay the Track.", media=True)

    def article(self, slug, body, related="[]", media=False):
        text = f"---\nslug: {slug}\ntitle: '{slug} — guide'\nsummary: A detailed guide.\norder: 1\nrelated: {related}\n"
        if media:
            text += "shot: perform-motion\nclip: perform\ncaption: Playback\n"
        (self.help / f"{slug}.md").write_text(text + "---\n\n" + body, encoding="utf-8")

    def test_build_subpath_manifest_and_exact_offline_copy(self):
        build(self.source, self.output, self.public)
        manifest = json.loads((self.output / "help" / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual([a["slug"] for a in manifest], ["curate", "perform"])
        self.assertIn("transport", manifest[1]["anchors"])
        page = (self.output / "help" / "curate" / "index.html").read_text(encoding="utf-8")
        self.assertIn('<h2 id="local">', page)
        self.assertIn("<table>", page)
        self.assertIn('aria-label="On this page"', page)
        self.assertIn('href="help/curate/index.html"', (self.output / "index.html").read_text(encoding="utf-8"))
        # Every browser URL remains inside an arbitrary Pages mount point.
        for path, links in validate_site(self.output).items():
            base = "https://example.test/project-name/" + path.relative_to(self.output).as_posix()
            for raw in links.urls:
                if not urlsplit(raw).scheme and not urlsplit(raw).netloc:
                    self.assertTrue(urlsplit(urljoin(base, raw)).path.startswith("/project-name/"), raw)
        manual = self.public / "manual"
        self.assertEqual({p.name for p in manual.iterdir()}, {"index.html", "help", "assets", "shots", "media"})
        for path in self.output.rglob("*"):
            if path.is_file():
                self.assertEqual(path.read_bytes(), (manual / path.relative_to(self.output)).read_bytes())
        self.assertEqual((self.public / "keep.txt").read_text(encoding="utf-8"), "unrelated public data")
        validate_site(manual)

    def test_missing_cross_page_anchor_fails_before_publishing(self):
        self.article("curate", "[Bad](../perform/index.html#missing)")
        with self.assertRaisesRegex(SystemExit, "missing anchor.*missing"):
            build(self.source, self.output, self.public)
        self.assertFalse(self.output.exists())
        self.assertFalse((self.public / "manual").exists())

    def test_missing_media_fails_before_publishing(self):
        # Only a temporary decoy copy is removed.
        (self.source / "media" / "perform.mp4").unlink()
        with self.assertRaisesRegex(SystemExit, "missing target/media.*perform.mp4"):
            build(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_stale_output_cannot_satisfy_a_missing_target(self):
        self.article("curate", "[Bad](../stale/index.html#old)")
        stale = self.output / "help" / "stale" / "index.html"
        stale.parent.mkdir(parents=True)
        stale.write_text('<h1 id="old">Stale</h1>', encoding="utf-8")
        with self.assertRaisesRegex(SystemExit, "missing target/media.*stale"):
            build(self.source, self.output)
        self.assertTrue(stale.exists())

    def test_missing_glossary_anchor_fails(self):
        self.article("curate", "[Bad](../../index.html#term-nonexistent)")
        with self.assertRaisesRegex(SystemExit, "missing anchor.*term-nonexistent"):
            build(self.source, self.output)

    def test_root_absolute_link_fails(self):
        self.article("curate", "[Bad](/help/perform/index.html)")
        with self.assertRaisesRegex(SystemExit, "not subpath safe"):
            build(self.source, self.output)

    def test_duplicate_heading_ids_fail(self):
        self.article("curate", "## First {#same}\n\n## Second {#same}")
        with self.assertRaisesRegex(SystemExit, "duplicate element IDs"):
            build(self.source, self.output)

    def test_unknown_related_article_fails(self):
        self.article("curate", "## First {#first}", related="[missing]")
        with self.assertRaisesRegex(SystemExit, "unknown related articles"):
            build(self.source, self.output)

    def test_no_content_and_site_only_build(self):
        shutil.rmtree(self.help)
        build(self.source, self.output)
        self.assertEqual(json.loads((self.output / "help" / "manifest.json").read_text(encoding="utf-8")), [])
        self.assertFalse((self.public / "manual").exists())

    def test_rebuild_removes_stale_generated_pages_only(self):
        build(self.source, self.output, self.public)
        (self.help / "perform.md").unlink()
        self.article("curate", "## Local {#local}")
        build(self.source, self.output, self.public)
        self.assertFalse((self.output / "help" / "perform").exists())
        self.assertFalse((self.public / "manual" / "help" / "perform").exists())
        self.assertTrue((self.public / "keep.txt").exists())


if __name__ == "__main__":
    unittest.main()
