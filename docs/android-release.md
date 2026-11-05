# Android release build and verification (#419)

Tool: `scripts/release/android_release.py`. It never builds, signs, installs or publishes. Each stage refuses (exit 1, `REFUSED: <check>`) or prints JSON. Receipts are created exclusively (`open(..., 'x')`), mode 0444.

## Identity

- Package `dev.murt.manadj.excalibur`, signer certificate SHA-256 `18f8fe820d6abd112be1fa5c99e3c69f77cbb5c834242899135c9b528af7417c` (Excalibur, custody: personal/operations). The original `dev.murt.manadj` (da36 signer) is a separate app; nothing here updates it.
- Release identity: core #420 schema 1 verbatim (`docs/releases.md` once #420 lands): `build-info.json` {schema, version, source_revision, notes_sha256, release_id} + `release-notes.json` {schema, release_id, body}. Android `version` = `versionName`. `tests/test_android_release.py` pins a vector computed with core's `identity()`.
- The APK carries the pair at `assets/manadj-release/`. The app (#419 native) reads it for the applied identity, notes popup and seen receipt. No assets = dev build: no release identity, never "applied".

## States

| State | Meaning | Source |
| --- | --- | --- |
| offered | entry in `manadj_android_channel/v1` | `channel-entry` + channel publisher |
| staged | downloaded bytes match `apk_bytes`/`apk_sha256` and archive package/version/signer | app |
| installed | PackageManager package + versionCode + signer | app |
| applied | running process reads embedded `release_id` == installed entry | app |

This tool produces only offered entries. It never claims installed or applied.

## Flow

1. `jj new <commit>` (the build tree must equal the pin).
2. `uv run scripts/release/android_release.py stamp --rev <commit> --notes-file notes.txt --out DIR`. Prints `release_id` and the gradle flag.
3. `cd android && ./gradlew --offline :app:assembleRelease -Pmanadj.releaseMetadataDir=DIR`. Toolchain and env: `android/README.md`. Clear `MANADJ_ANDROID_KEYSTORE`.
4. `verify-unsigned APK --rev <commit> --out unsigned.json` checks:
   - package matches; versionCode/versionName/minSdk/targetSdk match the gradle file at the pin
   - not debuggable, ABIs present
   - no signature entries, and `apksigner verify` fails
   - `zipalign -c -P 16 -v 4` passes
   - embedded identity is valid with `source_revision` == pin
   - records the pin's source-file digest and a content digest: SHA-256 over sorted `<entry>\0<sha256 of decompressed payload>` for non-signature entries; duplicate entry names are refused
5. Signer (personal/operations) signs a separate output. Then `verify-signed SIGNED --unsigned-receipt unsigned.json --out signed.json` checks:
   - one signer with the expected cert; v2 or v3 verifies
   - same package/version/sdk/ABIs
   - identical non-signature entries
   - alignment
   - unchanged embedded identity
6. `channel-entry --signed-receipt signed.json --url https://…` emits one channel entry: {release_id, version_code, version_name, min_sdk, abis, source_revision, notes_sha256, apk_url, apk_sha256, apk_bytes}. Refuses unstamped APKs, non-HTTPS URLs and any other package/signer.

## Flags

- `--allow-unstamped`: re-verify legacy APKs (e.g. rc.7 code 7) that predate the embedded identity; `release_identity` is null and they cannot be offered.
- `--skip-checkout-check`: re-verify an existing APK without checking out its pin; the pin's tree digest is still recorded.

## Limits

- Robolectric/host tests do not exercise this tool; checks shell out to SDK `aapt`, `apksigner`, `zipalign` (latest `$ANDROID_HOME/build-tools`), and `apksigner` needs `java` on PATH.
- Builds are not bit-reproducible; the receipt binds one artifact by hash, not the source to every rebuild.
