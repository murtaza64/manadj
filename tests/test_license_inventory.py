"""Portable checks for the source inventory and release notice copy, no app DB."""
import importlib.util
import json
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts/release" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_sbom_matches_frozen_release_inputs():
    generator = load_script("generate_sbom")
    export = subprocess.run(generator.EXPORT_ARGS, cwd=ROOT, check=True, capture_output=True, text=True).stdout
    assert generator.build_sbom(ROOT, export) == json.loads((ROOT / "sbom.cdx.json").read_text())
    assert "essentia" not in {name for name, _ in generator.requirement_identities(export)}
    with pytest.raises(ValueError, match="export changed"):
        generator.build_sbom(ROOT, export.replace("sys_platform", "changed_platform", 1))


def test_python_versions_and_environment_alternatives_are_not_lost():
    generator = load_script("generate_sbom")
    text = "torch==2.9.1 ; sys_platform == 'darwin'\ntorch==2.9.1+cpu ; sys_platform == 'linux'\n"
    assert generator.requirement_identities(text) == {("torch", "2.9.1"), ("torch", "2.9.1+cpu")}
    sbom = json.loads((ROOT / "sbom.cdx.json").read_text())
    assert {c["version"] for c in sbom["components"] if c["name"] == "torch"} == {"2.9.1", "2.9.1+cpu"}
    assert all(any(p["name"] == "manadj:environment-marker" for p in c["properties"])
               for c in sbom["components"] if c["name"] == "torch")


def test_reviewed_license_corrections_and_unknowns_are_retained():
    components = json.loads((ROOT / "sbom.cdx.json").read_text())["components"]
    by_name = {c["name"]: c for c in components}
    assert by_name["cffi"]["licenses"] == [{"expression": "MIT"}]
    assert by_name["filelock"]["licenses"] == [{"expression": "Unlicense"}]
    assert by_name["madmom"]["licenses"] == [{"expression": "BSD-2-Clause AND CC-BY-NC-SA-4.0"}]
    assert by_name["torchaudio"]["licenses"] == [{"expression": "BSD-2-Clause"}]
    assert by_name["ubuntu-mono"]["licenses"] == [{"expression": "Ubuntu-font-1.0"}]
    older = next(c for c in components if c["name"] == "demucs" and c["version"] == "4.0.1")
    assert "licenses" not in older
    assert len({c["bom-ref"] for c in components}) == len(components)


def test_exact_npm_locks_and_app_version():
    import tomllib
    components = json.loads((ROOT / "sbom.cdx.json").read_text())
    assert components["metadata"]["component"]["version"] == tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["version"]
    by_name = {c["name"]: c for c in components["components"]}
    for name in ("react", "react-dom", "@tanstack/react-query", "html-to-image", "scheduler", "@tanstack/query-core"):
        lock = json.loads((ROOT / "frontend/package-lock.json").read_text())
        assert by_name[name]["version"] == lock["packages"][f"node_modules/{name}"]["version"]


def test_both_release_platforms_copy_inventory_and_retained_texts(tmp_path):
    release = load_script("build_dmg")
    release.copy_license_inventory(tmp_path)
    mirror = tmp_path / "licenses"
    for name in ("LICENSE", "THIRD-PARTY-NOTICES.md", "sbom.cdx.json"):
        assert (mirror / name).read_bytes() == (ROOT / name).read_bytes()
    evidence = json.loads((ROOT / "licenses/inventory-evidence.json").read_text())
    for record in evidence["components"]:
        for path in record["license_files"]:
            assert (mirror / path).read_bytes() == (ROOT / path).read_bytes()
    windows_source = (ROOT / "scripts/release/build_windows.py").read_text()
    assert "copy_license_inventory(resources)" in windows_source


def test_release_export_excludes_harness_without_building(tmp_path, monkeypatch):
    release = load_script("build_dmg")
    calls = []
    def fake_run(args, **kwargs):
        calls.append(args)
        Path(args[-1]).write_text("alembic==1.18.5\n")
    monkeypatch.setattr(release, "BUILD", tmp_path)
    monkeypatch.setattr(release, "run", fake_run)
    assert release.export_requirements().read_text() == "alembic==1.18.5\n"
    args = calls[0]
    assert args[args.index("--no-group") + 1] == "harness"
    assert "--frozen" in args and "--no-dev" in args
    assert args[args.index("--group") + 1] == "stems"


def test_marker_factoring_is_stable_but_changes_are_rejected():
    generator = load_script('generate_sbom')
    a = "torchaudio==2.9.1+cpu ; (python_full_version >= '3.15' and sys_platform == 'linux') or (platform_machine != 'aarch64' and sys_platform == 'linux') or (platform_python_implementation != 'CPython' and sys_platform == 'linux')\n"
    b = "torchaudio==2.9.1+cpu ; (python_full_version >= '3.15' or platform_machine != 'aarch64' or platform_python_implementation != 'CPython') and sys_platform == 'linux'\n"
    assert generator.canonical_requirement_lines(a) == generator.canonical_requirement_lines(b)
    assert generator.canonical_requirement_lines(a) != generator.canonical_requirement_lines(b.replace('3.15', '3.14'))
    assert generator.canonical_requirement_lines(a) != generator.canonical_requirement_lines(b.replace("sys_platform == 'linux'", "sys_platform == 'darwin'"))
    assert generator.canonical_requirement_lines(a) != generator.canonical_requirement_lines(b.replace(' or ', ' and ', 1))
    with pytest.raises(ValueError, match='Unsupported'):
        generator.canonical_requirement_lines("test==1 ; some_function()\n")
