---
title: Install manaDJ
description: Download manaDJ for macOS or Windows, then work through Setup.
version: v0.1.0-rc.3
release: https://github.com/murtaza64/manadj/releases/tag/v0.1.0-rc.3
latest: https://github.com/murtaza64/manadj/releases/latest
mac_download: https://github.com/murtaza64/manadj/releases/download/v0.1.0-rc.3/manaDJ-0.1.0-rc.3-arm64.dmg
windows_download: https://github.com/murtaza64/manadj/releases/download/v0.1.0-rc.3/manaDJ-0.1.0-rc.3-x64-setup.exe
---

## Install on macOS {#macos}

1. Download the **macOS arm64 DMG**: Apple Silicon (M1 or later), recent macOS required.
2. Open it, drag **manaDJ** into **Applications**, eject.
3. In Applications, right-click (or Control-click) manaDJ → **Open**; confirm **Open**.
4. Not notarized: if blocked with **Move to Trash / Done**, use **System Settings → Privacy & Security → Open Anyway**; confirm.

First launch takes longer while preparing the database.

## Install on Windows {#windows}

1. Download and run the **Windows x64 installer**: 64-bit Windows 10/11; **untested on Windows hardware**.
2. Not code-signed: SmartScreen’s **Windows protected your PC** → **More info → Run anyway**.
3. Launch from Start. Installs to `%LOCALAPPDATA%\Programs\manaDJ` without administrator rights.

Windows 11 Smart App Control has no per-app bypass; use a machine with it off until manaDJ is signed.

## Welcome {#welcome}

- First run requires an empty Library and a welcome never finished or skipped.
- Select **Get started** or **Skip setup**; all steps below are optional.
- **Finish later** saves progress; **Resume setup** continues it.
- After Controller check, **Open manaDJ** starts the Tour.

## Rekordbox import {#rekordbox-import}

1. Preview the library; choose whether to **Keep my genres**, then **Import … new tracks**, or **Skip for now**.
2. Keep manaDJ open; **Continue setup while importing** proceeds.

Import never writes to Rekordbox or moves music. Export is off by default.

## Music folder / Tracks directory {#music-folder}

1. **Choose folder…** → **Save & scan folder**, or **Use folder without scanning / Skip for now**.
2. Keep manaDJ open during scanning. Downloads use this folder; imported files stay in place.

## Cue mode {#cue-mode}

Paused-Deck Hot Cues:

- **Gated** (default): hold previews; release stops and returns.
- **Trigger**: press starts playback; release continues.

Playing-Deck Hot Cues always jump; Main cue retains hold behavior. Headphone routing: [Controller check](#controller-check).

## SoundCloud {#soundcloud}

1. Log into [soundcloud.com](https://soundcloud.com).
2. Developer tools: **Option–Command–I** (macOS), **Ctrl–Shift–I** (Windows). Chrome/Edge/Brave: **Application**; Firefox/Safari: **Storage**. Safari: first enable **Settings → Advanced → Show features for web developers**.
3. **Cookies → https://soundcloud.com**: copy **oauth_token** (`2-…`).
4. Paste into manaDJ → **Connect**; verify account and likes → **Done**.

## Soulseek {#soulseek}

1. Enter username/password → **Connect**. New accounts are created on first login.
2. Wait for **Connected to Soulseek** → **Done**; if slskd is unavailable, **Skip**.

## Controller check {#controller-check}

1. Choose **Master** (speakers), **Cue** (headphones; initially **Off**); select explicit output pairs when prompted, then **Test tone**. Controller headphones usually use outputs 3/4.
2. Connect USB controller; test mapped controls. **No Mapping** means controls cannot operate manaDJ.
3. **Calibrate jog wheels** if available; **Done / Skip**.

## Run Setup again / first-run state {#rerun-setup}

- **Settings → Help → Setup → Run setup again** replays all six guides, retaining Library and configuration; changed choices apply.
- **Resume setup** continues saved progress.
- No **Reset to first run** button; replay retains completion history without restoring Welcome.
- **Settings → Help → Tour → Reset tour progress** resets only the Tour.

## Where your data lives {#data}

- **macOS:** `~/Library/Application Support/manaDJ`
- **Windows:** `%APPDATA%\manaDJ`
- Contains database, backups, settings, stems and logs.

## Updates {#updates}

1. Quit manaDJ; replace the Applications copy using the new DMG (macOS) or run the new installer (Windows). Data remains.
2. [Current prerelease v0.1.0-rc.3](https://github.com/murtaza64/manadj/releases/tag/v0.1.0-rc.3) / [latest release](https://github.com/murtaza64/manadj/releases/latest) (excludes prereleases).

## Uninstall {#uninstall}

- **macOS:** quit; Applications → manaDJ → Trash.
- **Windows:** Settings → Apps → Installed apps → manaDJ → Uninstall.

The data folder remains.

## Troubleshooting {#troubleshooting}

- **Blocked:** [macOS](#macos) / [Windows](#windows).
- **Startup failure:** window shows error/log path; logs: [data root](#data).
- **Import/Scan disconnected:** **Check progress**; check drive connection.
- **No sound:** [Controller check](#controller-check) → **Test tone**.
- **Account failure:** **Settings → Accounts** → reconnect.
- [GitHub issue](https://github.com/murtaza64/manadj/issues): version, OS, steps, log.

[Back to the feature tour](index.html#perform)
