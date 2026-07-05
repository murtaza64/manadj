/**
 * Save-as-template modal (mix-editor issue 03; reworked for the
 * align-and-window model, issue 28) — authoring is the one deliberate act
 * in the templates feature, so it earns the modal budget. One question
 * per side: which anchor base (the track's SET cue slots plus "first
 * downbeat"). Everything else derives from the drawn Transition and is
 * shown as the recipe sentence — "B's cue 2 lines up with A's cue 4 + 8
 * beats; window 32 before / 64 after" — not editable here (a template is
 * saved FROM a Transition; move the window to change it).
 */
import { useEffect, useState } from 'react';
import {
  alignmentInstantSec,
  defaultAnchorBase,
  defaultAnchorBaseB,
  deriveAlignment,
} from './templateModel';
import type { AnchorBase, DerivedAlignment, TrackSideInfo } from './templateModel';
import type { Transition } from './mixModel';

export interface SaveTemplateResult {
  name: string;
  alignABase: AnchorBase;
  deltaBeats: number;
  alignBBase: AnchorBase;
  beforeBeats: number;
  afterBeats: number;
  scalable: boolean;
}

function baseLabel(base: AnchorBase): string {
  return base === 'grid_origin' ? 'first downbeat' : `cue ${base.slice(4)}`;
}

function baseOptions(side: TrackSideInfo): AnchorBase[] {
  const cues = [...side.hotCues]
    .sort((a, b) => a.slot - b.slot)
    .map((c) => `cue_${c.slot}` as AnchorBase);
  return [...cues, 'grid_origin'];
}

function signedBeats(n: number): string {
  return `${n < 0 ? '−' : '+'} ${Math.abs(n)}`;
}

export function SaveTemplateModal({
  defaultName,
  sideA,
  sideB,
  trackATitle,
  trackBTitle,
  transition,
  rateB,
  onSave,
  onCancel,
}: {
  defaultName: string;
  /** Both sides must carry beatgrids — the save preconditions gate this
   * modal (beat-domain recipes are meaningless without them). */
  sideA: TrackSideInfo;
  sideB: TrackSideInfo;
  trackATitle: string;
  trackBTitle: string;
  transition: Pick<Transition, 'startSec' | 'durationSec' | 'bInSec'>;
  rateB: number;
  onSave: (result: SaveTemplateResult) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(defaultName);
  // Defaults (2026-07-04 #2 grill): B first — the earliest set cue inside
  // B's window span (the mix-in landmark) — then A nearest the resulting
  // alignment instant. Computed once, together.
  const [initialBases] = useState(() => {
    const b = defaultAnchorBaseB(transition, rateB, sideB);
    const instant = alignmentInstantSec(transition, rateB, b, sideB);
    return { a: defaultAnchorBase(instant ?? transition.startSec, sideA), b };
  });
  const [baseA, setBaseA] = useState<AnchorBase>(initialBases.a);
  const [baseB, setBaseB] = useState<AnchorBase>(initialBases.b);
  const [scalable, setScalable] = useState(true);

  const derived: DerivedAlignment | null = deriveAlignment(
    transition,
    rateB,
    baseA,
    baseB,
    sideA,
    sideB
  );
  const valid = name.trim().length > 0 && derived !== null;

  // Escape cancels wherever focus sits (name input, anchor selects, or
  // nowhere) — capture + stopPropagation beats the editor hub and the
  // staged search-clear (keyboard-focus 02). Mounted only while open.
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener('keydown', onEsc, { capture: true });
    return () => document.removeEventListener('keydown', onEsc, { capture: true });
  }, [onCancel]);

  return (
    <div className="editor-savetpl-overlay" onMouseDown={onCancel}>
      <div className="editor-savetpl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="editor-savetpl-title">save as template</div>
        <label>
          name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="bass swap"
          />
        </label>
        <div className="editor-savetpl-side">
          <div className="editor-savetpl-sidehead">B · {trackBTitle}</div>
          <label>
            anchor (mix-in reference)
            <select value={baseB} onChange={(e) => setBaseB(e.target.value as AnchorBase)}>
              {baseOptions(sideB).map((b) => (
                <option key={b} value={b}>
                  {baseLabel(b)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="editor-savetpl-side">
          <div className="editor-savetpl-sidehead">A · {trackATitle}</div>
          <label>
            lines up with
            <select value={baseA} onChange={(e) => setBaseA(e.target.value as AnchorBase)}>
              {baseOptions(sideA).map((b) => (
                <option key={b} value={b}>
                  {baseLabel(b)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="editor-savetpl-recipe">
          {derived ? (
            <>
              B&rsquo;s {baseLabel(baseB)} lines up with A&rsquo;s {baseLabel(baseA)}{' '}
              {signedBeats(derived.deltaBeats)} beats; window {derived.beforeBeats} before /{' '}
              {derived.afterBeats} after
            </>
          ) : (
            'anchors could not be derived — pick set cues or the first downbeat'
          )}
        </div>
        <div className="editor-savetpl-length">
          <label>
            <input
              type="checkbox"
              checked={scalable}
              onChange={(e) => setScalable(e.target.checked)}
            />
            scalable at apply time (proportional)
          </label>
        </div>
        <div className="editor-savetpl-actions">
          <button onClick={onCancel}>cancel</button>
          <button
            className="editor-savetpl-confirm"
            disabled={!valid}
            title={valid ? undefined : 'Needs a name and resolvable anchors on both sides'}
            onClick={() =>
              onSave({
                name: name.trim(),
                alignABase: baseA,
                deltaBeats: derived!.deltaBeats,
                alignBBase: baseB,
                beforeBeats: derived!.beforeBeats,
                afterBeats: derived!.afterBeats,
                scalable,
              })
            }
          >
            save template
          </button>
        </div>
      </div>
    </div>
  );
}
