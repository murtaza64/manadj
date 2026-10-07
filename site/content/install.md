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

1. Download the **macOS arm64 DMG** above. Requires an Apple Silicon Mac (M1 or later) and recent macOS.
2. Open the DMG, drag **manaDJ** into **Applications**, then eject the DMG.
3. In Applications, **right-click → Open** (or Control-click → Open), then confirm **Open**.

manaDJ is not notarized by Apple. If macOS only offers **Move to Trash** or **Done**, open **System Settings → Privacy & Security**, find the manaDJ blocked-app notice, select **Open Anyway**, and confirm. The first launch takes longer while the database is prepared.

## Install on Windows {#windows}

Requires 64-bit Windows 10 or 11 (x64); **untested on Windows hardware**.

1. Download and run the **Windows x64 installer** above.
2. The installer is not code-signed. At SmartScreen’s **Windows protected your PC**, choose **More info → Run anyway**.
3. Launch manaDJ from the Start menu. It installs to `%LOCALAPPDATA%\Programs\manaDJ` without administrator rights.

If Windows 11 Smart App Control blocks the installer outright, there is no per-app bypass. Use a machine with Smart App Control off until manaDJ is signed.

## Welcome {#welcome}

On an empty Library that has never finished or skipped First run, **Welcome to manaDJ** offers **Get started** or **Skip setup**. Every step is optional. The sequence is Rekordbox import → Tracks directory → Cue mode → SoundCloud → Soulseek → Controller check.

**Finish later** or closing the first-run overlay saves your place. On reopening manaDJ, **Welcome back** offers **Resume setup**, even if you have already imported tracks. Finish the sequence with **Open manaDJ**; the Tour then shows you around.

## Rekordbox import {#rekordbox-import}

1. Let manaDJ find your Rekordbox library and preview the counts. Nothing is imported during the preview.
2. Choose whether to **Keep my genres** as Tags, then select **Import … new tracks**.
3. Keep manaDJ open until the import finishes. **Continue setup while importing** moves to the next step while it runs.

The import reads a snapshot and **never writes to Rekordbox**. Music files stay in place. **Export to Rekordbox / Engine DJ** is **off by default** in Settings → Library; writing to those libraries requires opting in separately.

Tracks, Hot Cues, beatgrids, keys, MyTags and playlists come across where available. The first memory cue becomes the Main cue. Other memory cues, saved loops, missing files and streaming-only tracks stay in Rekordbox. Smart playlists become regular playlists using their saved tracks. Existing manaDJ values are kept; repeating an import fills missing details without duplicating tracks.

If no library is found, open Rekordbox once with your collection and select **Look again**, or set **Settings → Library → Rekordbox location**. Otherwise choose **Skip for now** and add a folder next.

## Music folder / Tracks directory {#music-folder}

1. Select **Choose folder…** or enter the full path to your music folder.
2. Select **Save & scan folder** to add audio files from it and all subfolders, without moving them. Existing Library tracks are not added twice.
3. Alternatively, select **Use folder without scanning** or **Skip for now**.

This folder is also the destination for new Acquisition downloads. Keep manaDJ open during a Scan; **Continue setup while scanning** lets you proceed. Change the folder later in **Settings → Library → Tracks directory**.

## Cue mode {#cue-mode}

Cue mode controls **Hot Cues on a paused Deck**, for keyboard, MIDI and on-screen pads:

- **Gated** (default): hold a Hot Cue to preview; release stops playback and returns to that cue.
- **Trigger**: press a Hot Cue to jump there and start playback; releasing it leaves playback running.

On a playing Deck, Hot Cues always jump. The Main cue keeps its hold behavior in both modes. Change the choice with **GATED** in Performance: lit means Gated, unlit means Trigger. Headphone output routing is a separate choice in [Controller check](#controller-check).

## SoundCloud {#soundcloud}

Optional. Connect to see your likes in **Sync → Acquisition**.

1. Log in at [soundcloud.com](https://soundcloud.com) in your browser.
2. Open developer tools: **Option–Command–I** on macOS or **Ctrl–Shift–I** on Windows. In Chrome/Edge/Brave, choose **Application**; in Firefox/Safari, choose **Storage**. Safari first needs Settings → Advanced → **Show features for web developers**.
3. Under **Cookies → https://soundcloud.com**, copy the value of **oauth_token** (starts with `2-`).
4. Paste it into the manaDJ guide and select **Connect**. Check the displayed account name and likes count, then select **Done**.

You can **Skip** and reconnect later through **Settings → Accounts → SoundCloud**. The copied token is a credential; keep it out of screenshots and issue reports.

## Soulseek {#soulseek}

Optional. manaDJ can search Soulseek when a track cannot be downloaded from SoundCloud.

1. Enter your Soulseek username and password, then select **Connect**. For a new account, choose a new username and a password you do not use elsewhere; Soulseek creates it on first login.
2. Wait for **Connected to Soulseek**, then select **Done**. manaDJ runs the bundled slskd program separately.
3. If login fails, use **Re-enter account** or **Restart slskd**. If the build reports slskd unavailable, **Skip** this step.

Revisit it in **Settings → Accounts → Soulseek**. An existing external slskd configuration is shown as **Using your own slskd**.

## Controller check {#controller-check}

- **Audio outputs:** choose **Master** for speakers and **Cue** for headphones, then use each **Test tone** button. Cue starts **Off**; a controller’s headphone jack is usually outputs 3/4. Choose an explicit output pair when prompted.
- **MIDI controller:** connect over USB and check the detected device. With a Mapping, press buttons or move controls to see their names and the checked-control count. **No Mapping** means that device’s controls will not operate manaDJ.
- **Jog calibration:** use **Calibrate jog wheels** when available; some controllers have fixed calibration.

A controller is optional; you can use the keyboard and mouse. Select **Done** or **Skip**, and revisit the check in **Settings → Controllers → Controller check**.

## Run Setup again / first-run state {#rerun-setup}

Open **Settings → Help → Setup**:

- **Start** or **Open** launches one guide. Its status is **Not started**, **Done** or **Skipped**.
- **Run setup again** replays all six guides from the beginning, including completed ones. It keeps your Library and existing configuration; choices you change in a guide still take effect.
- **Resume setup** appears when a first-run checkpoint exists and continues from that saved step.

There is currently **no “Reset to first run” or “Reset setup progress” button**. Replaying Setup does not clear completion history or restore the initial welcome. Setup progress (guide statuses and a saved step) is separate from Library contents: a new First run needs an empty Library and a welcome that has never been finished or skipped; a saved journey can resume with tracks already present. **Do not delete your Library or data folder to replay Setup**—use **Run setup again**.

**Settings → Help → Tour → Reset tour progress** resets the feature-tour history and turns tours back on. It does not reset Setup or the Library.

## Where your data lives {#data}

- **macOS:** `~/Library/Application Support/manaDJ` — Finder → Go → Go to Folder…
- **Windows:** `%APPDATA%\manaDJ` — paste into File Explorer.

The data root holds the Library database, backups, settings, stems and logs. **Settings → Library → Reveal settings file** opens the location of `config.toml`; **Reveal logs** opens the logs folder. Imported music stays at its original location; new downloads go to your chosen Tracks directory.

## Updates {#updates}

Quit manaDJ before installing an update. On macOS, replace the Applications copy using the new DMG. On Windows, run the new installer over the old installation. Your data is kept. See [current prerelease v0.1.0-rc.3](https://github.com/murtaza64/manadj/releases/tag/v0.1.0-rc.3) or [latest release](https://github.com/murtaza64/manadj/releases/latest); GitHub’s latest-release shortcut does not include prereleases.

## Uninstall {#uninstall}

- **macOS:** quit manaDJ and move it from Applications to the Trash.
- **Windows:** Settings → Apps → Installed apps → manaDJ → Uninstall.

The data folder is separate from the app. Keep it if you want your Library and settings when reinstalling.

## Troubleshooting {#troubleshooting}

- **App blocked:** follow the [macOS](#macos) or [Windows](#windows) first-launch steps above.
- **“manaDJ couldn’t start”:** the window shows the error and full log path. Logs are inside the [data root](#data).
- **Import or Scan lost connection:** choose **Check progress** before starting another task. Check that the music drive is connected; tracks already imported are kept.
- **No sound:** reopen [Controller check](#controller-check), choose the correct output and use **Test tone**.
- **Account connection failed:** reopen the relevant guide under **Settings → Accounts** and reconnect.

Report the version, operating system, steps and relevant log in a [GitHub issue](https://github.com/murtaza64/manadj/issues). Remove credentials before sharing logs.

[Back to the feature tour](index.html#perform)
