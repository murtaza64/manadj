/** Modal chrome for Setup guides and the sequence (First run, Settings
 * relaunch). Wears `data-tour-suppress` so the feature tour waits until
 * setup is out of the way (TourController). */
import { useEffect, useRef, type ReactNode } from 'react';
import Modal from '../components/Modal';
import { isHelpOpen } from '../help/helpStore';
import './setup.css';

export function SetupOverlay({ children, testId, onClose }: { children: ReactNode; testId?: string; onClose: () => void }) {
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panel = wrapper.current?.querySelector<HTMLElement>('[role="dialog"]');
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.tabIndex = -1;
    panel.setAttribute('aria-label', 'manaDJ Setup');
    panel.focus();
    const trap = (event: KeyboardEvent) => {
      if (isHelpOpen()) return;
      if (event.key !== 'Tab') return;
      const nodes = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]')]
        .filter((node) => !node.closest('details:not([open])') || node.tagName === 'SUMMARY');
      const first = nodes[0];
      const last = nodes.at(-1);
      const focusInside = panel.contains(document.activeElement);
      if (!first) {
        event.preventDefault(); panel.focus();
      } else if (event.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement as HTMLElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !focusInside || !nodes.includes(document.activeElement as HTMLElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', trap, true);
    return () => { document.removeEventListener('keydown', trap, true); previous?.focus(); };
  }, []);
  return (
    <div ref={wrapper} className="setup-overlay-host" data-tour-suppress="" data-testid={testId}>
      <Modal className="setup-panel" onClose={onClose}>{children}</Modal>
    </div>
  );
}
