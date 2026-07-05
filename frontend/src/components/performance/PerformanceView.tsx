/**
 * The Performance view (performance-mode issues 03/04/05; layout per
 * perf-layout 01): two-deck surface over an embedded Library. Top surface
 * is CONTENT-SIZED — stacked full-width waveforms, the MixerStrip
 * (X-FADER + MASTER), then Deck A | Deck B (each deck carries its own
 * channel controls in its MIX zone). The real Library browse surface
 * (browseOnly, per-row load-to-A/B buttons) takes every remaining pixel.
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
import type { ReactNode } from 'react';
import Library from '../Library';
import type { LibraryBrowseHandle } from '../Library';
import { DeckScope } from '../../contexts/DeckContext';
import { useDecks } from '../../hooks/useDeck';
import type { DeckEngine } from '../../playback/DeckEngine';
import type { ChannelId } from '../../playback/mixer';
import type { Track } from '../../types';
import { DeckPanel, DeckWaveform } from './DeckPanel';
import { MixerStrip } from './MixerStrip';
import { LinkToggle } from '../../links/LinkToggle';
import { DeckKeys } from './DeckKeys';
import { isGuardedKeyEvent } from './performanceKeys';
import { DEFAULT_VISIBLE_SECONDS } from '../../utils/waveformZoom';
import './PerformanceView.css';

const LOCK_HINT_MS = 1500;

/** Keyboard-hint visibility, persisted; read once (same idiom as ?view=). */
const HINTS_STORAGE_KEY = 'perf-kbd-hints';
const initialHintsOn = localStorage.getItem(HINTS_STORAGE_KEY) !== 'off';

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

/**
 * Self-subscribing lock-dim wrapper: the lock booleans flip exactly when a
 * deck starts/stops, so subscribing at view level re-rendered the whole
 * view — embedded library table included — right as playback started
 * (visible jitter, issue 10). Here a flip restyles only this div; the
 * children element (created by the parent) is identity-stable, so React
 * skips the table.
 */
function LockDimmedLibrary({
  engineA,
  engineB,
  children,
}: {
  engineA: DeckEngine;
  engineB: DeckEngine;
  children: ReactNode;
}) {
  const lockedA = useDeckLocked(engineA);
  const lockedB = useDeckLocked(engineB);
  return (
    <div className={`perf-library${lockedA ? ' lock-A' : ''}${lockedB ? ' lock-B' : ''}`}>
      {children}
    </div>
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

  // On-control keyboard hints — togglable from the mixer strip, persisted.
  const [hintsOn, setHintsOn] = useState(initialHintsOn);
  const toggleHints = () => {
    const next = !hintsOn;
    localStorage.setItem(HINTS_STORAGE_KEY, next ? 'on' : 'off');
    setHintsOn(next);
  };

  return (
    <div className={`perf-root${hintsOn ? '' : ' kbd-hints-off'}`}>
      {/* Performance surface — content-sized; the library gets the rest */}
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
        <MixerStrip
          hintsOn={hintsOn}
          onToggleHints={toggleHints}
          linkToggle={
            <LinkToggle
              aTrackId={A.loadedTrack?.id ?? null}
              bTrackId={B.loadedTrack?.id ?? null}
            />
          }
        />
        <div className="perf-decks">
          <DeckScope deck="A">
            <DeckPanel lockHint={lockHint === 'A'} />
            <DeckKeys />
          </DeckScope>
          <DeckScope deck="B">
            <DeckPanel mirrored lockHint={lockHint === 'B'} />
            <DeckKeys />
          </DeckScope>
        </div>
      </div>

      {/* Browse surface — the real Library, all remaining height. All loads
          (hover buttons, double-click, arrow keys) go through the load lock. */}
      <LockDimmedLibrary engineA={engineA} engineB={engineB}>
        <DeckScope deck="A">
          <Library browseOnly onLoadToDeck={tryLoad} browseRef={libraryRef} />
        </DeckScope>
      </LockDimmedLibrary>
    </div>
  );
}
