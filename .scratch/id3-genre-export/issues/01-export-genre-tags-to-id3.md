# Export Genre tags to ID3 genre field

Status: needs-triage

## Idea

The Genre Tag Category is authoritative; the ID3 genre field in audio files is untrusted and generally useless. A Sync/Export flow could write each Track's Genre tags into its file's ID3 genre field, so other software (and future re-imports) see the curated genre.

## Notes

- Direction is Export-only: ID3 → manadj should never overwrite Genre tags.
- Decide how to encode multiple Genre tags in one ID3 field (delimiter, primary-only, etc.).
- `backend/id3_utils.py` already handles ID3 access.
