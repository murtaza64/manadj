// Unit tests must explicitly stub network calls, never contact a running library.
globalThis.fetch = async () => {
  throw new Error('Network is disabled in unit tests. Stub fetch at the test boundary.');
};
