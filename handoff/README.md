# Orchestrator handoff — 2026-10-15 ~20:30Z

Branch `handoff/2026-10-15` (do not land). Snapshot of the manadj orchestrator state so work can resume from the other laptop. Original lives in the sidecar `~/manadj/.editspace/` on the old laptop (not on GitHub).

## Files here
- `android-feedback-ledger.md` — every Android request + owner. Orchestrator rows UH/EH/SH/VH/TH (lanes use plain U/E/S/T). Rows I added often still say `todo` after shipping — trust the phone-build log / lane mail over the status column.
- `android-phone-build-policy.md` — per-lane bookmarks merged into one phone build; install hold.
- `android-heard-semantics.md` — human's definitive HEARD quantize spec.
- `phone-build` — merges the lane bookmarks below, builds `:app:assemblePhone` (R8, non-debuggable, baseline profile, app id `dev.murt.manadj`, shared debug keystore), installs over wireless adb. Hard-coded old-laptop paths (`/Users/murtaza/editspaces/manadj/lanes/android-phone-build/...`, keystore `~/manadj/.editspace/android/debug.keystore` — copy it, signature must match or the phone app must be reinstalled/data lost).
- `phone-pair` — QR / dns-sd adb connect helper (adb's own mdns is blind on macOS here).
- `live-1552.png` — phone screenshot behind VH13 (BPM tab readout).

## Remote branches (all pushed)
`main` (wvlyt) + phone-build heads: `android-engine` `android-ui` `android-library` `android-session` `android-track-edit` `android-icon` `android-settings` `android-viz` `android-onehand` `android-wave` `android-link`. Parked desktop work: `wip/viz-ratings-401` (#401 desktop side), `wip/desktop-perf-385`.

Phone build = `jj new <all 11 bookmarks>` then assemblePhone.

## Phone
- Nothing A069P, Android 16. Last install 20:18Z: optimized build with all heads at that time.
- **Install hold ON** (`~/manadj/.editspace/android/phone-install.hold`): human is using the app; phone-build builds only. Lift when the human says.
- adb: phone listens on legacy `192.168.1.176:5555` (`adb tcpip 5555`) until reboot; else turn on Wireless debugging and pair (`adb pair ip:port code`), then connect via dns-sd endpoint.

## In-flight (lane → state)
- **android-viz** (`android-viz`): pitch panel (BPM card). **Interrupted mid-work**: bookmark tip stvwn includes uncommitted WIP for VH13–VH15 (snapshotted, unverified, may not compile). Open: VH13 readout flush to inner edge; VH14 press fill stuck after tap; **VH15 clarification** — "vertically aligned" = all items centred on one horizontal line (cross axis), NOT horizontal centring; no inner padding (no corner there), small padding on the outer/corner side only; use all remaining width; readouts must NOT shift when the BPM card or the browser opens/closes (add browser case to the no-shift test). Order inner→outer: %, BPM, SYNC, KEY, LOCK. VH12 drawer must always settle fully open/closed (tap and swipe).
- **android-performance-365-apk** (`android-ui`): UH31 step 2 — measure browser open/close/fling/scrub on the phone (optimized build, viz backdrop on/off) and make open/close snappy; blocked by install hold. UH30 drawer settle shipped.
- **android-session** (`android-session`): SH8 slow replay start/seek — step 3 (narrow readiness) built; next consume engine seek API (prefetch/decodedRanges, on main). SH7 link button in player, SH9 list opens at top — shipped to phone.
- **android-app-369-370** (`android-engine`): #402 playback notification (on phone, not landed); SH8 seekable decode landed on main (AAC still fills from 0).
- **android-track-edit** (`android-track-edit`): #403 TH1 tags/energy/key editing — parked for review.
- **android-wave-quality** (`android-wave`): #397 parked. **android-link** (`android-link`): #398 parked; desktop half (link device edit) not on main.
- **viz-ratings-401**: desktop rating store/clip editor/reviewer parked (`wip/viz-ratings-401`); phone ratings queue until it lands.

## Awaiting human
- Land approvals: #402, #397, #398 (+desktop half), SH7, UH24–UH31 batch, #403, #401 desktop, #385 desktop perf, #392 routine mix review.
- Phone runs requested by lanes: browser fling (UH9/UH26 numbers), Session replay start + mid-track seek (SH8 timings).

## Other laptop (murtaza-macbook-pro)
Library DB, config.toml, all tracks and stems copied 2026-10-15 (prior DB kept in `~/manadj/data/pre-copy-20261015/`). Its checkout was on old code (detached `2aefcc32`): `git fetch && git checkout origin/main && uv sync --all-extras --all-groups` (install uv first) before starting — the DB is at alembic head 0046_yumpp.
