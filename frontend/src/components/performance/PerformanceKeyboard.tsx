import { useContext, useEffect, useRef, useState } from 'react';
import { DeckScope } from '../../contexts/DeckContext';
import { useViewActive } from '../../contexts/viewActive';
import { useBrowseActive } from '../../contexts/browseActive';
import { useDecks } from '../../hooks/useDeck';
import { dispatchFollow } from '../../follow/followStore';
import { getFollowParams, setFollowParams } from '../../follow/paramsStore';
import type { ChannelId } from '../../playback/mixer';
import type { Track } from '../../types';
import { sharedBrowseHandle } from '../browseHost';
import { DeckKeys } from './DeckKeys';
import { BeatFxKeys } from './BeatFxKeys';
import { hasKeyboardOverlay, isQuantizeShortcut, isTypingTarget } from './performanceKeys';
import { MixerContext } from '../../hooks/useMixer';
import { dispatchPerformanceFxKey, isPerformanceFxKey } from './performanceFxKeys';

export function PerformanceKeyboard({ deckCount, left, right, onLoad }: {
  deckCount: 2 | 4;
  left: ChannelId;
  right: ChannelId;
  onLoad: (deck: ChannelId, track: Track) => void;
}) {
  const active = useViewActive();
  const browseActive = useBrowseActive();
  const decks = useDecks();
  const mixer = useContext(MixerContext);
  const [library, setLibrary] = useState(false);
  const libraryFocus = library && browseActive;
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

  useEffect(() => {
    if (!active) return;
    const claim = (event: KeyboardEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const down = (event: KeyboardEvent) => {
      // TopBar owns plain '=', regardless of capture-listener registration order.
      if (isQuantizeShortcut(event)) return;
      const key = event.key.toLowerCase();
      const physical = event.code || key;
      if (blocked.current.has(physical)) { claim(event); return; }
      if (!event.repeat) held.current.add(physical);
      if (hasKeyboardOverlay() || event.defaultPrevented || event.isComposing) return;
      const modified = event.metaKey || event.ctrlKey || event.altKey;
      const typing = isTypingTarget(event);
      if (mixer && !typing && !libraryFocus && !modified && !event.shiftKey && /^[0-9-]$/.test(key)) {
        // Unmapped number-row keys stay unclaimed (they may get bindings later).
        if (event.repeat ? isPerformanceFxKey(key, deckCount) : dispatchPerformanceFxKey(key, mixer, deckCount)) {
          claim(event);
          return;
        }
      }
      if (!browseActive) return;
      // Tab also works inside search, but never hijacks other text editors.
      const search = event.target instanceof Element && event.target.matches('.filter-bar-search');
      if (key === 'tab' && !modified && (!typing || search)) {
        claim(event);
        if (!event.repeat) changeFocus(!library);
        return;
      }
      if (typing) return;
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

  return <div className="perf-keyboard-scope" data-library-focus={libraryFocus}>
    <DeckScope deck={left}><DeckKeys enabled={!libraryFocus} /></DeckScope>
    <DeckScope deck={right}><DeckKeys enabled={!libraryFocus} /></DeckScope>
    {mixer && <BeatFxKeys enabled={!libraryFocus} />}
  </div>;
}
