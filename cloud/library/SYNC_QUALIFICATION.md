# Disabled sync integration candidate

No deployed config changes. Existing wrangler.toml is deliberately untouched.
The production entry exports SyncGroup and routes /v1/sync/ before the legacy
snapshot flag/query gate. Sync requires its own exact SYNC_ENABLED=true flag,
fixed group, owner assertion, bootstrap public keys and dedicated binding.
No fixture file is imported by the production entry. No admin/enrollment URL,
service secret, private device key, R2 change or COBIS binding is introduced.

Local validation:
- 19 focused Python tests; broader 126-test session/group/cloud run before the
  extra one-packet-prefix regression. Re-run combined suites before publication.
- 63 Electron cloud tests.
- 64 existing Worker tests.
- 3 integrated workerd/entry tests, including Python RFC8785 signed unicode,
  numeric-looking keys and float vectors through actual SQLite storage.
- Independent hosting reference's JWT, race/revoke, quotas, parallel exact retry,
  fork and restart test now imports sync.mjs, not a second implementation.

Canonicalization remains the reviewed local implementation, NOT an audited
third-party RFC8785 dependency. Cross-language vectors are necessary but not a
complete audit. Production qualification must settle that requirement.
The 64-operation/1MiB/256-request-day limits are generated-check caps, not a
usable continuous library capacity. Fail-on-limit, no destructive pruning.

Before any live setup:
1. Re-read actual service configuration and preserve current unrelated lifecycle
   state. Use installed Wrangler dry-run to validate the eventual exact config.
2. Obtain explicit approval for the named class/namespace creation and dedicated
   binding, fixed generated group/keys, bounded check and storage retention.
3. Creation is a lifecycle change, not an ordinary reversible code deployment.
   Create and verify a NEW disabled baseline retaining class/binding first;
   only a separate enable version follows. Roll back only to that post-creation
   disabled baseline, not an earlier version without the class.
4. Disabling/unbinding does not delete data. Any exact namespace/state deletion
   requires separately grounded authority and supported provider lifecycle steps.
5. Actual desktop Managed OAuth DCR/PKCE, Bearer-to-assertion edge forwarding,
   refresh/cancel and independent nonowner denial remain untested. Existing
   desktop callback is configured per hosting read-only review, not proof of
   execution. No iOS callback is configured; do not invent or broaden one.
6. Measure new Worker/DO CPU and operation/row/byte usage. Old disabled-service
   metrics cannot qualify Ed25519/transaction cost.

Received session replay remains blocked pending verified assets and bindings.
No actual app-owned cross-device UI/session convergence is delivered yet.
