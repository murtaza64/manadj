---
slug: acquire
title: Acquire tracks
summary: Connect SoundCloud and Soulseek, review wanted tracks, and download audio into your Library.
order: 9
related: [start, sync, curate]
---

## Connect SoundCloud and review likes {#soundcloud}

1. Open **Settings → Accounts → SoundCloud**.
2. Log in to soundcloud.com in your browser. Open its developer tools, then **Application → Cookies → https://soundcloud.com** in Chromium browsers, or **Storage → Cookies** in Firefox or Safari.
3. Copy the value of **oauth_token**, paste it into the guide, and click **Connect**.
4. Check the account name and likes count, then click **Done**.
5. Open **Sync → Acquisition** and click **Refresh likes**.

The Acquisition tab appears only while SoundCloud is connected. If the token stops working, return to the guide with a current cookie value. Copy the value, not the cookie's name.

Choose a Source Item to inspect it. If a proposed Library match is correct, choose **accept match** rather than downloading another copy. Otherwise choose **reject**, then **queue download**. Check several rows to use **queue selected**; with none checked, **queue all visible** queues eligible new items in the current view.

The default filters hide mixes and clips. Enable those Classifications or change the state filter if an item seems missing. Click an item's Classification to correct it. Refresh adds new Source Items; unliking something on SoundCloud does not remove its local record.

Downloads go to your [tracks directory](../start/index.html#tracks-directory), then become Library tracks. **fulfilled** means the Source Item corresponds to a Library track. For failures, open **failed** and read the item's message. **retry via soundcloud** always retries SoundCloud, even after a failed Soulseek download.

## Find audio through Soulseek {#soulseek}

1. Open **Settings → Accounts → Soulseek**.
2. Enter a username and password, click **Connect**, and wait for **Connected to Soulseek** before **Done**. A new username and password can create an account on first login.
3. In Acquisition, select an unfulfilled item and use its Soulseek search. Edit the search text if the title includes unnecessary words.
4. Compare filename, format, bitrate, length, and queue availability. Click a result to download it. Clicking is the download action, not an audio preview.

**auto mp3** chooses a high-quality MP3 near the item's duration and retries alternative peers. A highlighted length difference is a reason to check the version. For an unrelated track, expand **soulseek search** above the item list.

If login fails, use **Re-enter account**; if the service stopped, use **Restart slskd**. If this build reports Soulseek unavailable, skip the guide. Soulseek connection alone currently does not reveal Acquisition: SoundCloud must also be connected.
