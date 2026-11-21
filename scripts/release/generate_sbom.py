#!/usr/bin/env python3
"""Rebuild the scoped source SBOM from frozen release inputs and retained evidence.

Run with Python 3.13+: python scripts/release/generate_sbom.py [--check]
This is a source inventory, not an installed-artifact or legal compliance audit.
No packages or application databases are installed or opened by this script.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tomllib
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]
EXPORT_ARGS = [
    "uv", "export", "--frozen", "--no-dev", "--no-group", "harness", "--group", "stems",
    "--no-emit-project", "--no-hashes",
]


def canonical_requirement_lines(text: str) -> list[str]:
    """Canonicalize marker Boolean factoring, preserving every comparison.

    uv versions may distribute A and (B or C) as (A and B) or (A and C).
    Sorted disjunctive normal form treats those as equal without dropping or
    evaluating any environment condition. Unknown syntax fails closed.
    """
    def terms(node):
        if isinstance(node, ast.BoolOp):
            children = [terms(child) for child in node.values]
            if isinstance(node.op, ast.Or):
                return set().union(*children)
            if isinstance(node.op, ast.And):
                result = {frozenset()}
                for child in children:
                    result = {left | right for left in result for right in child}
                return result
        if isinstance(node, ast.Compare) and len(node.ops) == len(node.comparators) == 1:
            if not isinstance(node.left, (ast.Name, ast.Constant)) or not isinstance(node.comparators[0], (ast.Name, ast.Constant)):
                raise ValueError("Unsupported marker operand")
            if not isinstance(node.ops[0], (ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.In, ast.NotIn)):
                raise ValueError("Unsupported marker comparison")
            return {frozenset({ast.dump(node, annotate_fields=True)})}
        raise ValueError("Unsupported environment marker syntax")

    lines = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        requirement, separator, marker = line.partition(" ; ")
        if separator:
            normalized = sorted(sorted(term) for term in terms(ast.parse(marker, mode="eval").body))
            line = requirement + " ; " + json.dumps(normalized)
        lines.append(line)
    return sorted(lines)


def requirement_identities(text: str) -> set[tuple[str, str]]:
    """Keep every version selected by any exported environment marker."""
    result = set()
    for line in text.splitlines():
        match = re.match(r"([\w.-]+)(?:==([^ ;]+)| @ (\S+))(?: ; .*)?$", line)
        if match:
            name, version, source = match.groups()
            result.add((name, version or source.rsplit("@", 1)[-1]))
        elif line.strip() and not line.lstrip().startswith("#"):
            raise ValueError(f"Unsupported export line: {line}")
    return result


def build_sbom(root: Path, requirements: str) -> dict:
    evidence = json.loads((root / "licenses/inventory-evidence.json").read_text())
    records = evidence["components"]
    lines = canonical_requirement_lines(requirements)
    if hashlib.sha256("\n".join(lines).encode()).hexdigest() != evidence["export_lines_sha256"]:
        raise ValueError("Frozen export changed, including environment markers; review evidence again")
    actual = requirement_identities(requirements)
    covered = {(r["name"], r["version"]) for r in records if r["ecosystem"] in ("pypi", "github")}
    if actual != covered:
        raise ValueError(f"Python inventory drift: new={actual - covered}, stale={covered - actual}")
    expected_npm = {}
    for project in ("frontend", "desktop"):
        lock = json.loads((root / project / "package-lock.json").read_text())
        for key, item in lock["packages"].items():
            if not key or (project == "frontend" and item.get("dev", False)):
                continue
            name = key.split("node_modules/")[-1]
            if project == "desktop" and name != "electron":
                continue
            expected_npm[name] = item["version"]
    covered_npm = {r["name"]: r["version"] for r in records if r["ecosystem"] == "npm"}
    if expected_npm != covered_npm:
        raise ValueError("npm lock inventory drift; update and review license evidence")
    components = []
    for record in records:
        name, version, ecosystem = record["name"], record["version"], record["ecosystem"]
        for path, digest in record.get("license_hashes", {}).items():
            if hashlib.sha256((root / path).read_bytes()).hexdigest() != digest:
                raise ValueError(f"Retained license text changed: {path}")
        component = {"type": "library", "name": name}
        if version:
            component["version"] = version
        ref = f"{ecosystem}:{name}@{version or 'unversioned'}"
        component["bom-ref"] = ref
        if ecosystem == "pypi":
            component["purl"] = f"pkg:pypi/{name}@{quote(version, safe='')}"
        elif ecosystem == "npm":
            component["purl"] = f"pkg:npm/{quote(name, safe='/')}@{version}"
        elif ecosystem == "github":
            component["purl"] = f"pkg:github/{record['repository']}@{version}"
        elif ecosystem == "maven":
            component["purl"] = f"pkg:maven/com.google.oboe/oboe@{version}"
        if record.get("license"):
            component["licenses"] = [{"expression": record["license"]}]
        props = {
            "manadj:evidence-level": record["license_evidence"],
            "manadj:source": record["source_url"],
            "manadj:license-files": json.dumps(record.get("license_files", [])),
            "manadj:license-text-sha256": json.dumps(record.get("license_hashes", {}), sort_keys=True),
        }
        if record.get("marker"):
            props["manadj:environment-marker"] = record["marker"]
        if record.get("upstream_license_url"):
            props["manadj:upstream-license-url"] = record["upstream_license_url"]
        if record.get("archive_url"):
            props["manadj:license-archive"] = record["archive_url"]
            props["manadj:license-archive-sha256"] = record["archive_sha256"]
        if not record.get("license"):
            props["manadj:unresolved"] = "No SPDX classification established for this exact version"
        component["properties"] = [{"name": k, "value": v} for k, v in sorted(props.items())]
        if record["source_url"].startswith("https://"):
            component["externalReferences"] = [{"type": "evidence", "url": record["source_url"]}]
        components.append(component)
    version = tomllib.loads((root / "pyproject.toml").read_text())["project"]["version"]
    return {
        "bomFormat": "CycloneDX", "specVersion": "1.6", "version": 1,
        "metadata": {
            "timestamp": evidence["review_date"] + "T00:00:00Z",
            "component": {
                "type": "application", "name": "manaDJ", "version": version,
                "description": "Scoped source inventory, not a built artifact or release clearance. "
                "Universal frozen Python release export excluding dev/harness, frontend runtime lock tree, "
                "Electron lock version and selected Android vendored DSP/font/Oboe. "
                "Platform variants are alternatives, not necessarily installed together. "
                "Native wheel payloads, ffmpeg, Python runtime, Chromium, model weights, full Android/iOS "
                "dependency trees and other assets remain incomplete or unaudited. MIT applies only to "
                "manaDJ code the licensor has the right to license; third-party rights remain separate.",
            },
            "properties": [
                {"name": "manadj:base-commit", "value": evidence["base_commit"]},
                {"name": "manadj:scope", "value": "Partial source inventory; not installed binary SBOM"},
            ],
        },
        "components": sorted(components, key=lambda c: c["bom-ref"]),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    text = subprocess.run(EXPORT_ARGS, cwd=ROOT, check=True, capture_output=True, text=True).stdout
    output = json.dumps(build_sbom(ROOT, text), indent=2, ensure_ascii=False) + "\n"
    target = ROOT / "sbom.cdx.json"
    if args.check:
        if target.read_text() != output:
            raise SystemExit("SBOM differs; regenerate and review")
        print("SBOM matches frozen inputs and retained evidence")
    else:
        target.write_text(output)
        print(f"Wrote {target.name}")


if __name__ == "__main__":
    main()
