"""Fail-closed check for the reviewed enabled library deployment. No network.

This is the counterpart of check_config.py for the separately reviewed
enablement change: snapshots enabled, the intended private bucket bound as
LIBRARY_BUCKET, and nothing else different from the disabled deployment.
"""
import json
from pathlib import Path
import tomllib


def verify(root: Path) -> None:
    with (root / "wrangler.toml").open("rb") as file:
        config = tomllib.load(file)
    assert set(config) == {
        "name", "main", "compatibility_date", "keep_vars", "preview_urls", "vars", "observability", "r2_buckets"
    }, "Unexpected deployment configuration, bindings or routes"
    assert config["name"] == "manadj-private-library"
    assert config["main"] == "worker.mjs"
    assert config["compatibility_date"] == "2026-11-01"
    assert config["keep_vars"] is True
    assert config["preview_urls"] is False
    assert config["observability"] == {"enabled": False}
    assert config["vars"] == {
        "SNAPSHOTS_ENABLED": "true",
        "LIBRARY_ORIGIN": "https://manadj-private-library.murtaza-javaid.workers.dev",
        "ACCESS_ISSUER": "https://frosty-pond-8fd5.cloudflareaccess.com",
        "ACCESS_AUD": "4477365ee11d6199eef6bb54ab6e92622fe56ec039bc7d61ea05ef6b1b857b8f",
    }
    assert config["r2_buckets"] == [{"binding": "LIBRARY_BUCKET", "bucket_name": "manadj-library-data"}], \
        "Only the intended private bucket may be bound, as LIBRARY_BUCKET"
    package = json.loads((root / "package.json").read_text())
    assert package["private"] is True
    assert package["type"] == "module"
    assert package["scripts"] == {"test": "node --test", "deploy": "wrangler deploy"}
    assert package["devDependencies"] == {"wrangler": "4.166.0"}
    assert package["dependencies"] == {"jose": "^6.1.0"}
    lock = json.loads((root / "package-lock.json").read_text())
    assert lock["packages"]["node_modules/wrangler"]["version"] == "4.166.0"
    assert lock["packages"]["node_modules/jose"]["version"] == "6.2.18"


if __name__ == "__main__":
    verify(Path(__file__).resolve().parent)
    print("Verified enabled library target, LIBRARY_BUCKET bound to manadj-library-data only, locked toolchain")
