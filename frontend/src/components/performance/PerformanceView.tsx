/**
 * The Performance view (performance-mode issues 03/04/05): two-deck surface
 * over an embedded Library. Layout per the prototype verdict (PRD Further
 * Notes) — top 50vh: stacked full-width waveforms, then Deck A | Mixer |
 * Deck B; bottom 50vh: the real Library browse surface (browseOnly) with
 * per-row load-to-A/B buttons.
 *
 * This view owns its keyboard outright (issue 04): per-deck DeckKeys hubs
 * inside each scope, table keys here (↑/↓ navigate, ←/→ load to A/B,
 * Enter = A). Space is deliberately unbound — single-deck muscle memory
 * must not toggle a live deck. The embedded library mounts no hub.
 *
 * Load lock (view policy, not provider): a Load onto an audibly-running
 * deck is refused with a hint — in this view a deck is replaced only
 * deliberately. The library view keeps replace-freely.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Library from '../Library';
import type { LibraryBrowseHandle } from '../Library';
import { DeckScope } from '../../contexts/DeckContext';
import { useDecks } from '../../hooks/useDeck';
import type { DeckEngine } from '../../playback/DeckEngine';
import type { ChannelId } from '../../playback/mixer';
import type { Track } from '../../types';
import { DeckPanel, DeckWaveform } from './DeckPanel';
import { MixerPanel } from './MixerPanel';
import { DeckKeys } from './DeckKeys';
import { isGuardedKeyEvent } from './performanceKeys';
import { DEFAULT_VISIBLE_SECONDS } from '../../utils/waveformZoom';
import './PerformanceView.css';

const LOCK_HINT_MS = 1500;

/** True while a Load onto this deck must be refused (audible or about to be). */
function isDeckLocked(engine: DeckEngine): boolean {
  return engine.isAudioRunning() || engine.getSnapshot().pendingPlay;
}

/** Reactive version of the lock, for styling the row affordances. */
function useDeckLocked(engine: DeckEngine): boolean {
  return useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => isDeckLocked(engine)
  );
}

export function PerformanceView() {
  const { A, B } = useDecks();
  const libraryRef = useRef<LibraryBrowseHandle>(null);

  // ── Load lock ──────────────────────────────────────────────────────────
  const [lockHint, setLockHint] = useState<ChannelId | null>(null);
  const lockHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (lockHintTimer.current) clearTimeout(lockHintTimer.current);
  }, []);

  // All load paths in this view (row buttons, double-click, ←/→/Enter) go
  // through here. Engines and per-deck loadTrack are identity-stable, so
  // this callback is too (memoized rows depend on it).
  const engineA = A.engine;
  const engineB = B.engine;
  const loadA = A.loadTrack;
  const loadB = B.loadTrack;
  const tryLoad = useCallback(
    (deck: ChannelId, track: Track) => {
      const engine = deck === 'A' ? engineA : engineB;
      if (isDeckLocked(engine)) {
        setLockHint(deck);
        if (lockHintTimer.current) clearTimeout(lockHintTimer.current);
        lockHintTimer.current = setTimeout(() => setLockHint(null), LOCK_HINT_MS);
        return;
      }
      (deck === 'A' ? loadA : loadB)(track);
    },
    [engineA, engineB, loadA, loadB]
  );

  // Reactive lock state dims the matching row affordances (pure CSS below).
  const lockedA = useDeckLocked(engineA);
  const lockedB = useDeckLocked(engineB);

  // ── Table keys: ↑/↓ navigate, ← load A, → load B, Enter = A ───────────
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isGuardedKeyEvent(event)) return;

      // Space is deliberately unbound in this view (confirmed decision):
      // claim it so it neither scrolls nor re-activates a focused control.
      if (event.key === ' ') {
        event.preventDefault();
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        libraryRef.current?.navigate(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const selected = libraryRef.current?.getSelectedTrack();
        if (!selected) return;
        event.preventDefault();
        tryLoad(event.key === 'ArrowLeft' ? 'A' : 'B', selected);
        return;
      }

      // Enter loads to A — but not from a focused button (library-hub parity).
      if (event.key === 'Enter') {
        const target = event.target as HTMLElement;
        if (target.tagName === 'BUTTON') return;
        const selected = libraryRef.current?.getSelectedTrack();
        if (!selected) return;
        event.preventDefault();
        tryLoad('A', selected);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [tryLoad]);

  // One zoom for both waveforms, in visible seconds (issue 05): equal
  // effective BPM must mean equal beat spacing on screen. Survives loads —
  // each waveform re-derives its track-relative factor from this value.
  const [visibleSeconds, setVisibleSeconds] = useState(DEFAULT_VISIBLE_SECONDS);

  return (
    <div className="perf-root">
      {/* Performance surface — top half of the viewport */}
      <div className="perf-surface">
        <div className="perf-waves">
          <DeckScope deck="A">
            <DeckWaveform
              visibleSeconds={visibleSeconds}
              onVisibleSecondsChange={setVisibleSeconds}
            />
          </DeckScope>
          <DeckScope deck="B">
            <DeckWaveform
              visibleSeconds={visibleSeconds}
              onVisibleSecondsChange={setVisibleSeconds}
            />
          </DeckScope>
        </div>
        <div className="perf-middle">
          <DeckScope deck="A">
            <DeckPanel lockHint={lockHint === 'A'} />
            <DeckKeys />
          </DeckScope>
          <MixerPanel />
          <DeckScope deck="B">
            <DeckPanel mirrored lockHint={lockHint === 'B'} />
            <DeckKeys />
          </DeckScope>
        </div>
      </div>

      {/* Browse surface — the real Library, bottom half. All loads (hover
          buttons, double-click, arrow keys) go through the load lock. */}
      <div
        className={`perf-library${lockedA ? ' lock-A' : ''}${lockedB ? ' lock-B' : ''}`}
      >
        <DeckScope deck="A">
          <Library browseOnly onLoadToDeck={tryLoad} browseRef={libraryRef} />
        </DeckScope>
      </div>
    </div>
  );
}
