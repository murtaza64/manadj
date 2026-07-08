/**
 * The global no-focus rule (keyboard-focus 01, PRD decision 1): one
 * mousedown listener in the capture phase at the app root that
 * `preventDefault()`s when the press would focus a button, checkbox,
 * or radio input. Click still activates the control; keyboard focus
 * never moves — so Space keeps meaning play/pause after any click, in
 * every view, for every future button, from one enforcement site.
 *
 * Opt-out: a control (or an ancestor) carrying `data-focusable` keeps
 * native focus behavior.
 *
 * Deliberately NOT covered:
 * - text-like inputs and textareas — typing needs focus;
 * - selects — preventing their mousedown stops the native picker from
 *   opening; they get blur-on-change instead (AutoBlurSelect);
 * - range inputs — the thumb drag / click-to-set behavior *is* the
 *   default action of mousedown, so preventing it makes the slider
 *   inert (keyboard-focus 03). They get blur-on-pointerup instead: the
 *   drag lands, then focus leaves so Space still means play/pause.
 */

/** Input types whose click-focus the rule suppresses (never typed into). */
const NO_FOCUS_INPUT_TYPES = new Set(['checkbox', 'radio']);

/**
 * The control a mousedown on `target` would ultimately focus, when that
 * control is one the rule covers. Labels resolve to the control they
 * wrap/reference (clicking a checkbox's label text focuses the checkbox).
 */
function coveredControl(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const hit = target.closest('button, input, label');
  if (!hit) return null;
  const control = hit instanceof HTMLLabelElement ? hit.control : hit;
  if (control instanceof HTMLButtonElement) return control;
  if (control instanceof HTMLInputElement && NO_FOCUS_INPUT_TYPES.has(control.type)) {
    return control;
  }
  return null;
}

/** True when the rule should suppress focus for a mousedown on `target`. */
export function stealsFocus(target: EventTarget | null): boolean {
  const control = coveredControl(target);
  if (!control) return false;
  return control.closest('[data-focusable]') === null;
}

/**
 * The range input a pointerup on `target` finished interacting with,
 * when the rule wants to shed its lingering focus. Unlike buttons, a
 * range can only be reached by a real press on the thumb/track, so we
 * resolve the pressed control directly (no label indirection needed).
 */
function rangeToBlur(target: EventTarget | null): HTMLInputElement | null {
  if (!(target instanceof Element)) return null;
  const control = target.closest('input');
  if (!(control instanceof HTMLInputElement) || control.type !== 'range') return null;
  return control.closest('[data-focusable]') === null ? control : null;
}

/**
 * Install the rule on the document. Returns the uninstaller, so it can be
 * the body of a mount effect (StrictMode-safe: setup/cleanup are paired).
 */
export function installNoFocusRule(): () => void {
  const onMouseDown = (event: MouseEvent) => {
    if (stealsFocus(event.target)) event.preventDefault();
  };
  // Ranges keep native mousedown (the drag *is* the default action), but
  // shed focus once the interaction ends so Space still means play/pause.
  const onPointerUp = (event: PointerEvent) => {
    rangeToBlur(event.target)?.blur();
  };
  document.addEventListener('mousedown', onMouseDown, { capture: true });
  document.addEventListener('pointerup', onPointerUp, { capture: true });
  return () => {
    document.removeEventListener('mousedown', onMouseDown, { capture: true });
    document.removeEventListener('pointerup', onPointerUp, { capture: true });
  };
}
