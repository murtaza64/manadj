"""Minimal bundle assembly, no Electron download/build or user data."""
from pathlib import Path
import json
import subprocess
from scripts.release.cloud_runtime import copy_cloud_runtime, SCHEMA_FILES
ROOT = Path(__file__).resolve().parents[1]
def test_both_native_and_backend_paths_receive_only_pure_schema(tmp_path):
    copy_cloud_runtime(ROOT, tmp_path)
    shell = tmp_path / 'app' / 'cloud'
    assert (shell / 'ipc.js').is_file()
    assert not list(shell.glob('*.test.js'))
    for base in (tmp_path, tmp_path / 'backend'):
        assert {p.name for p in (base / 'cloud' / 'library').iterdir()} == set(SCHEMA_FILES)
    script = "const {ReviewedUpload}=require(process.argv[1]); import(process.argv[2]).then(m=>{m.validatePart({schema:'manadj-library-snapshot/v1',table:'tracks',rows:[{id:1,title:'Synthetic'}]}); console.log(typeof ReviewedUpload)})"
    result = subprocess.run(['node', '-e', script, str(shell / 'upload.js'),
        (tmp_path / 'cloud/library/part.mjs').as_uri()], capture_output=True, text=True, check=True)
    assert result.stdout.strip() == 'function'
    assert json.loads((tmp_path / 'backend/cloud/library/fields.json').read_text())
