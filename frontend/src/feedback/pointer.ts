/**
 * Point-at-element picking (feedback #518): the reporter indicates WHICH
 * element a report is about. The descriptor is bounded and redacted —
 * tag/role/aria-label/short visible text/viewport bounds, never input
 * values, option lists, or [data-feedback-private] subtrees.
 */
import { redact } from './diagnostics';

export interface PointerInfo {
  tag: string;
  id: string | null;
  role: string | null;
  label: string | null;
  text: string | null;
  /** CSS-pixel bounds in viewport coordinates (screenshot space). */
  rect: { x: number; y: number; width: number; height: number };
}

export function describeElement(el: Element): PointerInfo {
  const rect = el.getBoundingClientRect();
  const attr = (name: string, limit: number): string | null => {
    if (el.closest('[data-feedback-private]')) return null;
    const value = el.getAttribute(name)?.trim();
    return value ? redact(value, limit) : null;
  };
  // Free text only from leaf-ish, non-input elements: input values and
  // option contents can hold private text and are never described.
  let text: string | null = null;
  if (
    !(el instanceof HTMLInputElement) &&
    !(el instanceof HTMLTextAreaElement) &&
    !(el instanceof HTMLSelectElement) &&
    !el.closest('[data-feedback-private]')
  ) {
    const safe = el.cloneNode(true) as Element;
    safe.querySelectorAll('[data-feedback-private],input,textarea,select,option').forEach((node) => node.remove());
    const raw = (safe.textContent ?? '').trim().replace(/\s+/g, ' ');
    if (raw && raw.length <= 200) text = redact(raw, 80);
  }
  return {
    tag: redact(el.tagName.toLowerCase(), 32),
    id: attr('id', 64),
    role: attr('role', 40),
    label: attr('aria-label', 120) ?? attr('title', 120),
    text,
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}

/**
 * Fullscreen pick: the next click describes the element under it without
 * triggering that element (the paired click is swallowed); Esc cancels
 * (resolves null). A hover box follows the element under the cursor.
 */
export function pickElement(): Promise<PointerInfo | null> {
  return new Promise((resolve) => {
    let settled = false;
    let picked: PointerInfo | null = null;
    // A manual popover sits in the top layer (reachable even while a modal
    // setup/picker dialog is open) WITHOUT inerting the app beneath it the
    // way showModal would — elementFromPoint must still see real elements.
    const overlay = document.createElement('div');
    overlay.className = 'feedback-picker';
    overlay.setAttribute('role', 'presentation');
    (overlay as HTMLElement & { popover: string }).popover = 'manual';
    const box = document.createElement('div');
    box.className = 'feedback-picker-box';
    box.hidden = true;
    const hint = document.createElement('div');
    hint.className = 'feedback-picker-hint';
    hint.textContent = 'Click the element this report is about. Esc cancels.';
    overlay.append(box, hint);

    const finish = (value: PointerInfo | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(value);
    };
    const underCursor = (event: MouseEvent): Element | null => {
      // elementFromPoint must see past the overlay; pointer-events:none
      // inherits to the hint/box children, so nothing of ours is found.
      overlay.style.pointerEvents = 'none';
      try {
        const target = document.elementFromPoint(event.clientX, event.clientY);
        return target && !overlay.contains(target) ? target : null;
      } finally {
        overlay.style.pointerEvents = '';
      }
    };
    overlay.addEventListener('pointermove', (event) => {
      const target = underCursor(event);
      if (!target) {
        box.hidden = true;
        return;
      }
      const rect = target.getBoundingClientRect();
      box.hidden = false;
      box.style.left = `${rect.x}px`;
      box.style.top = `${rect.y}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
    });
    overlay.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const target = underCursor(event);
      picked = target ? describeElement(target) : null;
      // Do not finish here: the paired click still fires and must be
      // swallowed by the capture-phase click listener below.
    });
    const onClick = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      finish(picked);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finish(null);
    };
    // Popover light-dismiss (Esc) also cancels the pick.
    overlay.addEventListener('close', () => finish(null));
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    try {
      (overlay as HTMLElement & { showPopover(): void }).showPopover();
    } catch { /* Non-top-layer runtime (jsdom): fixed positioning still covers. */ }
  });
}
