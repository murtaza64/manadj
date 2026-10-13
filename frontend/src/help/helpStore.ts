import { helpHref } from './routes';

interface HelpSession { href: string; navigation: number; opener: HTMLElement | null }
let session: HelpSession | null = null;
let navigation = 0;
const listeners = new Set<() => void>();
export const helpSnapshot = () => session;
export const isHelpOpen = () => session !== null;
export function subscribeHelp(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function openHelp(topic?: string, anchor?: string): boolean {
  const href = helpHref(topic, anchor);
  if (!href) return false;
  session = { href, navigation: ++navigation, opener: session ? session.opener : (document.activeElement as HTMLElement | null) };
  listeners.forEach((listener) => listener());
  return true;
}

export function closeHelp() {
  if (!session) return;
  session = null;
  listeners.forEach((listener) => listener());
}
