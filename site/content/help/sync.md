---
slug: sync
title: Import and export
summary: Bring tracks and external edits into manadj, then export your curated Library to disk or DJ software.
order: 8
related: [start, curate, analysis, acquire]
---

## Import tracks or external edits {#import}

For a first Rekordbox Import, use [the Setup guide](../start/index.html#rekordbox). For ongoing review, open **Sync → Tracks**. Each row compares the track across Disk, the Library, Engine DJ, and Rekordbox.

To add local audio selectively:

1. Set **Tracks directory** in **Settings → Library**.
2. Open **Sync → Tracks** and click **refresh**.
3. Expand **Unimported files**, check the files you want, and click **Import selected** with the displayed count.
4. Read the scope, then click **Apply**.

Disk Import keeps audio in place. You can also drop files or folders onto the Library; folders include their subfolders. Already-imported tracks, including Archived tracks, are skipped. The [tracks-directory Setup guide](../start/index.html#tracks-directory) instead offers a Scan that imports all new audio in that folder.

To bring back edits made elsewhere, expand a diverged row and compare its values. Use the **← import** action beside the external value you want. **Import performance data ← Engine** fills missing keys, Hot Cues, Beatgrids, and Main cues; replacing saved information asks for review. For Hot Cues, **fill empty slots** preserves occupied slots, while **replace all** replaces the set.

The whole-library Engine action at the bottom has broader scope than a single row. Engine-only tracks have no new-track Import action here; add their audio through Disk Import first.

## Export Library changes {#export}

1. Check **Rekordbox location** and **Engine DJ location** in **Settings → Library**. Empty locations use auto-detection; enter a folder to override it.
2. Enable **Export to Rekordbox / Engine DJ**. It starts disabled; Import does not require it.
3. Close the target DJ application before writing to its library.
4. Return to **Sync → Tracks**. Use **Export all → Engine/Rekordbox** for missing tracks, **Export tags** for Tag assignments, or the available field actions on an expanded row.
5. Read each action's scope before **Apply**, then check the refreshed comparison.

Some actions affect the whole Library even when launched from a filtered section. **Export fields → Disk** writes metadata into the audio files. An empty Library value does not erase an external value; Import the external value if it is the one you want.

If a chip count differs from its inbox section, click the chip: it lists every track with that divergence, including tracks filed under another section. For Playlist comparisons, open **Sync → Playlists** and click a Playlist name.
