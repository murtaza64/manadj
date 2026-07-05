import type { HotCue as HotCueType } from '../types';
import './HotCue.css';

interface HotCueProps {
  slotNumber: number;  // 1-8
  hotCue: HotCueType | undefined;  // Hot cue data (undefined if not set)
  disabled: boolean;
  isPreviewing: boolean;
  onDown: (slot: number) => void;
  onUp: (slot: number) => void;
  onDelete: (slot: number) => void;
}

/** Presentational hot cue pad; behavior lives in useHotCueActions. */
export default function HotCue({
  slotNumber,
  hotCue,
  disabled,
  isPreviewing,
  onDown,
  onUp,
  onDelete,
}: HotCueProps) {
  const isSet = hotCue !== undefined;

  const classNames = [
    'hot-cue',
    `cue-${slotNumber}`,
    isSet ? 'set' : 'unset',
    isPreviewing ? 'previewing' : '',
    disabled ? 'disabled' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      className={classNames}
      onPointerDown={(e) => {
        // Primary button only: a right-click is the DELETE gesture
        // (contextmenu below) — letting it through here started a
        // hold-to-preview whose release was then swallowed by the delete
        // (playback ran on forever).
        if (disabled || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        onDown(slotNumber);
      }}
      onPointerUp={(e) => {
        if (e.button !== 0) return;
        onUp(slotNumber);
      }}
      onPointerCancel={() => onUp(slotNumber)}
      onContextMenu={(e) => {
        e.preventDefault();
        onDelete(slotNumber);
      }}
      disabled={disabled}
      title={
        disabled
          ? 'No track loaded'
          : !isSet
            ? `Set Hot Cue ${slotNumber} (${slotNumber})`
            : `Hot Cue ${slotNumber} @ ${hotCue.time_seconds.toFixed(2)}s (${slotNumber} to trigger, Shift+${slotNumber} to delete)`
      }
      style={
        // A stored color (e.g. imported from Engine) renders THROUGH the
        // site idiom — colored border + 12% tint + colored number — not as
        // an opaque fill that ignores the theme. Colorless cues keep their
        // per-slot theme colors from the cue-N classes.
        isSet && hotCue.color
          ? {
              borderColor: hotCue.color,
              backgroundColor: `color-mix(in srgb, ${hotCue.color} 12%, transparent)`,
              color: hotCue.color,
            }
          : undefined
      }
    >
      {slotNumber}
    </button>
  );
}
