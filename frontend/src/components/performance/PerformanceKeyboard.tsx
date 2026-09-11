import { useEffect, useRef, useState } from 'react';
import { DeckScope } from '../../contexts/DeckContext';
import { useViewActive } from '../../contexts/viewActive';
import { useDecks } from '../../hooks/useDeck';
import { dispatchFollow } from '../../follow/followStore';
import { getFollowParams, setFollowParams } from '../../follow/paramsStore';
import type { ChannelId } from '../../playback/mixer';
import type { Track } from '../../types';
import { sharedBrowseHandle } from '../browseHost';
import { DeckKeys } from './DeckKeys';
import { hasKeyboardOverlay, isTypingTarget } from './performanceKeys';

const shortcuts = [
  ['Tab / Esc', 'Return to decks'],
  ['j / k or Down / Up', 'Next / previous track'],
  ['Shift+J / K', 'Extend selection'],
  ['Ctrl+D / U', 'Down / up half a page'],
  ['PageDown / PageUp', 'Down / up a page'],
  ['Home / End', 'First / last track'],
  ['Cmd/Ctrl+A', 'Select all visible tracks'],
  ['h / l', 'Sidebar / track list'],
  ['Enter', 'Open sidebar item'],
  ['a / b / c / d', 'Load selected track onto deck'],
  ['Shift+A / B / C / D', 'Follow loaded deck track'],
  ['/', 'Search (Enter / Esc returns to results)'],
  ['f / n', 'Follow parameters / Known only'],
  ['?', 'Keyboard help'],
];

export function PerformanceKeyboard({ deckCount, left, right, onLoad }: {
  deckCount: 2 | 4;
  left: ChannelId;
  right: ChannelId;
  onLoad: (deck: ChannelId, track: Track) => void;
}) {
  const active = useViewActive();
  const decks = useDecks();
  const [library, setLibrary] = useState(false);
  const [help, setHelp] = useState(false);
  const held = useRef(new Set<string>());
  const blocked = useRef(new Set<string>());
  const changeFocus = (next: boolean) => {
    // A press belongs to its original mode, even across a quick Tab round-trip.
    if (library !== next) {
      for (const key of held.current) blocked.current.add(key);
      setLibrary(next);
    }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };
  const changeHelp = (next: boolean) => {
    for (const key of held.current) blocked.current.add(key);
    setHelp(next);
  };

  useEffect(() => {
    if (!active) return;
    const claim = (event: KeyboardEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const physical = event.code || key;
      if (blocked.current.has(physical)) { claim(event); return; }
      if (!event.repeat) held.current.add(physical);
      if (help) {
        if (key === 'escape' || key === '?') { claim(event); changeHelp(false); }
        return;
      }
      if (hasKeyboardOverlay() || event.defaultPrevented || event.isComposing) return;
      const modified = event.metaKey || event.ctrlKey || event.altKey;
      // Tab also works inside search, but never hijacks other text editors.
      const search = event.target instanceof Element && event.target.matches('.filter-bar-search');
      if (key === 'tab' && !modified && (!isTypingTarget(event) || search)) {
        claim(event);
        if (!event.repeat) changeFocus(!library);
        return;
      }
      if (isTypingTarget(event)) return;
      if (key === '?' && !modified) { claim(event); if (!event.repeat) changeHelp(true); return; }
      if (!library || key === '`') return;
      const browse = sharedBrowseHandle.current;
      if (!event.altKey && !event.shiftKey && (event.metaKey || event.ctrlKey) && key === 'a') {
        claim(event); browse?.selectAll(); return;
      }
      if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && (key === 'd' || key === 'u')) {
        claim(event); browse?.navigatePage(key === 'd' ? 1 : -1, true); return;
      }
      if (modified) return;
      if (key === 'escape') { claim(event); changeFocus(false); return; }
      if (key === 'j' || key === 'k' || key === 'arrowdown' || key === 'arrowup') {
        claim(event); browse?.navigate(key === 'j' || key === 'arrowdown' ? 1 : -1, event.shiftKey); return;
      }
      if (key === 'home' || key === 'end') { claim(event); browse?.navigateEnd(key === 'home' ? -1 : 1); return; }
      if (key === 'pagedown' || key === 'pageup') { claim(event); browse?.navigatePage(key === 'pagedown' ? 1 : -1); return; }
      if (key === 'h' || key === 'l') { claim(event); browse?.areaMove(key === 'h' ? -1 : 1); return; }
      if (key === 'enter') {
        if (event.target instanceof Element && event.target.closest('button')) return;
        claim(event); if (!event.repeat) browse?.activate(); return;
      }
      if (/^[abcd]$/.test(key)) {
        claim(event);
        if (event.repeat) return;
        const deck = key.toUpperCase() as ChannelId;
        if (event.shiftKey) dispatchFollow({ type: 'toggle', deck, loaded: decks[deck].loadedTrack !== null });
        else {
          if (deckCount === 2 && (deck === 'C' || deck === 'D')) return;
          const track = browse?.getSelectedTrack();
          if (track) onLoad(deck, track);
        }
        return;
      }
      if (key === '/' || key === 'f' || key === 'n') {
        claim(event);
        if (event.repeat) return;
        if (key === '/') browse?.focusSearch();
        if (key === 'f') browse?.openFollowParams();
        if (key === 'n') setFollowParams({ knownOnly: !getFollowParams().knownOnly });
        return;
      }
      // Unmapped library letters must not fall through to deck/Set transport.
      if (key.length === 1 || key.startsWith('arrow')) claim(event);
    };
    const up = (event: KeyboardEvent) => {
      const physical = event.code || event.key.toLowerCase();
      held.current.delete(physical);
      if (blocked.current.delete(physical)) claim(event);
    };
    const blur = () => { held.current.clear(); blocked.current.clear(); };
    document.addEventListener('keydown', down, true);
    document.addEventListener('keyup', up, true);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('keydown', down, true);
      document.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', blur);
    };
  });

  return <div className="perf-keyboard-scope" data-library-focus={library}>
    <DeckScope deck={left}><DeckKeys enabled={!library && !help} /></DeckScope>
    <DeckScope deck={right}><DeckKeys enabled={!library && !help} /></DeckScope>
    {active && help && <div className="perf-keyboard-help-backdrop" onClick={() => changeHelp(false)}>
      <section className="perf-keyboard-help" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={e => e.stopPropagation()}>
        <header><strong>{library ? 'LIBRARY' : 'DECKS'} KEYBOARD</strong><button onClick={() => changeHelp(false)}>Close (Esc)</button></header>
        {library ? <dl>{shortcuts.map(([key, action]) => <div key={key}><dt>{key}</dt><dd>{action}</dd></div>)}</dl> : <p>On-control labels show deck keys. Hold mixer or jog keys and move the mouse. Use [ / ] to switch A/C and B/D. Tab enters library navigation.</p>}
        {library && <p>Loads keep library focus. Playing decks are locked. C/D loads are unavailable in two-deck layout. Follow uses loaded tracks, not the selected row.</p>}
      </section>
    </div>}
  </div>;
}
