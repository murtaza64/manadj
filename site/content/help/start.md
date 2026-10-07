---
slug: start
title: First run and returning to Setup
description: Complete or skip optional guides, resume later, and relaunch one guide without resetting the Library.
order: 60
---

For downloads, operating-system opening instructions, updates and uninstall, use the [install guide](../install.html). This page starts **after launching** manaDJ.

## Welcome and progress {#welcome}

An empty Library with Welcome not yet completed or skipped opens **Welcome** on first run. **Get started** opens a sequence of optional guides; **Skip setup** closes it. Each guide offers **Finish later**, checkpointing progress. A partially completed first run shows **Welcome back → Resume setup** on return. Finishing the sequence with **Open manaDJ** closes Setup and lets the Tour start. The Tour points at UI; it does not import Tracks or configure accounts. A populated Library does not show first-run Welcome again just because you relaunch the app.

| Guide, in order | What to choose | Later location |
| --- | --- | --- |
| **Rekordbox import** | Preview a local Rekordbox library; choose new Tracks or missing details, or skip. | Sync → Rekordbox import |
| **Tracks directory** | Choose the music folder and scan it, use it without scanning, or skip. | Settings → Library → Tracks directory |
| **Cue mode** | Gated or Trigger for paused-Deck Hot Cues. | PERFORM → GATED/TRIGGER toggle |
| **SoundCloud** | Connect an account for the Acquisition tab. | Settings → Accounts → SoundCloud |
| **Soulseek** | Optional download supplier connection. | Settings → Accounts → Soulseek |
| **Controller check** | Check Master/Cue output pairs, test tones and controller mapping. | Settings → Help → Setup |

### Rekordbox and the music folder {#rekordbox}

The Rekordbox guide previews Track/cue/grid/Key/MyTag/Genre/Playlist counts before import. **Keep my genres** is initially checked. Choose **Import N new tracks**, **Fill in missing library details**, **Continue without importing**, or **Skip for now** as offered by the preview. The import reads Rekordbox and creates/fills Library records in place; it does not move audio or write back to Rekordbox. Loops and some memory cues are not imported: read the skipped counts. Keep manaDJ running until progress completes; **Continue setup while importing** advances the guide without stopping its background job.

In **Tracks directory**, choose a folder in the desktop app (or enter its full path in the browser). **Save & scan folder** recursively adds supported audio without copying it; **Use folder without scanning** configures the folder for later scans and downloads. **Continue setup while scanning** advances while that scan runs; keep the app open. If you skipped both imports, you can still [drop files into the desktop Library](curate.html#import-tracks) later.

### Cue mode and accounts {#cue-mode}

**Gated** (default): holding a Hot Cue on a paused Deck previews it; releasing stops and returns. **Trigger**: pressing starts playback and releasing continues. On a playing Deck, Hot Cues jump regardless of this setting. The Main Cue retains its own hold behavior. Change the choice later with the **GATED/TRIGGER** control in Performance.

To connect SoundCloud, sign in at soundcloud.com in a browser and copy the **oauth_token** cookie from developer tools (**Application/Storage → Cookies → https://soundcloud.com**). Paste it into the guide, choose **Connect**, check account/likes, then **Done**. It only establishes the account: choose **↻ Refresh likes** in [Acquisition](acquire.html#review) to fetch items. For the browser-specific cookie-opening keys and safety notes, use [install → SoundCloud](../install.html#soundcloud). For Soulseek, enter username/password and **Connect**, wait for **Connected to Soulseek**, then **Done**; a new username creates an account on first login. Either account guide may be skipped.
{: #accounts}

### Check the sound path {#controller-check}

Choose **Master** for speakers and optionally **Cue** for headphones (**Off** initially). Pick explicit output pairs when necessary; use each **Test tone** before relying on headphone cueing. Connect a MIDI controller and inspect its Mapping: **No Mapping** means it cannot control manaDJ. Test mapped controls; **Calibrate jog wheels** appears only for supported mappings. Choose **Done** or **Skip**. No hardware is required to finish Setup.

## Relaunch without wiping anything {#relaunch}

Open **Settings → Help → Setup**. Each guide shows **Done**, **Skipped**, or **Not started**; **Open/Start** runs that guide on its own. **Run setup again** replays the sequence but keeps Library, accounts and settings; a previously Done guide is not demoted just because you skip its replay. **Resume setup** continues a saved first-run journey. There is no reset-to-empty-Library button. **Settings → Help → Tour → Reset tour progress** affects only the Tour, not Setup. For a specific import or Sync write after setup, use [Sync](sync.html) rather than replaying the whole sequence.
