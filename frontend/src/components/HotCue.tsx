import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import type { HotCue as HotCueType } from '../types';
import { cueCssColor, HOT_CUE_CSS_COLORS } from '../hotcues/palette';
import './HotCue.css';

interface HotCueProps {
  slotNumber: number;  // 1-8
  hotCue: HotCueType | undefined;  // Hot cue data (undefined if not set)
  disabled: boolean;
  isPreviewing: boolean;
  onDown: (slot: number) => void;
  onUp: (slot: number) => void;
  onDelete: (slot: number) => void;
  onDecorate: (slot: number, label: string | null, color: string) => void;
}

interface HotCueEditorProps {
  hotCue: HotCueType;
  anchor: { x: number; y: number };
  onSave: (label: string | null, color: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function HotCueEditor({ hotCue, anchor, onSave, onDelete, onClose }: HotCueEditorProps) {
  const [label, setLabel] = useState(hotCue.label ?? '');
  const [color, setColor] = useState(cueCssColor(hotCue.slot_number, hotCue.color));
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    labelRef.current?.focus();
    labelRef.current?.select();
  }, []);

  const save = (event: FormEvent) => {
    event.preventDefault();
    onSave(label.trim() || null, color);
  };

  return createPortal(
    <div className="hot-cue-editor-overlay" onPointerDown={onClose}>
      <form
        className="hot-cue-editor"
        style={{
          left: Math.max(8, Math.min(anchor.x, window.innerWidth - 288)),
          top: anchor.y,
          maxHeight: Math.max(120, window.innerHeight - anchor.y - 8),
        }}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit Hot Cue ${hotCue.slot_number}`}
        onSubmit={save}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') onClose();
        }}
      >
        <h3>Hot Cue {hotCue.slot_number}</h3>
        <label>
          Label
          <input
            ref={labelRef}
            value={label}
            maxLength={64}
            placeholder="e.g. DROP"
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <fieldset>
          <legend>Color</legend>
          <div className="hot-cue-palette">
            {Object.entries(HOT_CUE_CSS_COLORS).map(([slot, swatch]) => (
              <button
                key={slot}
                type="button"
                className={color.toLowerCase() === swatch ? 'selected' : ''}
                style={{ backgroundColor: swatch }}
                title={`Slot ${slot} color ${swatch}`}
                aria-label={`Use slot ${slot} color`}
                aria-pressed={color.toLowerCase() === swatch}
                onClick={() => setColor(swatch)}
              />
            ))}
            <input
              className="hot-cue-custom-color"
              type="color"
              value={color}
              aria-label="Custom cue color"
              onChange={(event) => setColor(event.target.value)}
            />
          </div>
        </fieldset>
        <div className="hot-cue-editor-actions">
          <button type="button" className="danger" onClick={onDelete}>Delete</button>
          <span />
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary">Save</button>
        </div>
      </form>
    </div>,
    document.body
  );
}

/** Hot-cue pad plus its decoration editor; transport behavior stays in
 * useHotCueActions. */
export default function HotCue({
  slotNumber,
  hotCue,
  disabled,
  isPreviewing,
  onDown,
  onUp,
  onDelete,
  onDecorate,
}: HotCueProps) {
  const isSet = hotCue !== undefined;
  const [editorAnchor, setEditorAnchor] = useState<{ x: number; y: number } | null>(null);

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
    <>
      <button
        className={classNames}
        onPointerDown={(e) => {
          // Right-click edits decoration; Shift+left-click deletes. Neither
          // may start the normal hold-to-preview gesture.
          if (disabled || e.button !== 0) return;
          if (e.shiftKey) {
            if (isSet) onDelete(slotNumber);
            return;
          }
          e.currentTarget.setPointerCapture(e.pointerId);
          onDown(slotNumber);
        }}
        onPointerUp={(e) => {
          if (e.button !== 0 || e.shiftKey) return;
          onUp(slotNumber);
        }}
        onPointerCancel={() => onUp(slotNumber)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (isSet) {
            const rect = e.currentTarget.getBoundingClientRect();
            setEditorAnchor({ x: rect.left, y: rect.bottom + 6 });
          }
        }}
        disabled={disabled}
        title={
          disabled
            ? 'No track loaded'
            : !isSet
              ? `Set Hot Cue ${slotNumber} (${slotNumber})`
              : `Hot Cue ${slotNumber}${hotCue.label ? `: ${hotCue.label}` : ''} @ ${hotCue.time_seconds.toFixed(2)}s (right-click to edit; Shift+click or Shift+${slotNumber} to delete)`
        }
        style={
          // A stored color (e.g. imported from Engine) renders THROUGH the
          // site idiom: it only overrides --cue-color, so every state rule
          // (rest tint / hover brighten / previewing inverted fill) in
          // HotCue.css applies unchanged. Colorless cues keep their per-slot
          // theme colors from the cue-N classes.
          isSet && hotCue.color
            ? ({ '--cue-color': hotCue.color } as CSSProperties)
            : undefined
        }
      >
        {hotCue?.label ? (
          <>
            <span className="hot-cue-number">{slotNumber}</span>
            <span className="hot-cue-label">{hotCue.label}</span>
          </>
        ) : slotNumber}
      </button>
      {editorAnchor && hotCue && (
        <HotCueEditor
          hotCue={hotCue}
          anchor={editorAnchor}
          onSave={(label, color) => {
            onDecorate(slotNumber, label, color);
            setEditorAnchor(null);
          }}
          onDelete={() => {
            onDelete(slotNumber);
            setEditorAnchor(null);
          }}
          onClose={() => setEditorAnchor(null)}
        />
      )}
    </>
  );
}
