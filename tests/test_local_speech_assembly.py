"""Exercise the real assembly entry point without downloads, launching or capture."""
import importlib.util
import json
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('speech_assembly_dmg', ROOT / 'scripts/release/build_dmg.py')
dmg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dmg)


class LocalSpeechAssembly(unittest.TestCase):
    def exercise(self, native=False):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / 'source'
            desktop = source / 'desktop'
            desktop.mkdir(parents=True)
            for name in dmg.SHELL_FILES:
                shutil.copy2(ROOT / 'desktop' / name, desktop / name)
            shutil.copy2(ROOT / 'desktop/local-speech.swift', desktop / 'local-speech.swift')
            dist = source / 'frontend/dist'
            dist.mkdir(parents=True)
            (dist / 'index.html').write_text('<title>Packaging fixture, never launched</title>')
            (source / 'logo.png').write_bytes(b'fixture')
            icon = base / 'manaDJ.icns'
            icon.write_bytes(b'fixture')
            for name in ('python', 'ffmpeg'):
                (base / name).mkdir()
            electron = base / 'Electron.app/Contents'
            (electron / 'MacOS').mkdir(parents=True)
            (electron / 'Resources').mkdir()
            if native:
                # Do not copy system immutable flags from Apple's protected binary.
                shutil.copy('/bin/echo', electron / 'MacOS/Electron')
            else:
                (electron / 'MacOS/Electron').write_text('never executed')
            with (electron / 'Info.plist').open('wb') as stream:
                plistlib.dump({'CFBundlePackageType': 'APPL', 'CFBundleIdentifier': 'test.fixture',
                              'CFBundleExecutable': 'Electron'}, stream)
            commands = []

            def run(args, **kwargs):
                args = [str(value) for value in args]
                commands.append(args)
                self.assertNotIn('--start', args)
                self.assertNotIn('--probe', args)
                if native:
                    kwargs.setdefault("check", True)
                    return subprocess.run(args, **kwargs)
                if args[0] == 'ditto':
                    shutil.copytree(args[1], args[2])
                elif args[:2] == ['xcrun', 'swiftc']:
                    Path(args[-1]).write_text('never executed')

            with patch.multiple(dmg, ROOT=source, BUILD=base / 'build', BACKEND_DIRS=[], BACKEND_FILES=[]), \
                 patch.object(dmg, 'electron_dist', return_value=electron.parent), \
                 patch.object(dmg, 'copy_license_inventory'), patch.object(dmg, 'copy_cloud_runtime'), \
                 patch.object(dmg, 'run', side_effect=run):
                app = dmg.assemble_app(base / 'python', base / 'ffmpeg', icon, '1.2.3')
            helper = app / 'Contents/Resources/manaDJ Speak.app'
            executable = helper / 'Contents/MacOS/manaDJ Speak'
            self.assertTrue(executable.is_file())
            info = plistlib.loads((helper / 'Contents/Info.plist').read_bytes())
            self.assertEqual(info['CFBundleIdentifier'], 'com.murtaza64.manadj.local-speech')
            self.assertIn('NSSpeechRecognitionUsageDescription', info)
            self.assertIn('NSMicrophoneUsageDescription', info)
            self.assertIn('enabled: false', (app / 'Contents/Resources/app/local-speech-target.js').read_text())
            self.assertEqual(json.loads((app / 'Contents/Resources/app/package.json').read_text())['version'], '1.2.3')
            child_sign = commands.index(['codesign', '--force', '--sign', '-', str(helper)])
            parent_sign = commands.index(['codesign', '--force', '--deep', '--sign', '-', str(app)])
            self.assertLess(child_sign, parent_sign)
            self.assertEqual(commands[-1], ['codesign', '--verify', '--deep', '--strict', str(app)])

    def test_assembly_path_order_and_off_target_without_native_execution(self):
        self.exercise()

    @unittest.skipUnless(sys.platform == 'darwin', 'Actual Swift/codesign fixture requires macOS CI')
    def test_native_nested_and_outer_signatures_without_launching(self):
        self.exercise(native=True)
