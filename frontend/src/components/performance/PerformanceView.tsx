/**
 * The Performance view (performance-mode issues 03/04/05; layout per
 * perf-layout 01): four-Deck surface over an embedded Library. Top surface
 * is CONTENT-SIZED — stacked full-width waveforms, the MixerStrip
 * (X-FADER + MASTER), then a 2×2 A–D grid (each deck carries its own
 * channel controls in its MIX zone). The real Library browse surface
 * (browseOnly, per-row load-to-A–D buttons) takes every remaining pixel.
 *
 * This view owns its keyboard outright (issue 04): per-deck DeckKeys hubs
 * inside each scope, table keys here (↑/↓ navigate; ←/→ load to the focused
 * left/right Decks; Enter = the focused left Deck — issue 22). Control focus
 * decides the target, not the letter, so ← and Enter follow A↔C and → follows
 * B↔D without disturbing the selection. Space is deliberately unbound —
 * single-deck muscle memory must not toggle a live deck. The embedded library
 * mounts no hub.
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
import { EdgePairLinks } from '../../links/PerformancePairLinks';
import { DeckKeys } from './DeckKeys';
import { PlayGuideOverlay } from '../../performance/PlayGuideOverlay';
import { dispatchSetSpace } from '../../sets/spaceTransport';
import { CONTROL_FOCUS_KEYS, browseLoadTarget, isGuardedKeyEvent } from './performanceKeys';
import { DEFAULT_VISIBLE_SECONDS } from '../../utils/waveformZoom';
import { useMidiCursorSuppression } from '../../performance/useMidiCursorSuppression';
import { toggleControlFocus, useControlFocus } from '../../performance/controlFocus';
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
  engineC,
  engineD,
  children,
}: {
  engineA: DeckEngine;
  engineB: DeckEngine;
  engineC: DeckEngine;
  engineD: DeckEngine;
  children: ReactNode;
}) {
  const lockedA = useDeckLocked(engineA);
  const lockedB = useDeckLocked(engineB);
  const lockedC = useDeckLocked(engineC);
  const lockedD = useDeckLocked(engineD);
  return (
    <div
      className={`perf-library${lockedA ? ' lock-A' : ''}${lockedB ? ' lock-B' : ''}${
        lockedC ? ' lock-C' : ''
      }${lockedD ? ' lock-D' : ''}`}
    >
      {children}
    </div>
  );
}

export function PerformanceView() {
  const decks = useDecks();
  const { A, B, C, D } = decks;
  const libraryRef = useRef<LibraryBrowseHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useMidiCursorSuppression(rootRef);
  const controlFocus = useControlFocus();
  // Live focus for the once-bound keydown listener: ← / → / Enter must
  // target the CURRENT focused Decks, but re-binding on every focus change
  // would churn the document listener. A ref keeps the handler stable.
  const controlFocusRef = useRef(controlFocus);
  useEffect(() => {
    controlFocusRef.current = controlFocus;
  });

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
  const engineC = C.engine;
  const engineD = D.engine;
  const tryLoad = useCallback(
    (deck: ChannelId, track: Track) => {
      const target = decks[deck];
      const engine = target.engine;
      if (isDeckLocked(engine)) {
        setLockHint(deck);
        if (lockHintTimer.current) clearTimeout(lockHintTimer.current);
        lockHintTimer.current = setTimeout(() => setLockHint(null), LOCK_HINT_MS);
        return;
      }
      target.loadTrack(track);
    },
    [decks]
  );

  // ── Table keys: ↑/↓ navigate; ←/→ load focused left/right; Enter = left ─
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isGuardedKeyEvent(event)) return;

      // Space (sets 34): with a Set selected in the embedded browse view,
      // space drives the Conductor's mix-level transport — the set wins
      // over the decks (d/k keep the per-deck toggles). With no Set
      // selected it stays deliberately unbound (confirmed decision),
      // claimed so it neither scrolls nor re-activates a focused control.
      if (event.key === ' ') {
        event.preventDefault();
        dispatchSetSpace();
        return;
      }

      if (event.key === CONTROL_FOCUS_KEYS.left || event.key === CONTROL_FOCUS_KEYS.right) {
        event.preventDefault();
        if (!event.repeat) {
          toggleControlFocus(event.key === CONTROL_FOCUS_KEYS.left ? 'left' : 'right');
        }
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        libraryRef.current?.navigate(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }

      // ← / → / Enter Load to the focused left/right Decks (issue 22): the
      // pure browseLoadTarget maps key + Control focus to a physical Deck,
      // so changing focus retargets the next Load without touching the
      // selection. Enter is suppressed on a focused button (library-hub
      // parity) before it can claim a target.
      if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'BUTTON') {
        return;
      }
      const loadDeck = browseLoadTarget(event.key, controlFocusRef.current);
      if (loadDeck) {
        const selected = libraryRef.current?.getSelectedTrack();
        if (!selected) return;
        event.preventDefault();
        tryLoad(loadDeck, selected);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [tryLoad]);

  // On-control keyboard hints — togglable from the mixer strip, persisted.
  const [hintsOn, setHintsOn] = useState(initialHintsOn);
  const toggleHints = () => {
    const next = !hintsOn;
    localStorage.setItem(HINTS_STORAGE_KEY, next ? 'on' : 'off');
    setHintsOn(next);
  };

  return (
    <div ref={rootRef} className={`perf-root${hintsOn ? '' : ' kbd-hints-off'}`}>
      {/* Performance surface — content-sized; the library gets the rest */}
      <div className="perf-surface">
        <PerfWaves />
        <MixerStrip hintsOn={hintsOn} onToggleHints={toggleHints} />
        <div className="perf-decks">
          {/* Six-pair Linking (four-deck-performance 19): the four
              adjacent pairs ride the grid's shared edges; the diagonals
              live on the mixer strip (DiagonalPairLinks). */}
          <EdgePairLinks />
          <DeckScope deck="A">
            <DeckPanel lockHint={lockHint === 'A'} />
          </DeckScope>
          <DeckScope deck="B">
            <DeckPanel mirrored lockHint={lockHint === 'B'} />
          </DeckScope>
          <DeckScope deck="C">
            <DeckPanel lockHint={lockHint === 'C'} />
          </DeckScope>
          <DeckScope deck="D">
            <DeckPanel mirrored lockHint={lockHint === 'D'} />
          </DeckScope>
          <DeckScope deck={controlFocus.left}>
            <DeckKeys />
          </DeckScope>
          <DeckScope deck={controlFocus.right}>
            <DeckKeys />
          </DeckScope>
        </div>
      </div>

      {/* Browse surface — the real Library, all remaining height. All loads
          (hover buttons, double-click, arrow keys) go through the load lock. */}
      <LockDimmedLibrary
        engineA={engineA}
        engineB={engineB}
        engineC={engineC}
        engineD={engineD}
      >
        <DeckScope deck="A">
          <Library
            browseOnly
            onLoadToDeck={tryLoad}
            doubleClickDeck={controlFocus.left}
            browseRef={libraryRef}
          />
        </DeckScope>
      </LockDimmedLibrary>
    </div>
  );
}

/**
 * The shared-zoom island (performance-mode 08): `visibleSeconds` — one
 * zoom for all waveforms (issue 05: equal effective BPM must mean equal
 * beat spacing on screen; survives loads, each waveform re-derives its
 * track-relative factor) — lives HERE, not in PerformanceView, so a wheel
 * tick re-renders exactly its consumers: the two DeckWaveforms and the
 * play-guide overlay. When this state sat at the view's top, every tick
 * re-rendered the whole surface INCLUDING the embedded browse Library —
 * the zoom stutter the library view never had (its zoom is
 * renderer-local and touches no React state at all).
 */
function PerfWaves() {
  const [visibleSeconds, setVisibleSeconds] = useState(DEFAULT_VISIBLE_SECONDS);
  return (
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
      <DeckScope deck="C">
        <DeckWaveform
          visibleSeconds={visibleSeconds}
          onVisibleSecondsChange={setVisibleSeconds}
        />
      </DeckScope>
      <DeckScope deck="D">
        <DeckWaveform
          visibleSeconds={visibleSeconds}
          onVisibleSecondsChange={setVisibleSeconds}
        />
      </DeckScope>
      {/* Play guides (play-guides PRD): saved playing→paused Transitions
          projected as pair-labeled press-play markers on only their two
          waveform rows. Derived, view-only, non-interactive. */}
      <PlayGuideOverlay visibleSeconds={visibleSeconds} />
    </div>
  );
}
