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
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        onDown(slotNumber);
      }}
      onPointerUp={() => onUp(slotNumber)}
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
      style={{
        backgroundColor: isSet && hotCue.color ? hotCue.color : undefined,
      }}
    >
      {slotNumber}
    </button>
  );
}
