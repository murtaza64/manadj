"""No native execution or microphone access. Tests dedicated bundle layout."""
import importlib.util
from pathlib import Path
import plistlib
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[1] / 'scripts/release/local_speech_bundle.py'
spec = importlib.util.spec_from_file_location('local_speech_bundle', MODULE)
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class LocalSpeechBundle(unittest.TestCase):
    def test_dedicated_identity_purpose_strings_and_signing_order(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            commands = []
            result = bundle.build_local_speech(root, root / 'Resources', '1.2.3',
                run=lambda args, **kwargs: commands.append(args))
            with (result / 'Contents/Info.plist').open('rb') as stream:
                plist = plistlib.load(stream)
            self.assertEqual(plist['CFBundleIdentifier'], 'com.murtaza64.manadj.local-speech')
            self.assertEqual(plist['CFBundleVersion'], '1.2.3')
            self.assertIn('not uploaded', plist['NSSpeechRecognitionUsageDescription'])
            self.assertIn('not saved or uploaded', plist['NSMicrophoneUsageDescription'])
            self.assertEqual(commands[0][:2], ['xcrun', 'swiftc'])
            self.assertEqual(commands[1][:2], ['codesign', '--force'])
            self.assertEqual(commands[2][:3], ['codesign', '--verify', '--strict'])
            self.assertTrue(all('--start' not in args for args in commands))
