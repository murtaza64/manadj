"""Synthetic enabled-configuration regressions, no provider calls or credentials."""
from pathlib import Path
import shutil
import tempfile
import unittest
from check_config_enabled import verify

R2_BLOCK = '\n[[r2_buckets]]\nbinding = "LIBRARY_BUCKET"\nbucket_name = "manadj-library-data"\n'


class EnabledDeployment(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="manadj-library-enabled-config-")
        self.root = Path(self.temp.name)
        source = Path(__file__).resolve().parent
        for name in ("wrangler.toml", "package.json", "package-lock.json"):
            shutil.copyfile(source / name, self.root / name)
        # The reviewed enablement change made the real config the enabled one;
        # the suite copies it verbatim and mutates copies for rejections.

    def tearDown(self):
        self.temp.cleanup()

    def replace(self, old, new):
        path = self.root / "wrangler.toml"
        text = path.read_text()
        assert old in text
        path.write_text(text.replace(old, new))

    def test_reviewed_enabled_target(self):
        verify(self.root)

    def test_disabled_switch_rejected(self):
        self.replace('SNAPSHOTS_ENABLED = "true"', 'SNAPSHOTS_ENABLED = "false"')
        with self.assertRaises(AssertionError):
            verify(self.root)

    def test_missing_binding_rejected(self):
        path = self.root / "wrangler.toml"
        path.write_text(path.read_text().replace(R2_BLOCK, ""))
        with self.assertRaises(AssertionError):
            verify(self.root)

    def test_wrong_bucket_rejected(self):
        self.replace('bucket_name = "manadj-library-data"', 'bucket_name = "manadj-private-feedback"')
        with self.assertRaises(AssertionError):
            verify(self.root)

    def test_wrong_binding_name_rejected(self):
        self.replace('binding = "LIBRARY_BUCKET"', 'binding = "OTHER_BUCKET"')
        with self.assertRaises(AssertionError):
            verify(self.root)

    def test_second_binding_rejected(self):
        with (self.root / "wrangler.toml").open("a") as file:
            file.write('\n[[r2_buckets]]\nbinding = "EXTRA"\nbucket_name = "manadj-library-data"\n')
        with self.assertRaises(AssertionError):
            verify(self.root)

    def test_preview_url_rejected(self):
        self.replace("preview_urls = false", "preview_urls = true")
        with self.assertRaises(AssertionError):
            verify(self.root)

    def test_wrong_target_rejected(self):
        self.replace('name = "manadj-private-library"', 'name = "manadj-private-feedback"')
        with self.assertRaises(AssertionError):
            verify(self.root)

    def test_route_rejected(self):
        with (self.root / "wrangler.toml").open("a") as file:
            file.write('\nroutes = []\n')
        with self.assertRaises(AssertionError):
            verify(self.root)


if __name__ == "__main__":
    unittest.main()
