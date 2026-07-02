# Investigate: scanning SoundCloud likes

Status: needs-triage
Type: research

## Question

How do we programmatically list a user's SoundCloud likes (for Refresh)? Current workflow passes individual track URLs to yt-dlp with an OAuth token; nothing scans the likes list.

## Leads

- yt-dlp's SoundCloud user extractor reportedly handles `https://soundcloud.com/<user>/likes` as a playlist (flat extraction would give IDs/titles/durations without downloading). Verify it works, and whether it needs the OAuth token for a private likes page / full pagination.
- Alternative: SoundCloud API v2 `favorites` endpoint using the same OAuth token directly — possibly faster and richer metadata (uploader, duration, permalink, artwork) than yt-dlp extraction.
- Check what metadata each approach yields per item: stable track ID, title, uploader, duration, permalink — all needed for Source Items and matching.

## Answer

(pending)
