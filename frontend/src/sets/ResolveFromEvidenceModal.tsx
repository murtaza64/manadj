/**
 * Resolve from evidence — the preview/confirm surface (sets #163;
 * glossary amendment 2026-08-24). Shows the diff the gesture would
 * apply — N Takes to pin (chop-Takes flagged), K hard-cuts remaining —
 * and applies it in ONE confirm via `setAdjacencyPins`. The preview +
 * confirm is what makes the bulk Take pin an explicit act under
 * ADR 0023: nothing is pinned until the user, having seen the list,
 * says so.
 */
import { useEffect } from 'react';
import { CHOP_TAKE_MAX_S, type EvidenceResolution } from './adjacency';
import './ResolveFromEvidenceModal.css';

interface ResolveFromEvidenceModalProps {
  preview: EvidenceResolution;
  /** Row labels — falls back to "Track <id>" while metadata loads. */
  trackLabel: (trackId: number) => string;
  onConfirm: () => void;
  onClose: () => void;
}

const fmtWindow = (s: number | undefined) =>
  s === undefined ? '' : ` · ${s < 10 ? s.toFixed(1) : Math.round(s)}s`;

export default function ResolveFromEvidenceModal({
  preview,
  trackLabel,
  onConfirm,
  onClose,
}: ResolveFromEvidenceModalProps) {
  // Escape closes — capture + stopPropagation beats the staged
  // search-clear and the view hubs (keyboard-focus 02, as BpmModal).
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleEsc, { capture: true });
    return () => document.removeEventListener('keydown', handleEsc, { capture: true });
  }, [onClose]);

  const chopCount = preview.rows.filter((r) => r.chop).length;

  return (
    <div className="rfe-overlay" onClick={onClose}>
      <div className="rfe-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rfe-title">Resolve from evidence</div>
        <div className="rfe-summary">
          <span className="rfe-count rfe-count-pin">{preview.rows.length}</span> Take
          {preview.rows.length === 1 ? '' : 's'} to pin
          {chopCount > 0 && (
            <>
              {' · '}
              <span className="rfe-count rfe-count-chop">{chopCount}</span> chop-flagged
            </>
          )}
          {' · '}
          <span className="rfe-count rfe-count-cut">{preview.hardCuts.length}</span> hard-cut
          {preview.hardCuts.length === 1 ? '' : 's'} remain
        </div>

        <div className="rfe-list">
          {preview.rows.map((row) => (
            <div key={row.headTrackId} className="rfe-row">
              <span className="rfe-pair">
                {trackLabel(row.aTrackId)} <span className="rfe-arrow">→</span>{' '}
                {trackLabel(row.bTrackId)}
              </span>
              <span className="rfe-take">
                Take · {new Date(row.take.detectedAt).toLocaleDateString()}
                {fmtWindow(row.take.windowS)}
              </span>
              {row.chop && (
                <span
                  className="rfe-chop-flag"
                  title={`Sub-${CHOP_TAKE_MAX_S}s window — likely a fader chop, not a blend. Pinned anyway; review it.`}
                >
                  ⚠ chop
                </span>
              )}
            </div>
          ))}
          {preview.hardCuts.map((cut) => (
            <div key={cut.aTrackId} className="rfe-row rfe-row-cut">
              <span className="rfe-pair">
                {trackLabel(cut.aTrackId)} <span className="rfe-arrow">→</span>{' '}
                {trackLabel(cut.bTrackId)}
              </span>
              <span className="rfe-take">no evidence — hard cut remains</span>
            </div>
          ))}
        </div>

        <div className="rfe-footer">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-success"
            onClick={onConfirm}
            disabled={preview.rows.length === 0}
            title="Pin every listed Take (one act — existing pins and auto-resolving Transitions untouched)"
          >
            Pin {preview.rows.length} Take{preview.rows.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
