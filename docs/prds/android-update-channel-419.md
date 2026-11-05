# Canonical Android update contract — #419

Port: now (Android #419; desktop #418 reuses #420 identity, not an Android blocker).

## Source of truth

- Types: `scripts/release/android_channel_contract.py`.
- Versioned generated schema: `scripts/release/android-update-v1.schema.json` (`$defs.Channel` is the native feed, not the tooling `document` wrapper).
- Native parser vector: `tests/fixtures/android-channel-v1.sample.json`. **Synthetic fixture, no corresponding APK or offered release. Never publish it.**
- Build/archive verifier: integrator-owned `scripts/release/android_release.py`; source composition includes `fcc571d0c607a91c677f0bfc51796389e822f628` triple hooks (separate qualification), extending qualified payload-digest correction `f6987af528efb69d5ac35e21312481bf1d2c146d`. Old `9c4588a7` HOLD remains historical. Producer `stamp` and embedded reader delegate to this ONE implementation; no independent asset writer/ZIP reader.
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

## Key-free local producer

`uv run -m scripts.release.android_producer --help`

1. `stamp --rev FULL_PIN --notes-file NOTES --out ASSETS --batch-id UUID --abi arm64-v8a`: exclusive metadata triple, exact notes bytes; outputs stay outside tracked source. Pass `-Pmanadj.releaseMetadataDir=ASSETS` to the separately owned build.
2. `candidate --apk UNSIGNED --rev FULL_PIN --channel stable --qa SOURCE_QA --qa UNSIGNED_QA --out CANDIDATE --verification-out UNSIGNED_RECEIPT`: mandatory checkout/source/SDK checks, no legacy bypass.
3. `request --candidate CANDIDATE --out SIGN_REQUEST`: send these records and unsigned bytes to the protected adapter. This command never signs.
4. `accept-signed --candidate CANDIDATE --request SIGN_REQUEST --unsigned-apk UNSIGNED --unsigned-receipt UNSIGNED_RECEIPT --signed-apk SIGNED --out SIGN_RECEIPT --verification-out SIGNED_RECEIPT`: rerun actual SDK archive/signature checks, bind unchanged embedded triple/content.
5. `eligible` accepts the same candidate/request/unsigned/signed inputs, plus `--sign-receipt SIGN_RECEIPT --qa SOURCE_QA --qa UNSIGNED_QA --qa SIGNED_QA --histories HISTORIES --floor-code RESERVED_CODE --out LOCAL_FEED`. This re-verifies bytes and requires a strictly higher code than both histories and the trusted package-wide floor (at least legacy code7).

- QA files contain `QAReceipt` fields **except** `receipt_sha256`; producer hashes actual file bytes. Scope `source` has null artifact SHA; `unsigned` and `signed` bind their exact artifact. All bind source/tree/batch/release; IDs must be distinct and result `pass`.
- QA records are trusted-local runner inputs, not authenticated network evidence. The protected operator selects those files; this producer cannot establish that a fabricated `pass` ran tests.
- `HISTORIES` is an explicit object with both `stable` and `preview` keys, each a validated channel snapshot or explicit null for no published feed. Offline/malformed history must not be replaced with null. The protected operator owns fresh readback, version reservation and stale-head compare-and-swap before publication; local eligibility does not serialize two publishers.
- JSON outputs are create-only. Failure after writing one output can leave partial local evidence; retry into fresh paths. No partial output is a feed publication receipt.
- Producer tests use actual synthetic ZIP payloads with the SDK verifier seam simulated. They do not qualify a new signed APK, actual Android build, channel deployment or installed application.

## Same-origin site staging seam

Source: `scripts/release/android_site_stage.py`. Runs only over a caller-owned built-site directory and trusted local eligible-feed/sign-receipt files. No repository APK binary, credentials, HTTP client, workflow dispatch or deploy action.

1. Build the existing site into a fresh `.site-dist`; restore its complete current `android/` subtree from the protected publisher's durable site snapshot. Do not manufacture empty history when fetch/restore fails.
2. `uv run -m scripts.release.android_site_stage artifact --site-root .site-dist --apk SIGNED --feed LOCAL_FEED --sign-receipt SIGN_RECEIPT --out ARTIFACT_STAGED`: bind canonical feed to signed build, check actual bytes, stage `/android/artifacts/<release_id>/<apk_sha256>.apk`. Immutable collisions refuse; identical retries succeed. No channel feed changes.
3. Protected publisher alone publishes that complete artifact-only site and reads the exact HTTPS artifact back without redirects, checking streamed SHA/bytes. It records `manadj_android_artifact_readback/v1` with exactly `format`, `url`, `apk_sha256`, `apk_bytes`, integer `status:200`, `redirected:false`, `sign_receipt_sha256` (canonical record SHA), and `expected_heads`.
4. `expected_heads` contains both `stable` and `preview`: SHA256 of each current feed's **raw bytes**, or null only for confirmed absence. The protected operator owns fresh remote observations and release/version reservation. The readback receipt repeats these exact heads; arbitrary client JSON is not accepted as trusted publication evidence.
5. `uv run -m scripts.release.android_site_stage offer --site-root .site-dist --feed LOCAL_FEED --sign-receipt SIGN_RECEIPT --served-artifact READBACK --expected-heads HEADS --floor-code RESERVED_CODE --out FEED_STAGED`: exclusive local lock; both-head CAS; cross-channel monotonic code; preserve prior entry history and unrelated content; rehash staged APK; atomic local feed replacement. Outputs state `local-feed-staged`, **not** published/offered/installed/applied.
6. Protected publisher serializes the final complete-site deployment against remote heads and reads the feed back. Its own durable receipt establishes publication. Local staging receipts do not.

- Symlinked destination ancestry refuses. Destructive tests use temporary decoys only. Local cooperative locking is not a distributed publication lock.
- Artifact staging returns `staged_feed_sha256` and `staged_feed_bytes` for the exact canonical JSON plus newline that `offer` writes. Use `artifact --feed-bytes-out EXPECTED_FEED` to materialize those bytes before planning deployment. The protected offer-readback plan must bind these bytes, **not** the producer's pretty-printed eligible JSON.
- Static staging tests cover decoy bytes, readback binding, create/collision behavior, both-head CAS, rollback, history preservation and unchanged existing site content; they do not qualify APK signing or live Pages readback.

## Complete snapshot Pages wiring

- Builder: `scripts/release/android_pages_build.py`; workflow: `.github/workflows/explainer-site.yml`. Every site build uses this wrapper, including unrelated explainer/theme changes.
- **Bootstrap blocker:** no real `site/android-snapshot.json` is supplied by this source change. Missing pin fails closed before rendering/upload; do not land/dispatch this workflow expecting the previous bare-site behavior. Protected Ops must create the initial complete snapshot, attest its digest/heads and provide the tracked pointer in the combined publication decision. No placeholder receipt or synthetic fixture is a bootstrap snapshot.
- Pointer schema `manadj_android_snapshot/v1`: exact fields `{format,sha256,bytes,url,heads:{stable,preview}}`. `sha256` hashes raw uncompressed TAR bytes; `bytes` is its exact size (1024 through 512 MiB); heads are raw channel JSON SHA256s, or null only for confirmed absence.
- ONE upstream source: `https://github.com/murtaza64/manadj/releases/download/android-snapshot-<sha256>/android-snapshot-<sha256>.tar`. Download uses the fixed `murtaza64/manadj` repository, exact derived tag and asset filename; digest/size remain mandatory. No latest URL, arbitrary URL/domain, credential in pointer or client GitHub offer.
- Protected durable local custody: `~/.local/share/manadj/android-channel-state`; immutable Release asset is the CI mirror. Protected Ops owns producing/uploading snapshots and selecting the pointer. Repository source contains no APK binary.
- TAR contains only unique regular `android/artifacts/<release_id>/<apk_sha256>.apk` and `android/{stable,preview}/channel.json` files. No directory records, links, traversal, extras or duplicates. Preserve **all** prior immutable APKs, including those not currently offered. Maximum 4096 members, 768 MiB decoded total; each APK is bounded by the canonical 512 MiB limit. Validate all path hashes, feed types/heads and complete referenced APK closure before building.
- Deterministic local pack API: `pack(site_root, archive_path)` returns the pointer after validating its entire archive. CLI: `uv run -m scripts.release.android_pages_build --pack-site COMPLETE_SITE --output SNAPSHOT.tar --pointer-out POINTER.json`. Exclusive shared staging lock, complete Android subtree, normalized USTAR metadata, create-only outputs. Artifact-only snapshots allow hashed orphan APKs and null heads. This creates local evidence only; protected Ops owns prior-pointer CAS, durable custody, upload and the eventual tracked-pointer commit.
- Wrapper renders the existing site in private temporary output, overlays the entire verified `android/` tree unchanged, then exposes the fresh output. `--snapshot LOCAL_TAR` runs the same validations offline. Existing output refuses rather than replacing user files.
- Entire build/deploy workflow retains concurrency group `explainer-site-pages`, cancellation disabled. All promotion workflows must use that same group. Current-main SHA checks before build and immediately before deployment reject stale queued source/pointers. Main SHA identity includes the tracked pointer; no separate mutable pointer lookup.
- These checks are **not remote atomic CAS**: main can move after the final check and external writers can bypass GitHub concurrency. Protected Ops must serialize every site writer, retain artifact/readback receipts and execute the concrete publication decision. No network deploy was performed or authorized here.
- Static tests validate actual unrelated site rendering plus byte-identical APK/feed overlay, CNAME preservation, missing/corrupt/wrong-source pins, unsafe/incomplete archives and workflow guards. Local promotion CAS/race controls remain covered by staging tests.
