/**
 * Archived-track flag (sets 12): a Set containing an Archived Track is
 * FLAGGED — in the sidebar and the detail header — never silently
 * altered (archiving removes a Track from Playlists, but a Set is a
 * plan whose adjacencies the user reconciles; playback still works,
 * Archived audio remains on disk). The flag is computed server-side
 * (`has_archived_tracks` on every Set serialization) so both surfaces
 * read one source of truth.
 */

interface ArchivedTrackFlagProps {
  /** Compact renders the bare glyph (sidebar rows); full adds the label. */
  compact?: boolean;
  /** Titles of the archived tracks, when known (detail pane) — named in
   * the tooltip so the user can find and adjust them. */
  archivedTitles?: string[];
}

/** Badge for a Set containing at least one Archived Track. */
export function ArchivedTrackFlag({ compact = false, archivedTitles }: ArchivedTrackFlagProps) {
  const base = 'This set contains archived tracks — playback still works; reconcile when ready';
  const title =
    archivedTitles && archivedTitles.length > 0
      ? `${base}\nArchived: ${archivedTitles.join(', ')}`
      : base;
  return (
    <span
      title={title}
      style={{
        marginLeft: '8px',
        padding: compact ? '0 4px' : '0 6px',
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.05em',
        color: 'var(--base)',
        background: 'var(--orange, #ff8000)',
        whiteSpace: 'nowrap',
      }}
    >
      {compact ? '⚑' : '⚑ ARCHIVED TRACKS'}
    </span>
  );
}

/** Row-level mark on the archived track itself (Set detail rows) — the
 * set-level flag says "somewhere in here"; this says "this one". */
export function ArchivedTrackRowMark() {
  return (
    <span
      title="This track is archived — unarchive it from the Library's Archived view, or remove it from the set"
      style={{
        marginLeft: '8px',
        padding: '0 4px',
        fontSize: '10px',
        fontWeight: 700,
        color: 'var(--base)',
        background: 'var(--orange, #ff8000)',
        whiteSpace: 'nowrap',
      }}
    >
      ⚑ archived
    </span>
  );
}
