# Canonical Android update contract — #419

Port: now (Android #419; desktop #418 reuses #420 identity, not an Android blocker).

## Source of truth

- Types: `scripts/release/android_channel_contract.py`.
- Versioned generated schema: `scripts/release/android-update-v1.schema.json` (`$defs.Channel` is the native feed, not the tooling `document` wrapper).
- Native parser vector: `tests/fixtures/android-channel-v1.sample.json`. **Synthetic fixture, no corresponding APK or offered release. Never publish it.**
- Build/archive verifier: integrator-owned `scripts/release/android_release.py` at qualified correction `f6987af528efb69d5ac35e21312481bf1d2c146d`; old `9c4588a7` HOLD remains historical.
- Shared identity: reuse `backend.release_notes.identity` and `scripts.release.metadata` from #420 `ce63b1b3` source composition. No parallel release-ID formula. Its landing is not assumed.

## Identity and trust

- Stable package: `dev.murt.manadj.excalibur`.
- Pinned APK signing certificate SHA256: `18f8fe820d6abd112be1fa5c99e3c69f77cbb5c834242899135c9b528af7417c`.
- Channels: explicit `stable` or `preview`; channel URL exactly `https://manadj.murtaza.earth/android/<channel>/channel.json`.
- **Topology decision v1:** feed and APK use that same HTTPS origin, default/443 port only, **no redirects**. APK path exactly `/android/artifacts/<release_id>/<apk_sha256>.apk`. GitHub Releases may be upstream custody/context, but direct GitHub/CDN/latest URLs are not v1 client offers. No DNS/domain change.
- Feed has **no new signing key/signature**. HTTPS delivers an offer, not installed/applied authority. Client validates exact channel/package/cert/applicability, streamed SHA/size and actual archive package/versionCode/signing certificate before installation. APK signing is separate from feed metadata trust.
- No credentials, query/fragment, lookalike host, traversal or alternate port. Offline/malformed/rollback feed never becomes an update or applied identity.

## Assets and wire

APK assets `assets/manadj-release/` contain:

1. `build-info.json` and `release-notes.json`: #420 schema1 **verbatim**. Notes hash is exact UTF-8 body, no implicit newline/trim/normalization. Release ID hashes sorted compact four-field JSON (`schema`, `version`, `source_revision`, `notes_sha256`).
2. `android-build.json`: `AndroidBuild` / `manadj_android_build/v1`, binding that release to package, versionCode/versionName, full40 source revision, exact source-tree digest, UUID build batch, notes SHA, min/target SDK and ordered ABI set. This third file does not extend or change either schema1 object. It prevents post-build batch/provenance relabeling.

Feed root retains native proposed names exactly: `{format:"manadj_android_channel/v1",channel,package,signer_cert_sha256,entries}`.

Entry retains the existing ten fields (`release_id`, `version_code`, `version_name`, `min_sdk`, `abis`, `source_revision`, `notes_sha256`, `apk_url`, `apk_sha256`, `apk_bytes`) and requires three provenance additions: `source_tree_sha256`, `build_batch_id`, `qa_receipt_sha256s`. No per-entry format/package rename. Entries/codes and ABI/QA lists are unique and ordered. Highest applicable code wins, never GitHub latest.

## Producer/signer boundary

- `Candidate` is unsigned/candidate truth only: exact embedded triple, actual unsigned APK SHA/bytes, cryptographic non-signature entry digest, verifier-receipt SHA and bound source/unsigned QA receipts. No installed/applied/published/offered claim.
- `SignRequest` is the canonical protected adapter input. Adapter receives a local candidate bundle plus unsigned bytes, checks candidate hash/build/unsigned hash/size/content digest and expected pinned cert before invoking its protected signer. No key path, secret, password, keystore or CI upload is part of the contract.
- Rook's executor may consume integrator `manadj_android_release/v1` verification receipts; these are **not the feed**. Protected signing returns signed bytes and actual `verify-signed` receipt. Core's key-free acceptance step crosschecks these and creates `SignReceipt`; a JSON assertion alone is not an APK certificate verification.
- Cryptographic content digest uses qualified f698 code: actual SHA256 of each decompressed ZIP payload, duplicate names refused; aggregate SHA256 of sorted `name + NUL + payload_sha256 + newline` records, excluding only signature entries. CRC32/size is not content identity.
- QA receipts bind full source, tree, batch, release and exact unsigned/signed artifact as appropriate; a receipt ID/hash is provenance, not a remote authority boolean. Trusted local promotion must validate the actual receipt files/tool outputs, not accept arbitrary network evidence.
- VersionCode is strictly increasing across the package's release sequence, including preview/stable. Source-pinned versionCode and embedded versionName must match verifier/source records. Existing unstamped code7 is context only and **not offerable** by this producer, even if its APK certificate verifies.

## States and publication order

- source-tested ≠ candidate-built ≠ signed/verified ≠ eligible ≠ published ≠ offered ≠ installed ≠ applied.
- Published: immutable signed artifact is served/read back with exact SHA/bytes. Offered: complete channel feed then atomically replaced/read back. Producer-generated local JSON alone proves neither state.
- Install: PackageManager confirms package/versionCode/actual signing cert. Apply: the running process reads its embedded triple and checks actual installed package/versionName/versionCode/cert against it and the selected identity. Offered notes or a self-consistent but wrong embedded version are not applied notes.
- Notes popup/seen receipt derive only from verified applied embedded assets. Seen receipt is exact schema1/release ID content, not file existence. Dev/legacy missing/inconsistent metadata exposes no applied release.
- No publication, build, signing job, PackageInstaller action, key handling, Pages workflow or phone effect is authorized by this source contract.
