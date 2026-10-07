import { setPlatformOverride } from '../utils/platform';

// Unit tests must explicitly stub network calls, never contact a running library.
globalThis.fetch = async () => {
  throw new Error('Network is disabled in unit tests. Stub fetch at the test boundary.');
};

// Keyboard chords/labels default to macOS; tests opt into other platforms.
setPlatformOverride('mac');
