/**
 * The mixer strip (perf-layout 01): X-FADER + CUE MIX in a slim horizontal
 * row between the waveforms and the decks. Per-channel controls (TRIM/EQ/
 * FLT/VOL) live on their deck's MIX zone; MASTER and PHONES gain are knobs
 * beside the top bar's routing selects (gh#66) — the strip is all that
 * remains of the central mixer column.
 *
 * Wired straight to the Mixer module (ADR 0009): mixer state is not React
 * state — controls are CONTROLLED components reading it through
 * useMixerValue (so hardware Controller moves repaint them too,
 * midi-controller 09) and pushing changes through the setters. The shared
 * rotary Knob lives here too (used by the deck MIX zones).
 */
import { useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { knobAppearance, type KnobControl } from './knobAppearance';
import { useStyleSlot } from '../../waveform/styleSlots';
import { useMixer, useMixerValue } from '../../hooks/useMixer';
import { useTakeoverHint } from '../../hooks/useTakeoverHint';
import { takeoverKey, type TakeoverDirection } from '../../midi/takeoverFeedback';
import { CHANNEL_IDS, CUE_MIX_DEFAULT } from '../../playback/mixer';
import type { BeatFxTarget } from '../../playback/beatFx';
import { isQuantizeOn, setQuantize, subscribeQuantize } from '../../playback/quantizeStore';
import type { ChannelId } from '../../playback/mixer';
import { DiagonalPairLinks } from '../../links/PerformancePairLinks';
import { AutoBlurSelect } from '../AutoBlurSelect';
import { openKeyboardHelp } from '../keyboardHelpStore';
import { PerfSectionToggles } from './PerfSectionToggles';
import type { DeckCount } from './waveformOrder';
import {
  isSoftTakeoverEnabled,
  setSoftTakeoverEnabled,
  subscribeSoftTakeover,
} from '../../midi/softTakeoverStore';

/** Vertical drag distance (px) that sweeps a knob end to end. */
const KNOB_DRAG_RANGE_PX = 150;

/** Wheel delta that sweeps a control end to end (scroll-to-adjust). */
const WHEEL_RANGE = 1000;

/** Per-event wheel step, sign flipped so scroll-up increases. */
function wheelDelta(e: React.WheelEvent, min: number, max: number): number {
  return (-e.deltaY / WHEEL_RANGE) * (max - min);
}

export function Knob({
  label,
  kbd,
  min,
  max,
  defaultValue,
  value,
  onChange,
  title,
  className,
  control,
  ghost = null,
  takeover = null,
}: {
  label: string;
  kbd?: ReactNode;
  min: number;
  max: number;
  /** Double-click reset position. */
  defaultValue: number;
  value: number;
  onChange: (value: number) => void;
  /** Hover tooltip on the dial. */
  title?: string;
  /** Extra class(es) on the knob wrapper (size/ring variants). */
  className?: string;
  /** Match editor parameter colors and value shading; other knobs stay neutral. */
  control?: KnobControl;
  /** Automation ghost (sets 15): a second, translucent pointer at the live
   * automation value while an overlay is engaged. Display only — never
   * affects the real pointer (base state) or gesture handling. */
  ghost?: number | null;
  /** Soft-takeover hint (midi-controller 18): pulses the knob and shows
   * which way the HARDWARE must turn to pick up. Display only. */
  takeover?: TakeoverDirection | null;
}) {
  const drag = useRef<{ startY: number; startValue: number } | null>(null);
  const waveform = useStyleSlot('full');

  const set = (v: number) => {
    onChange(Math.max(min, Math.min(max, v)));
  };

  /** Dial angle for a value, clamped to the knob's physical stops. */
  const toAngle = (v: number) =>
    -135 + Math.max(0, Math.min(1, (v - min) / (max - min))) * 270;
  const angle = toAngle(value);
  const ghostAngle = ghost === null ? null : toAngle(ghost);
  const appearance = control ? knobAppearance(control,
    (value - min) / (max - min), ghost === null ? null : (ghost - min) / (max - min), waveform) : null;

  return (
    <div
      className={`perf-knob${control ? ' perf-knob-colored' : ''}${className ? ` ${className}` : ''}${
        takeover ? ` perf-takeover perf-takeover-${takeover}` : ''
      }`}
      style={appearance?.style as CSSProperties | undefined}
    >
      <div
        className="perf-knob-dial"
        title={title}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { startY: e.clientY, startValue: value };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const deltaPx = drag.current.startY - e.clientY;
          set(drag.current.startValue + (deltaPx / KNOB_DRAG_RANGE_PX) * (max - min));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={() => set(defaultValue)}
        onWheel={(e) => set(value + wheelDelta(e, min, max))}
      >
        {control && <>
          <div className="perf-knob-ring perf-knob-ring-track" aria-hidden="true" />
          <div className="perf-knob-ring perf-knob-ring-fill" style={{ background: appearance?.arcBackground }} aria-hidden="true" />
          <div className="perf-knob-detent" aria-hidden="true" />
        </>}
        {ghostAngle !== null && (
          <div
            className="perf-knob-pointer perf-knob-ghost"
            style={{ transform: `rotate(${ghostAngle}deg)` }}
          />
        )}
        {/* While a ghost shows, automation is what's audible — dim the
            base pointer so the ghost reads as winning. */}
        <div
          className={`perf-knob-pointer${ghostAngle !== null ? ' perf-base-dim' : ''}`}
          style={{ transform: `rotate(${angle}deg)` }}
        />
      </div>
      <span>{label}{kbd != null && <span className="perf-kbd perf-kbd-inline">{kbd}</span>}</span>
    </div>
  );
}

/**
 * Horizontal fader with the label ON the handle (no label column — the
 * label travels with the grab point). Pointer-driven; scroll adjusts;
 * double-click resets to `defaultValue`. `detent` draws a center tick
 * (pitch zero); `fill` paints the track up to the handle (level-style
 * controls like VOL — meaningless for bipolar ones like pitch);
 * `fillColor` overrides the fill's color (Deck color on channel VOL).
 * `crossfade` paints neutral opposite-side fills. Channel assignment is
 * surfaced on each channel strip; the crossfader no longer implies fixed
 * Deck identities.
 */
export function HFader({
  label,
  kbd,
  id,
  ariaLabel,
  step,
  min,
  max,
  value,
  defaultValue,
  onChange,
  disabled = false,
  accent = false,
  detent = false,
  fill = false,
  fillColor,
  crossfade = false,
  title,
  ghost = null,
  takeover = null,
}: {
  label: string;
  kbd?: ReactNode;
  id?: string;
  ariaLabel?: string;
  step?: number;
  min: number;
  max: number;
  value: number;
  defaultValue: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  accent?: boolean;
  detent?: boolean;
  fill?: boolean;
  fillColor?: string;
  crossfade?: boolean;
  title?: string;
  /** Automation ghost (sets 15): a translucent DAW-style marker on the
   * track at the live automation value while an overlay is engaged. The
   * real handle (base state) and gesture handling are untouched. */
  ghost?: number | null;
  /** Soft-takeover hint (midi-controller 18): pulses the handle and points
   * toward the software value ('up' = right). Display only. */
  takeover?: TakeoverDirection | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const set = (raw: number) => {
    if (!Number.isFinite(raw)) return;
    const clamped = Math.max(min, Math.min(max, raw));
    const snapped = step && step > 0
      ? Number((min + Math.round((clamped - min) / step) * step).toPrecision(12))
      : clamped;
    onChange(Math.max(min, Math.min(max, snapped)));
  };

  const setFromPointer = (clientX: number) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    set(min + f * (max - min));
  };

  const fraction = (value - min) / (max - min);
  const ghostFraction =
    ghost === null ? null : Math.max(0, Math.min(1, (ghost - min) / (max - min)));
  // The fill shows the AUDIBLE level: the ghost's value while automation
  // is winning, the handle's (base state) otherwise.
  const fillFraction = ghostFraction ?? Math.max(0, Math.min(1, fraction));

  return (
    <div
      ref={ref}
      id={id}
      role={ariaLabel ? 'slider' : undefined}
      aria-label={ariaLabel}
      aria-valuemin={ariaLabel ? min : undefined}
      aria-valuemax={ariaLabel ? max : undefined}
      aria-valuenow={ariaLabel ? value : undefined}
      aria-disabled={ariaLabel ? disabled : undefined}
      tabIndex={ariaLabel ? (disabled ? -1 : 0) : undefined}
      className={`perf-fader${accent ? ' accent' : ''}${disabled ? ' disabled' : ''}${takeover ? ` perf-takeover perf-takeover-${takeover}` : ''}`}
      title={title}
      onPointerDown={(e) => {
        if (disabled) return;
        if (ariaLabel) e.currentTarget.focus({ preventScroll: true });
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        setFromPointer(e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging.current && !disabled) setFromPointer(e.clientX);
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        if (ariaLabel) e.currentTarget.blur();
      }}
      onPointerCancel={() => (dragging.current = false)}
      onLostPointerCapture={() => (dragging.current = false)}
      onDoubleClick={() => !disabled && set(defaultValue)}
      onKeyDown={(e) => {
        if (!ariaLabel || disabled || e.ctrlKey || e.metaKey || e.altKey) return;
        const increment = step ?? (max - min) / 100;
        let next: number;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + increment;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - increment;
        else if (e.key === 'PageUp') next = value + increment * 10;
        else if (e.key === 'PageDown') next = value - increment * 10;
        else if (e.key === 'Home') next = min;
        else if (e.key === 'End') next = max;
        else return;
        e.preventDefault();
        e.stopPropagation();
        set(next);
      }}
      onWheel={(e) => {
        if (disabled) return;
        set(value + wheelDelta(e, min, max));
      }}
    >
      <div className="perf-fader-track" />
      {fill && (
        <div
          className="perf-fader-fill"
          style={{
            width: `${fillFraction * 100}%`,
            ...(fillColor ? { background: fillColor } : {}),
          }}
        />
      )}
      {crossfade && (
        <>
          <div
            className="perf-fader-fill"
            style={{
              width: `${Math.max(0, Math.min(1, fraction)) * 100}%`,
              background: 'var(--overlay1)',
            }}
          />
          <div
            className="perf-fader-fill"
            style={{
              left: 'auto',
              right: 0,
              width: `${(1 - Math.max(0, Math.min(1, fraction))) * 100}%`,
              background: 'var(--overlay1)',
            }}
          />
        </>
      )}
      {detent && <div className="perf-fader-detent" />}
      {ghostFraction !== null && (
        <div className="perf-fader-ghost" style={{ left: `${ghostFraction * 100}%` }} />
      )}
      {/* left: X% + translateX(-X%) keeps the handle fully inside the box
          at both extremes (slider-thumb idiom) instead of overflowing by
          half its label width. */}
      {/* While a ghost shows, automation is what's audible — dim the base
          handle so the ghost reads as winning (it stays the takeover
          target, so it never disappears). */}
      <div
        className={`perf-fader-handle${ghostFraction !== null ? ' perf-base-dim' : ''}`}
        style={{
          left: `${Math.max(0, Math.min(1, fraction)) * 100}%`,
          transform: `translate(-${Math.max(0, Math.min(1, fraction)) * 100}%, -50%)`,
        }}
      >
        {label}
        {kbd != null && <span className="perf-kbd perf-kbd-inline">{kbd}</span>}
      </div>
    </div>
  );
}

/**
 * Compact natural-side assignment. A/C can only join the left side; B/D
 * only the right. Off = thru (bypass), on = assigned to that side.
 */
function XfAssign({ deck }: { deck: ChannelId }) {
  const mixer = useMixer();
  const assignment = useMixerValue((m) => m.getCrossfaderAssignment(deck));
  const xfOn = useMixerValue((m) => m.getCrossfaderEnabled());
  const side = deck === 'A' || deck === 'C' ? 'left' : 'right';
  const assigned = assignment === side;
  return (
    <button
      className={`player-button perf-strip-toggle perf-xf-assign deck-${deck.toLowerCase()}${assigned ? ' on' : ''}`}
      aria-label={`Deck ${deck} crossfader assignment`}
      aria-pressed={assigned}
      disabled={!xfOn}
      onClick={() => mixer.setCrossfaderAssignment(deck, assigned ? 'thru' : side)}
      title={`Deck ${deck}: ${assigned ? `${side} side` : 'thru'}`}
    >
      {deck}
    </button>
  );
}

/** 0.25 → "1/4", 0.75 → "3/4", 2 → "2" — the echo beats readout. */
function formatEchoBeats(beats: number): string {
  if (beats === 0.25) return '1/4';
  if (beats === 0.5) return '1/2';
  if (beats === 0.75) return '3/4';
  return String(beats);
}

/** One CH SELECT radio target; LEDs on the GRV6 are hardware-controlled. */
function BeatFxTargetToggle({ target, label }: { target: BeatFxTarget; label: string }) {
  const mixer = useMixer();
  const selected = useMixerValue((m) => m.getBeatFxSection().target === target);
  const deckClass = CHANNEL_IDS.includes(target as ChannelId)
    ? ` deck-${target.toLowerCase()}`
    : '';
  return (
    <button
      className={`player-button perf-strip-toggle perf-fx-ch${deckClass}${selected ? ' on' : ''}`}
      aria-pressed={selected}
      aria-label={`Beat FX target ${label}`}
      onClick={() => mixer.selectBeatFxTarget(target)}
      title={target === 'sampler' ? 'Sampler target (no sampler bus in manadj)' : `Beat FX target: ${label}`}
    >
      {label}
    </button>
  );
}

/** One GRV6-shaped section: ON/OFF, SELECT, BEAT, single bipolar DEPTH,
 * then the mutually-exclusive A–D/SP/MST CH SELECT targets. */
function BeatFxRow({ deckCount }: { deckCount: DeckCount }) {
  const mixer = useMixer();
  const section = useMixerValue((m) => m.getBeatFxSection());
  const depthTakeover = useTakeoverHint(takeoverKey.beatFxLevel());
  const channels = deckCount === 4 ? CHANNEL_IDS : (['A', 'B'] as const);
  return (
    <div className="perf-fx-row" role="group" aria-label="Beat FX">
      <div className="perf-fx-controls">
        <button
          className={`player-button perf-strip-toggle${section.on ? ' on' : ''}`}
          aria-label="Beat FX on/off"
          aria-pressed={section.on}
          disabled={section.selected === null}
          onClick={() => mixer.toggleBeatFxOn()}
          title="Beat FX master on/off (GRV6 ON/OFF)"
        >
          FX
        </button>
        <AutoBlurSelect
          className="perf-fx-select"
          aria-label="Beat FX effect"
          value={section.selected ?? ''}
          onChange={(event) => {
            const value = event.currentTarget.value;
            mixer.selectBeatFx(value === '' ? null : value as 'echo' | 'reverb' | 'flanger');
          }}
          title="Beat FX SELECT; swaps the current target live"
      >
        <option value="">---</option>
        <option value="echo">ECH</option>
        <option value="reverb">RVB</option>
        <option value="flanger">FLG</option>
        </AutoBlurSelect>
        <button
          className="player-button perf-strip-toggle perf-fx-beats"
          aria-label="Echo beats"
          onClick={(e) => mixer.stepBeatFxBeats(e.shiftKey ? 'halve' : 'double')}
          onWheel={(e) => mixer.stepBeatFxBeats(e.deltaY < 0 ? 'double' : 'halve')}
          title="Echo beat fraction (click = double, shift-click = halve, scroll works too)"
        >
          {formatEchoBeats(section.beats)}
        </button>
        <Knob
          label="DEPTH"
          min={-1}
          max={1}
          defaultValue={0}
          value={section.depth}
          onChange={(value) => mixer.setBeatFxDepth(value)}
          title="LEVEL/DEPTH: original ← 0 balance → effect"
          className="perf-knob-small perf-fx-depth"
          takeover={depthTakeover}
        />
      </div>
      <div className="perf-fx-targets" role="group" aria-label="Beat FX target">
        {channels.map((channel) => (
          <BeatFxTargetToggle key={channel} target={channel} label={channel} />
        ))}
        <BeatFxTargetToggle target="master" label="MST" />
      </div>
    </div>
  );
}

export function MixerStrip({
  hintsOn = true,
  onToggleHints,
  deckCount = 4,
  onDeckCountChange,
}: {
  /** Keyboard-hint visibility (the KBD toggle in the strip's left cell). */
  hintsOn?: boolean;
  onToggleHints?: () => void;
  deckCount?: DeckCount;
  onDeckCountChange?: (count: DeckCount) => void;
}) {
  const mixer = useMixer();
  const crossfader = useMixerValue((m) => m.getCrossfader());
  const quantizeOn = useSyncExternalStore(subscribeQuantize, isQuantizeOn);
  const softTakeoverOn = useSyncExternalStore(subscribeSoftTakeover, isSoftTakeoverEnabled);
  // Crossfader bypass — audio truth lives in the Mixer; UI repaints
  // through the same subscription as every other mixer control.
  const xfOn = useMixerValue((m) => m.getCrossfaderEnabled());
  // Cue bus (headphone-cue 03): the blend. Same subscription, so hardware
  // moves repaint it live.
  const cueMix = useMixerValue((m) => m.getCueMix());
  // Soft-takeover hints (midi-controller 18): pulse the control a
  // mismatched hardware knob is reaching for.
  const cueMixTakeover = useTakeoverHint(takeoverKey.cueMix());
  const crossfaderTakeover = useTakeoverHint(takeoverKey.crossfader());

  return (
    <div className="perf-strip">
      <div className="perf-strip-left">
        {onDeckCountChange && (
          <span className="perf-deck-count" role="group" aria-label="Displayed decks">
            {([2, 4] as const).map((count) => (
              <button
                key={count}
                className={`player-button perf-strip-toggle${deckCount === count ? ' on' : ''}`}
                aria-pressed={deckCount === count}
                onClick={() => onDeckCountChange(count)}
                title={`Show ${count} decks (display only)`}
              >
                {count} DECKS
              </button>
            ))}
          </span>
        )}
        {onToggleHints && (
          <span className="perf-kbd-toggle-group">
            <button
              className={`player-button perf-strip-toggle${hintsOn ? ' on' : ''}`}
              onClick={onToggleHints}
              title={hintsOn ? 'Hide keyboard hints' : 'Show keyboard hints'}
            >
              KBD
            </button>
            <button
              className="player-button perf-strip-toggle"
              aria-label="Keyboard shortcuts"
              onClick={openKeyboardHelp}
              title="Show keyboard map (?)"
            >
              ?
            </button>
          </span>
        )}
        {/* Waveform/deck section toggles (perf-layout 12 / gh#68): the
            strip never hides, so they stay reachable when everything
            around it is collapsed. */}
        <PerfSectionToggles />
        <button
          className={`player-button perf-strip-toggle${quantizeOn ? ' on' : ''}`}
          aria-label="Quantize"
          aria-pressed={quantizeOn}
          aria-keyshortcuts="="
          title={`${quantizeOn ? 'Quantize on: gestures snap to the beat' : 'Quantize off: exact placement'} (=)`}
          onClick={() => setQuantize(!isQuantizeOn())}
        >
          QUANT
        </button>
        <button
          className={`player-button perf-strip-toggle${softTakeoverOn ? ' on' : ''}`}
          aria-pressed={softTakeoverOn}
          onClick={() => setSoftTakeoverEnabled(!softTakeoverOn)}
          title={softTakeoverOn
            ? 'Soft takeover on: controller values wait for pickup'
            : 'Soft takeover off: controller values apply immediately'}
        >
          TAKEOVER
        </button>
      </div>
      <div className="perf-xf-tools">
        <button
          className={`player-button perf-strip-toggle perf-xf-enable${xfOn ? ' on' : ''}`}
          onClick={() => mixer.setCrossfaderEnabled(!xfOn)}
          title={
            xfOn
              ? 'Disable crossfader (all channels at unity)'
              : 'Enable crossfader'
          }
        >
          XF
        </button>
        {/* Physical order follows the deck grid: C A | fader | B D. */}
        {deckCount === 4 && <XfAssign deck="C" />}
        <XfAssign deck="A" />
      </div>
      <div className="perf-xf-fader">
        <HFader
          label="X-FADER"
          min={-1}
          max={1}
          value={crossfader}
          defaultValue={0}
          detent
          crossfade
          disabled={!xfOn}
          onChange={(v) => mixer.setCrossfader(v)}
          title="Crossfader (double-click to center)"
          takeover={crossfaderTakeover}
        />
      </div>
      <div className="perf-xf-right">
        <XfAssign deck="B" />
        {deckCount === 4 && <XfAssign deck="D" />}
      </div>
      <div className="perf-strip-right">
        {deckCount === 4 && <DiagonalPairLinks />}
        <BeatFxRow deckCount={deckCount} />
        <div className="perf-strip-slot">
          {/* Headphone blend. MASTER and PHONES gain moved to the top bar's
              routing knobs (gh#66) — the blend is the only cue control left
              in the strip. */}
          <HFader
            label="CUE MIX"
            min={0}
            max={1}
            value={cueMix}
            defaultValue={CUE_MIX_DEFAULT}
            onChange={(v) => mixer.setCueMix(v)}
            title="Headphone blend: cue only ← → master only (double-click = cue only)"
            takeover={cueMixTakeover}
          />
        </div>
      </div>
    </div>
  );
}
