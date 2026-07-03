/**
 * Format a date string as relative time (e.g., "2 days ago", "just now")
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);
  const diffYear = Math.floor(diffDay / 365);

  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  // Each unit applies until a full quantity of the next unit has elapsed —
  // otherwise boundary days fall in a gap and floor to zero (e.g. day 28
  // was "0mo ago", day 364 "0y ago").
  if (diffMonth < 1) return `${diffWeek}w ago`;
  if (diffYear < 1) return `${diffMonth}mo ago`;
  return `${diffYear}y ago`;
}
