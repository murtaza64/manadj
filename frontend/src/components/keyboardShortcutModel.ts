import { DECK_KEYS } from './performance/performanceKeys';
import { PERFORMANCE_FX_KEYS } from './performance/performanceFxKeys';

export type KeyboardHelpScope = 'global' | 'performance' | 'browse' | 'library' | 'editors';
export interface KeyboardKey { id: string; label: string; width?: number }
export interface KeyboardAction { action: string; modifier?: string }

const key = (id: string, label = id, width?: number): KeyboardKey => ({ id, label, width });
export const KEYBOARD_ROWS: readonly KeyboardKey[][] = [
  [key('Escape', 'Esc', 1.4), ...Array.from({ length: 12 }, (_, i) => key(`F${i + 1}`))],
  [key('`'), ...'1234567890-='.split('').map((label) => key(label)), key('Backspace', 'Backspace', 2)],
  [key('Tab', 'Tab', 1.5), ...'QWERTYUIOP[]\\'.split('').map((label) => key(label))],
  [key('CapsLock', 'Caps', 1.8), ..."ASDFGHJKL;'".split('').map((label) => key(label)), key('Enter', 'Enter', 1.8)],
  [key('ShiftLeft', 'Shift', 2.3), ...'ZXCVBNM,./'.split('').map((label) => key(label)), key('ShiftRight', 'Shift', 2.3)],
  [key('ControlLeft', 'Ctrl', 1.4), key('AltLeft', 'Alt', 1.4), key('Meta', 'Cmd', 1.4), key('Space', 'Space', 6), key('ArrowLeft', '←'), key('ArrowUp', '↑'), key('ArrowDown', '↓'), key('ArrowRight', '→')],
  [key('Insert', 'Ins'), key('Home'), key('PageUp', 'PgUp'), key('Delete', 'Del'), key('End'), key('PageDown', 'PgDn')],
];

const charId = (value: string) => value.length === 1 ? value.toUpperCase() : value;
const add = (map: Map<string, KeyboardAction[]>, id: string, action: string, modifier?: string) => {
  const actions = map.get(id) ?? [];
  actions.push({ action, modifier });
  map.set(id, actions);
};

export function keyboardActions(scope: KeyboardHelpScope): ReadonlyMap<string, KeyboardAction[]> {
  const map = new Map<string, KeyboardAction[]>();
  if (scope === 'global') {
    add(map, '`', 'Performance ↔ Library');
    add(map, '=', 'Quantize');
    add(map, '/', 'Keyboard map', 'Shift');
    add(map, 'F1', 'Keyboard map');
    add(map, 'F', 'Focus search', 'Cmd/Ctrl');
    add(map, 'Escape', 'Close / cancel');
    return map;
  }
  if (scope === 'performance') {
    const hands = [['Left', DECK_KEYS.A], ['Right', DECK_KEYS.B]] as const;
    for (const [hand, keys] of hands) {
      add(map, charId(keys.play), `${hand} play`);
      add(map, charId(keys.cue), `${hand} cue (hold)`);
      add(map, charId(keys.loop), `${hand} loop`);
      add(map, charId(keys.jumpBack), `${hand} jump ←`);
      add(map, charId(keys.jumpForward), `${hand} jump →`);
      add(map, charId(keys.jumpBack), 'Jump size ÷2', 'Shift');
      add(map, charId(keys.jumpForward), 'Jump size ×2', 'Shift');
      add(map, charId(keys.knobs.filter), `${hand} filter + mouse`);
      add(map, charId(keys.knobs.high), `${hand} high + mouse`);
      add(map, charId(keys.knobs.mid), `${hand} mid + mouse`);
      add(map, charId(keys.knobs.low), `${hand} low + mouse`);
      add(map, charId(keys.fader), `${hand} volume + mouse`);
      add(map, charId(keys.jog), `${hand} jog + mouse`);
      add(map, charId(keys.jog), `${hand} scratch + mouse`, 'Shift');
      keys.pads.forEach((pad, i) => {
        add(map, charId(pad), `${hand} hot cue ${i + 1}`);
        add(map, charId(pad), `Clear cue ${i + 1}`, 'Shift');
      });
    }
    add(map, '[', 'Focus A ↔ C'); add(map, ']', 'Focus B ↔ D');
    add(map, 'Tab', 'Library keyboard');
    add(map, 'ArrowLeft', 'Load focused left'); add(map, 'ArrowRight', 'Load focused right');
    add(map, 'Enter', 'Load focused left');
    for (const [key, target] of Object.entries(PERFORMANCE_FX_KEYS.targets)) {
      add(map, key, `FX target ${target === 'master' ? 'MST' : target}`);
    }
    add(map, PERFORMANCE_FX_KEYS.beatHalve, 'FX length ÷2');
    add(map, PERFORMANCE_FX_KEYS.beatDouble, 'FX length ×2');
    add(map, PERFORMANCE_FX_KEYS.effectPrevious, 'FX type previous');
    add(map, PERFORMANCE_FX_KEYS.effectNext, 'FX type next');
    add(map, PERFORMANCE_FX_KEYS.depth, 'FX depth + mouse');
    add(map, PERFORMANCE_FX_KEYS.toggle, 'FX on/off');
    add(map, '=', 'Quantize');
    return map;
  }
  if (scope === 'browse') {
    // Perform's browse panel (#337). Two layers: deck focus (always live)
    // and library focus (Tab). Tagged legends name the layer.
    add(map, 'Tab', 'Library keyboard ↔ decks');
    add(map, 'ArrowDown', 'Next track'); add(map, 'ArrowUp', 'Previous track');
    add(map, 'ArrowLeft', 'Load focused left', 'Decks'); add(map, 'ArrowRight', 'Load focused right', 'Decks');
    add(map, 'Enter', 'Load focused left', 'Decks');
    add(map, 'F', 'Focus search', 'Cmd/Ctrl');
    add(map, 'Escape', 'Clear search', 'Decks');
    add(map, 'Escape', 'Back to decks', 'Lib');
    add(map, 'J', 'Next track', 'Lib'); add(map, 'K', 'Previous track', 'Lib');
    add(map, 'J', 'Extend selection', 'Lib+Shift'); add(map, 'K', 'Extend selection', 'Lib+Shift');
    add(map, 'ArrowDown', 'Extend selection', 'Lib+Shift'); add(map, 'ArrowUp', 'Extend selection', 'Lib+Shift');
    add(map, 'D', 'Half page down', 'Lib+Ctrl'); add(map, 'U', 'Half page up', 'Lib+Ctrl');
    add(map, 'PageDown', 'Page down', 'Lib'); add(map, 'PageUp', 'Page up', 'Lib');
    add(map, 'Home', 'First track', 'Lib'); add(map, 'End', 'Last track', 'Lib');
    add(map, 'A', 'Select all', 'Lib+Cmd/Ctrl');
    add(map, 'H', 'Sidebar', 'Lib'); add(map, 'L', 'Track list', 'Lib');
    add(map, 'Enter', 'Open sidebar item', 'Lib');
    for (const deck of ['A', 'B', 'C', 'D']) {
      add(map, deck, `Load onto ${deck}`, 'Lib');
      add(map, deck, `Follow ${deck}`, 'Lib+Shift');
    }
    add(map, '/', 'Search', 'Lib');
    add(map, 'F', 'Follow parameters', 'Lib');
    add(map, 'N', 'Known only', 'Lib');
    return map;
  }
  if (scope === 'library') {
    add(map, 'J', 'Next track'); add(map, 'K', 'Previous track');
    add(map, 'ArrowDown', 'Next track'); add(map, 'ArrowUp', 'Previous track');
    add(map, 'Tab', 'Next browse area'); add(map, 'Tab', 'Previous browse area', 'Shift');
    add(map, 'PageDown', 'Page down'); add(map, 'PageUp', 'Page up');
    add(map, 'Home', 'First track'); add(map, 'End', 'Last track');
    add(map, 'Delete', 'Remove from playlist'); add(map, 'Backspace', 'Remove from playlist');
    add(map, 'Enter', 'Open / load'); add(map, 'Space', 'Play / pause');
    add(map, 'A', 'Beatjump back'); add(map, 'S', 'Beatjump forward');
    add(map, 'F', 'Cue (hold)'); add(map, 'R', 'Loop');
    add(map, 'H', 'Scrub back'); add(map, 'L', 'Scrub forward');
    add(map, 'H', 'Grid nudge earlier', 'Shift'); add(map, 'L', 'Grid nudge later', 'Shift');
    add(map, 'G', 'Set downbeat'); add(map, 'T', 'Edit tags'); add(map, 'E', 'Edit energy');
    add(map, 'V', 'Toggle split view');
    for (let i = 1; i <= 8; i++) {
      add(map, String(i), `Hot cue ${i}`); add(map, String(i), `Clear cue ${i}`, 'Shift');
    }
    return map;
  }
  add(map, 'Space', 'Audition play / pause');
  add(map, 'ArrowUp', 'Previous track'); add(map, 'ArrowDown', 'Next track');
  add(map, 'ArrowLeft', 'Assign outgoing / A'); add(map, 'ArrowRight', 'Assign incoming / B');
  add(map, 'Enter', 'Assign outgoing / A');
  add(map, 'V', 'Select tool'); add(map, 'H', 'Pan tool'); add(map, 'J', 'Jump tool');
  add(map, 'Z', 'Undo', 'Cmd/Ctrl'); add(map, 'Z', 'Redo', 'Cmd/Ctrl+Shift');
  add(map, 'Backspace', 'Delete selection'); add(map, 'Delete', 'Delete selection');
  add(map, 'Escape', 'Cancel / clear selection');
  return map;
}
