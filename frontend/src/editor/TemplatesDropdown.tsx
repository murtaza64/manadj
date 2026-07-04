/**
 * Templates dropdown (mix-editor issue 03): the reuse counterpart to the
 * TransitionSwitcher's takes. One row per saved template — apply (with an
 * inline beat-count stepper on scalable ones; the "prompt" is never a
 * modal), inline rename, two-step delete — plus "save current as
 * template…" which opens the authoring modal (parent owns it).
 */
import { useEffect, useRef, useState } from 'react';
import type { TransitionTemplate } from './templateModel';

const MIN_BEATS = 1;
const MAX_BEATS = 256;

export function TemplatesDropdown({
  templates,
  canSave,
  saveDisabledReason,
  canApply,
  onApply,
  onSaveCurrent,
  onRename,
  onDelete,
}: {
  templates: TransitionTemplate[];
  canSave: boolean;
  saveDisabledReason?: string;
  canApply: boolean;
  onApply: (template: TransitionTemplate, lengthBeats: number) => void;
  onSaveCurrent: () => void;
  onRename: (template: TransitionTemplate, name: string) => void;
  onDelete: (uuid: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="editor-templates" ref={rootRef}>
      <button
        className="editor-templates-trigger"
        aria-expanded={open}
        title="Transition templates"
        onClick={() => setOpen((v) => !v)}
      >
        templates ▾
      </button>
      {open && (
        <div className="editor-templates-panel">
          {templates.length === 0 && (
            <div className="editor-templates-empty">no templates yet</div>
          )}
          {templates.map((t) => (
            <TemplateRow
              key={t.uuid}
              template={t}
              canApply={canApply}
              onApply={(beats) => {
                onApply(t, beats);
                setOpen(false);
              }}
              onRename={(name) => onRename(t, name)}
              onDelete={() => onDelete(t.uuid)}
            />
          ))}
          <button
            className="editor-templates-save"
            disabled={!canSave}
            title={canSave ? 'Save the current Transition as a template' : saveDisabledReason}
            onClick={() => {
              setOpen(false);
              onSaveCurrent();
            }}
          >
            save current as template…
          </button>
        </div>
      )}
    </div>
  );
}

function TemplateRow({
  template,
  canApply,
  onApply,
  onRename,
  onDelete,
}: {
  template: TransitionTemplate;
  canApply: boolean;
  onApply: (totalBeats: number) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const total = template.beforeBeats + template.afterBeats;
  /** Apply-time TOTAL beat count (scalable templates only), beat-jump
   * idiom; splits proportionally around the anchor (scaleWindow). A
   * zero-length template has no shape to scale — treated as fixed. */
  const [beats, setBeats] = useState(total);
  const inputRef = useRef<HTMLInputElement>(null);
  const windowTitle = `window: ${template.beforeBeats} before / ${template.afterBeats} after`;
  const scalableActive = template.scalable && total > 0;

  const editing = draft !== null;
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  return (
    <div className="editor-templates-row">
      {draft === null ? (
        <button
          className="editor-templates-name"
          title="Rename (click)"
          onClick={() => setDraft(template.name)}
        >
          {template.name}
        </button>
      ) : (
        <input
          ref={inputRef}
          className="editor-switcher-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (draft.trim()) onRename(draft.trim());
              setDraft(null);
            } else if (e.key === 'Escape') {
              setDraft(null);
            }
          }}
        />
      )}
      {scalableActive ? (
        <span className="editor-templates-stepper" title={`Apply total (beats) — ${windowTitle}`}>
          <button
            disabled={beats <= MIN_BEATS}
            onClick={() => setBeats((b) => Math.max(MIN_BEATS, Math.round(b / 2)))}
          >
            ◀
          </button>
          <span className="editor-templates-beats">{beats}</span>
          <button
            disabled={beats >= MAX_BEATS}
            onClick={() => setBeats((b) => Math.min(MAX_BEATS, b * 2))}
          >
            ▶
          </button>
        </span>
      ) : (
        <span className="editor-templates-beats" title={`Fixed — ${windowTitle}`}>
          {total === 0 ? 'cut' : `${total}b`}
        </span>
      )}
      <button
        className="editor-templates-apply"
        disabled={!canApply}
        title={canApply ? 'Apply to the loaded pair' : 'Load two tracks first'}
        onClick={() => onApply(scalableActive ? beats : total)}
      >
        apply
      </button>
      <button
        className={`editor-switcher-del${confirming ? ' confirming' : ''}`}
        title={confirming ? 'Click again to delete this template' : 'Delete (two-step)'}
        onClick={() => {
          if (confirming) {
            setConfirming(false);
            onDelete();
          } else {
            setConfirming(true);
          }
        }}
        onBlur={() => setConfirming(false)}
      >
        {confirming ? 'sure?' : 'del'}
      </button>
    </div>
  );
}
