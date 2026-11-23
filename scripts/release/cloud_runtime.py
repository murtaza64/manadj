"""Copy the closed native cloud transport and pure reviewed DTO vocabulary.

Shared by macOS/Windows assemblers. No credentials, worker auth implementation,
node_modules, deployment configuration, tests or user data enter the app bundle.
"""
from pathlib import Path
import shutil

SCHEMA_FILES = ("fields.json", "part.mjs", "schema.mjs")

def copy_cloud_runtime(root: Path, resources: Path):
    shell = resources / "app" / "cloud"
    shell.mkdir(parents=True, exist_ok=True)
    for source in sorted((root / "desktop" / "cloud").glob("*.js")):
        if source.name.endswith(".test.js"):
            continue
        shutil.copy2(source, shell / source.name)
    # Native import keeps its repo-relative layout. Backend fields.json lookup
    # keeps its own repo-shaped resource root. Only pure DTO files are copied.
    for base in (resources, resources / "backend"):
        dest = base / "cloud" / "library"
        dest.mkdir(parents=True, exist_ok=True)
        for name in SCHEMA_FILES:
            shutil.copy2(root / "cloud" / "library" / name, dest / name)
