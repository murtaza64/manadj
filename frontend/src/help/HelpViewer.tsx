import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Modal from '../components/Modal';
import { closeHelp, helpSnapshot, openHelp, subscribeHelp } from './helpStore';
import { isManualUrl } from './routes';
import './help.css';

const FOCUSABLE = 'button, a[href], input, select, textarea, summary, video[controls], audio[controls], iframe, [tabindex]';
function focusable(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => {
    if ((node.tabIndex < 0 && !node.matches('video[controls], audio[controls]'))
      || node.matches(':disabled') || node.closest('[hidden], [inert]')) return false;
    if (node.closest('details:not([open])') && node.tagName !== 'SUMMARY') return false;
    for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) {
      const style = node.ownerDocument.defaultView?.getComputedStyle(parent);
      if (style?.display === 'none' || style?.visibility === 'hidden') return false;
    }
    return true;
  });
}

function HelpDialog({ href, navigation, opener }: { href: string; navigation: number; opener: HTMLElement | null }) {
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const detachFrame = useRef<() => void>(() => {});

  const frameDocument = () => {
    try { return frame.current?.contentDocument ?? null; } catch { return null; }
  };
  const outerNodes = () => focusable(host.current!).filter((node) => node !== frame.current);
  const focusFrame = (last: boolean) => {
    const doc = frameDocument();
    const nodes = doc ? focusable(doc) : [];
    (last ? nodes.at(-1) : nodes[0])?.focus();
    if (!nodes.length) frame.current?.focus();
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeHelp();
    return true;
  };

  const bindFrame = () => {
    detachFrame.current();
    const doc = frameDocument();
    if (!doc) return;
    const onKey = (event: KeyboardEvent) => {
      if (escape(event) || event.key !== 'Tab') return;
      const nodes = focusable(doc);
      const active = doc.activeElement;
      if (!nodes.length || (event.shiftKey && (active === nodes[0] || active === doc.body))
        || (!event.shiftKey && active === nodes.at(-1))) {
        event.preventDefault();
        const outer = outerNodes();
        (event.shiftKey ? outer.at(-1) : outer[0])?.focus();
      }
    };
    const onLink = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (!link) return;
      let url: URL;
      try { url = new URL(link.getAttribute('href')!, doc.baseURI); } catch {
        event.preventDefault();
        return;
      }
      if (!isManualUrl(url.href)) {
        event.preventDefault();
        return;
      }
      // Keep native article/hash navigation, but all activations stay in this
      // frame. The sandbox also denies popups, scripts and top navigation.
      link.setAttribute('target', '_self');
      link.removeAttribute('download');
      if (event.type === 'auxclick' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        event.preventDefault();
        if (event.button <= 1) doc.defaultView?.location.assign(url.href);
      }
    };
    doc.addEventListener('keydown', onKey, true);
    doc.addEventListener('click', onLink, true);
    doc.addEventListener('auxclick', onLink, true);
    detachFrame.current = () => {
      doc.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('click', onLink, true);
      doc.removeEventListener('auxclick', onLink, true);
    };
  };

  useLayoutEffect(() => {
    const panel = host.current!.querySelector<HTMLElement>('[role="dialog"]')!;
    panel.setAttribute('aria-label', 'Help manual');
    const onKey = (event: KeyboardEvent) => {
      if (escape(event) || event.key !== 'Tab') return;
      const nodes = outerNodes();
      const active = document.activeElement;
      if ((event.shiftKey && active === nodes[0]) || (!event.shiftKey && active === nodes.at(-1))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        focusFrame(event.shiftKey);
      } else if (active === frame.current || !panel.contains(active)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        (event.shiftKey ? nodes.at(-1) : nodes[0])?.focus();
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (!panel.contains(event.target as Node)) outerNodes()[0]?.focus();
    };
    // Window capture precedes the underlying Modal's document Escape listener,
    // regardless of mount order. Do not let a nested close reach that listener.
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('focusin', onFocus, true);
    outerNodes()[0]?.focus();
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('focusin', onFocus, true);
      detachFrame.current();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
    // One focus session across article navigation; the opener never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="help-host" data-tour-suppress="" data-focusable="" onKeyDown={(event) => event.stopPropagation()}>
    <Modal title="Help manual" className="help-panel" onClose={closeHelp}>
      <nav className="help-toolbar" aria-label="Help navigation">
        <button type="button" className="btn btn-secondary" onClick={() => openHelp()}>Help index</button>
      </nav>
      <iframe key={navigation} ref={frame} className="help-frame" title="Help article" src={href}
        sandbox="allow-same-origin" onLoad={bindFrame} />
    </Modal>
  </div>;
}

/** Mount once alongside the app shell; portals keep it above nested guides. */
export function HelpViewer() {
  const session = useSyncExternalStore(subscribeHelp, helpSnapshot);
  return session ? createPortal(<HelpDialog {...session} />, document.body) : null;
}
