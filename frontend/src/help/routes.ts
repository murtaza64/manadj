import manifest from '../../../site/help/manifest.json';

export const HELP_TOPICS = manifest;
export interface HelpTarget { topic?: string; anchor?: string }

/** Only manifest routes can be opened by app callers. Invalid input is rejected. */
export function helpHref(topic?: string, anchor?: string, base = import.meta.env.BASE_URL): string | null {
  if (topic === undefined) return anchor === undefined ? `${base}manual/help/index.html` : null;
  const article = HELP_TOPICS.find(({ slug }) => slug === topic);
  if (!article || (anchor !== undefined && !article.anchors.includes(anchor))) return null;
  return `${base}manual/help/${article.slug}/index.html${anchor === undefined ? '' : `#${anchor}`}`;
}

/** Article links may also reach the bundled feature tour and media files. */
export function isManualUrl(href: string, base = import.meta.env.BASE_URL, origin = location.href): boolean {
  try {
    const root = new URL(`${base}manual/`, origin);
    const url = new URL(href, origin);
    return url.origin === root.origin && url.protocol === root.protocol
      && url.pathname.startsWith(root.pathname)
      && !/%(?:2e|2f|5c)/i.test(url.pathname)
      && !url.username && !url.password;
  } catch {
    return false;
  }
}
