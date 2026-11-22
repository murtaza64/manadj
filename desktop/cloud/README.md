# Desktop cloud primitives, local preparation only

This directory is not wired to desktop/main.js, preload, settings or a network transport.
There is no enabled production configuration, registered native client or token
in this source. The separate protected library origin/managed OAuth configuration
has been provisioned, but none of these primitives has completed real sign-in.

Run `node --test desktop/cloud/*.test.js` from the repository root.
19 local tests currently pass. No OS Keychain, Electron runtime, real Access
sign-in, R2 upload, receipt or download has been tested.

- policy.js: disabled-by-default configuration, pinned Access discovery,
  random-state/S256 attempt, exact one-shot expiring callback and intended-frame IPC gate.
- loopback.js: explicit-call exact-port receiver, bind before browser, static callback response, timeout/cancel cleanup and occupied-port rejection.
- tokenStore.js: main-only adapter for Electron37 safeStorage, encrypted refresh
  state bound to the target audience, atomic0600replacement and no Linux
  basic_text/unknown/unavailable fallback. Mocks do not establish OS encryption.
- policy.test.js: synthetic policy/storage tests using temporary fixtures only.

Exact callback aligned with the separately verified cloud provisioning:
http://127.0.0.1:53682/oauth/library/callback. Saved Access configuration is verified;
native owner/non-owner sign-in is not. Bind before launching the browser; fail if occupied.
No port fallback, broad loopback registration or browser token exposure.

Pending work: native dynamic client registration/exchange/refresh,
managed-backend shell-token-gated frozen exporter, reviewed Upload UI, bounded
part transport/immutable receipt, owner-authenticated readback, cancellation/
refresh generation guards, real-platform tests and the complete end-to-end gates.

Do not persist credentials in generic settings, renderer storage or .env.
The synchronous safeStorage adapter targets the repo's Electron37. Revisit the
adapter before a runtime upgrade; current upstream docs mark synchronous APIs
for removal in Electron46. macOS build signing and Keychain prompts still need
real-device verification. Windows OS encryption does not isolate this app from
other programs running as the same OS user.

These primitives do not themselves change cloud resources, install or release.
The separate disabled server preparation is in cloud/library. Native app wiring
and a real end-to-end gate remain unimplemented.
