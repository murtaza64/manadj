# Exact disabled sync config candidate, November 25, 2026 09:24 PST

NOT APPROVED FOR DEPLOYMENT. This is an offline configuration review file. Place wrangler.disabled.proposed.json in cloud/library/sync-review/ on the clean v4 candidate. main resolves to ../worker.mjs. Do not use this reviewer's rolling mixed audio checkout as a release source.

Read-only source of current settings:
https://dash.cloudflare.com/a4f837dfdb11165a1c1cbbf676db0684/workers/services/view/manadj-private-library/production/settings

Live settings verified: snapshot false; exact library origin, Access issuer and AUD as in the proposed file; OWNER_EMAIL encrypted secret present; no connected bindings; compatibility date 2026-11-01; logs, traces and issues switches off; no cron triggers or queue consumers. Live active deployment observed minutes earlier remains d26f873a, 100%. No live lifecycle classes/bindings for this Worker appear in account DO listing, only COBIS-owned classes elsewhere.

Preserved: name/account, snapshot false, current owner-auth configuration, encrypted OWNER_EMAIL secret requirement, compatibility date, disabled observability. No routes, schedules, Access policy change, R2 binding, AUDIO_ENABLED, AUDIO_POLICY, bucket creation or audio activation. Existing repo wrangler.toml is unsafe as a live baseline because it enables snapshots and R2; it was NOT used.

Proposed lifecycle effects: add SyncGroup SQLite namespace using installed Wrangler's declarative exports syntax; add only SYNC_GROUPS binding; add SYNC_ENABLED=false. This is a new irreversible lifecycle barrier for version rollback, not a routine code change. No SYNC_GROUP or SYNC_BOOTSTRAP values yet: disabled routing never obtains the DO stub and does not need them. Thus the disabled baseline creates the namespace/binding but no generated group object or key registry. Enabling later requires exact reviewed generated group and public-key/owner-subject bootstrap, the actual service-check code, and a separate code/config version. No private seed belongs in Worker config.

Offline validation actually run with Wrangler 4.166.0:

    node node_modules/wrangler/bin/wrangler.js deploy --dry-run --config sync-review/wrangler.disabled.proposed.json --outdir /downloads/sync-disabled-dry-run

PASS. Output: 95.25KiB uncompressed/26.17KiB gzip. Listed only SYNC_GROUPS plus preserved auth/origin/snapshot vars and sync false. No R2/COBIS binding. This proves parser/bundle compatibility only, not remote token permission, namespace creation success, edge authentication or deployment safety. No remote request, token grant expansion or deployment was performed by that command.

Do not promise rollback to d26f873a across class creation. After approved creation, verify and record the NEW disabled baseline/version, then enable separately. Revert only to that post-lifecycle baseline or deploy a forward disabled fix. Unbind does not delete storage. Permanent cleanup must target only this newly recorded namespace/class, remove its class export/binding and declare its exact deleted lifecycle state, with explicit destructive authorization and absence verification. No COBIS namespace or R2 bucket is a cleanup target.

Source caveat: v4 packet is based on d4c48cd9 and deliberately excludes previous held audio-branch additions. Clean candidate must preserve current live functionality and must not silently import those held audio features. Canonicalization is local reviewed code with cross-language tests, not independently audited. The bounded generated-only service check and actual native Managed OAuth remain unexecuted. Real app/iOS sync and remote session replay remain separate incomplete work.
