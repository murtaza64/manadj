const heldReleases = new WeakSet<KeyboardEvent>();

export function isModalHeldRelease(event: KeyboardEvent): boolean {
  return heldReleases.has(event);
}

/** Observe app-claimed downs before a modal opens; forward only their real
 * releases, even if focus has since moved to a modal text field. */
export function installModalKeyGuard(isOpen: () => boolean, close: () => void): () => void {
  const held = new Set<string>();
  const blocked = new Set<string>();
  const identity = (e: KeyboardEvent) => e.code || e.key.toLowerCase();
  const remember = (e: KeyboardEvent) => {
    if (!isOpen() && e.defaultPrevented) held.add(identity(e));
  };
  const guard = (e: KeyboardEvent) => {
    const key = identity(e);
    const open = isOpen();
    if (e.type === 'keyup') {
      const release = held.delete(key);
      const suppressed = blocked.delete(key);
      if (release && open) { heldReleases.add(e); return; }
      if (!open && !suppressed) return;
    } else {
      if (!open && !blocked.has(key)) return;
      if (e.type === 'keydown' && !held.has(key)) blocked.add(key);
    }
    e.stopImmediatePropagation();
    if (open && e.type === 'keydown' && e.key === 'Escape') { e.preventDefault(); close(); }
  };
  const clear = () => { held.clear(); blocked.clear(); };
  window.addEventListener('keydown', remember);
  window.addEventListener('blur', clear);
  for (const type of ['keydown', 'keyup', 'keypress'] as const) window.addEventListener(type, guard, true);
  return () => {
    window.removeEventListener('keydown', remember);
    window.removeEventListener('blur', clear);
    for (const type of ['keydown', 'keyup', 'keypress'] as const) window.removeEventListener(type, guard, true);
  };
}
