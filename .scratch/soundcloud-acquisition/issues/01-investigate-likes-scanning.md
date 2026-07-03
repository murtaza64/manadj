# Investigate: scanning SoundCloud likes

Status: resolved
Type: research

## Question

How do we programmatically list a user's SoundCloud likes (for Refresh)? Current workflow passes individual track URLs to yt-dlp with an OAuth token; nothing scans the likes list.

## Leads

- yt-dlp's SoundCloud user extractor reportedly handles `https://soundcloud.com/<user>/likes` as a playlist (flat extraction would give IDs/titles/durations without downloading). Verify it works, and whether it needs the OAuth token for a private likes page / full pagination.
- Alternative: SoundCloud API v2 `favorites` endpoint using the same OAuth token directly — possibly faster and richer metadata (uploader, duration, permalink, artwork) than yt-dlp extraction.
- Check what metadata each approach yields per item: stable track ID, title, uploader, duration, permalink — all needed for Source Items and matching.

## Answer

**Use SoundCloud API v2 directly for Refresh; keep yt-dlp for downloads only.** Verified 2026-07-02 against the real account (user `djreroll`, id 6871019, 592 likes).

- **API v2** (`GET https://api-v2.soundcloud.com/users/<id>/track_likes?limit=200`, header `Authorization: OAuth <token>`): returns pages of `{created_at, track}` with everything Source Items need — `track.id` (stable ID), `title`, `duration`/`full_duration` (ms), `permalink_url`, `user.username` (uploader), plus like `created_at`. Cursor pagination via top-level `next_href`; follow until absent. No `client_id` needed when the OAuth header is present. The user id comes from `GET /me` with the same header.
- **yt-dlp** `soundcloud:user` extractor does handle `https://soundcloud.com/<user>/likes`, but `--flat-playlist` entries carry only id/title/url (`duration`, `uploader`, `timestamp` all None) — full metadata would cost one extraction request per track (~592), plus it warns about missing impersonation deps. Rejected for enumeration.
- **Gotcha**: api-v2 returns 403 for the default `python-requests` user agent — send a browser-like `User-Agent` header. (Discovered during issue 02.)
- **Token**: the existing personal OAuth token (format `2-XXXXXX-XXXXXXX-XXXXXXXXXXXXXXXX`, from the user's yt-dlp history) works for both API v2 and yt-dlp `-u oauth -p <token>`. Goes in `config.toml` under a new `[soundcloud]` section; never log it.
- Download incantation for issue 05 (from history): `yt-dlp -x -f 'ba[acodec!=opus]'` with the same token.
