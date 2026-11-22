"""Synthetic configuration regressions, no provider calls or credentials."""
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from check_config import verify


class DisabledDeployment(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="manadj-library-config-")
        self.root = Path(self.temp.name)
        source = Path(__file__).resolve().parent
        for name in ("wrangler.toml", "package.json", "package-lock.json"):
            shutil.copyfile(source / name, self.root / name)

    def tearDown(self):
        self.temp.cleanup()

    def test_reviewed_disabled_target(self):
        verify(self.root)

    def test_enabled_uploads_rejected(self):
        self.replace('SNAPSHOTS_ENABLED = "false"', 'SNAPSHOTS_ENABLED = "true"')
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

    def test_binding_rejected(self):
        with (self.root / "wrangler.toml").open("a") as file:
            file.write('\n[[r2_buckets]]\nbinding = "LIBRARY_BUCKET"\nbucket_name = "synthetic"\n')
        with self.assertRaises(AssertionError):
            verify(self.root)

    def test_owner_identity_must_not_be_committed(self):
        self.replace('SNAPSHOTS_ENABLED = "false"', 'OWNER_EMAIL = "owner@example.test"\nSNAPSHOTS_ENABLED = "false"')
        with self.assertRaises(AssertionError):
            verify(self.root)

    def test_observability_not_enabled(self):
        self.replace("enabled = false", "enabled = true")
        with self.assertRaises(AssertionError):
            verify(self.root)

    def test_target_audience_pinned(self):
        self.replace("4477365ee11d6199eef6bb54ab6e92622fe56ec039bc7d61ea05ef6b1b857b8f", "a" * 64)
        with self.assertRaises(AssertionError):
            verify(self.root)

    def test_deploy_script_not_replaceable(self):
        path = self.root / "package.json"
        value = json.loads(path.read_text())
        value["scripts"]["deploy"] = "echo no"
        path.write_text(json.dumps(value))
        with self.assertRaises(AssertionError):
            verify(self.root)

    def replace(self, old, new):
        path = self.root / "wrangler.toml"
        value = path.read_text()
        assert old in value
        path.write_text(value.replace(old, new))


if __name__ == "__main__":
    unittest.main()
