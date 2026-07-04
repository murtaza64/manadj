/**
 * Save-as-template modal (mix-editor issue 03) — authoring is the one
 * deliberate act in the templates feature, so it earns the modal budget.
 * One question per side: which anchor base (the track's SET cue slots
 * plus "first downbeat"), defaulting to the cue nearest the actual anchor
 * point. Deltas are auto-derived from the window's real placement and
 * rounded to whole beats — shown for confirmation, not editable (a
 * template is saved FROM a Transition; move the window to change them).
 */
import { useMemo, useState } from 'react';
import {
  defaultAnchorBase,
  deriveAnchorDeltaBeats,
  deriveLengthBeats,
} from './templateModel';
import type { AnchorBase, AnchorRule, TrackSideInfo } from './templateModel';

export interface SaveTemplateResult {
  name: string;
  alignA: AnchorRule;
  alignB: AnchorRule;
  lengthBeats: number;
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

function SidePicker({
  label,
  trackTitle,
  side,
  anchorSec,
  base,
  onBase,
}: {
  label: 'A' | 'B';
  trackTitle: string;
  side: TrackSideInfo;
  anchorSec: number;
  base: AnchorBase;
  onBase: (b: AnchorBase) => void;
}) {
  const delta = deriveAnchorDeltaBeats(anchorSec, base, side);
  return (
    <div className="editor-savetpl-side">
      <div className="editor-savetpl-sidehead">
        {label} · {trackTitle}
      </div>
      <label>
        anchor
        <select value={base} onChange={(e) => onBase(e.target.value as AnchorBase)}>
          {baseOptions(side).map((b) => (
            <option key={b} value={b}>
              {baseLabel(b)}
            </option>
          ))}
        </select>
      </label>
      <span className="editor-savetpl-delta" title="Whole-beat offset from the anchor base (auto-derived)">
        Δ {delta ?? '—'} beats
      </span>
    </div>
  );
}

export function SaveTemplateModal({
  defaultName,
  sideA,
  sideB,
  trackATitle,
  trackBTitle,
  anchorASec,
  anchorBSec,
  durationSec,
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
  anchorASec: number;
  anchorBSec: number;
  durationSec: number;
  onSave: (result: SaveTemplateResult) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [baseA, setBaseA] = useState<AnchorBase>(() => defaultAnchorBase(anchorASec, sideA));
  const [baseB, setBaseB] = useState<AnchorBase>(() => defaultAnchorBase(anchorBSec, sideB));
  const [scalable, setScalable] = useState(true);

  const lengthBeats = useMemo(
    () => (sideA.beatgrid ? deriveLengthBeats(durationSec, sideA.beatgrid) : 0),
    [durationSec, sideA.beatgrid]
  );
  const deltaA = deriveAnchorDeltaBeats(anchorASec, baseA, sideA);
  const deltaB = deriveAnchorDeltaBeats(anchorBSec, baseB, sideB);
  const valid = name.trim().length > 0 && deltaA !== null && deltaB !== null;

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
            onKeyDown={(e) => {
              if (e.key === 'Escape') onCancel();
            }}
            placeholder="bass swap"
          />
        </label>
        <SidePicker
          label="A"
          trackTitle={trackATitle}
          side={sideA}
          anchorSec={anchorASec}
          base={baseA}
          onBase={setBaseA}
        />
        <SidePicker
          label="B"
          trackTitle={trackBTitle}
          side={sideB}
          anchorSec={anchorBSec}
          base={baseB}
          onBase={setBaseB}
        />
        <div className="editor-savetpl-length">
          <span title="Derived from the window on A's grid, rounded to whole beats">
            length: {lengthBeats} beats
          </span>
          <label>
            <input
              type="checkbox"
              checked={scalable}
              onChange={(e) => setScalable(e.target.checked)}
            />
            scalable at apply time
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
                alignA: { base: baseA, deltaBeats: deltaA! },
                alignB: { base: baseB, deltaBeats: deltaB! },
                lengthBeats,
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
