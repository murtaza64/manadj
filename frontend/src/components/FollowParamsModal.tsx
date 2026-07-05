/**
 * Follow parameters modal (follow-mode 05) — the matching parameters'
 * only editor. No Apply and no reference picker: edits write the params
 * store and take effect on the followed list immediately; which Track is
 * the reference is the per-Deck Follow toggles' business. Replaces the
 * retired Find Compatible modal (the one-shot's last surface).
 */
import { useEffect } from 'react';
import './FollowParamsModal.css';
import type { Track } from '../types';
import { followSummary, getEnergyRange } from '../follow/model';
import type { EnergyPreset } from '../follow/model';
import { resetFollowParams, setFollowParams, useFollowParams } from '../follow/paramsStore';
import { formatKeyDisplay } from '../utils/keyUtils';
import type { ChannelId } from '../playback/mixer';

interface FollowParamsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Followed references — shown as context; empty when nothing follows. */
  references: ReadonlyArray<{ deck: ChannelId; reference: Track }>;
  openPosition?: { x: number; y: number };
}

const ENERGY_PRESETS: ReadonlyArray<{ preset: EnergyPreset; label: string }> = [
  { preset: 'equal', label: 'Equal' },
  { preset: 'near', label: 'Near ±1' },
  { preset: 'up', label: 'Up' },
  { preset: 'down', label: 'Down' },
];

export default function FollowParamsModal({
  isOpen,
  onClose,
  references,
  openPosition,
}: FollowParamsModalProps) {
  const params = useFollowParams();

  // Clamp modal position to viewport bounds
  const getClampedPosition = (pos: { x: number; y: number }) => {
    const modalWidth = 450;
    const modalHeight = 500;
    const padding = 20;
    const minX = modalWidth / 2 + padding;
    const maxX = window.innerWidth - modalWidth / 2 - padding;
    const minY = modalHeight / 2 + padding;
    const maxY = window.innerHeight - modalHeight / 2 - padding;
    return {
      x: Math.max(minX, Math.min(maxX, pos.x)),
      y: Math.max(minY, Math.min(maxY, pos.y)),
    };
  };
  const rawPosition = openPosition || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const modalPosition = getClampedPosition(rawPosition);

  // Handle ESC key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // An axis is meaningful when ANY followed reference carries the datum;
  // with nothing followed, everything stays editable (pre-configuring).
  const anyRef = references.length > 0;
  const hasKey = !anyRef || references.some(({ reference }) => reference.key !== null && reference.key !== undefined);
  const hasBpm = !anyRef || references.some(({ reference }) => !!reference.bpm);
  const hasTags = !anyRef || references.some(({ reference }) => reference.tags.length > 0);
  const hasEnergy = !anyRef || references.some(({ reference }) => reference.energy !== undefined);

  const previewEnergy = references.find(({ reference }) => reference.energy !== undefined)
    ?.reference.energy;

  return (
    <div
      className="follow-modal-overlay"
      onClick={onClose}
      style={{
        '--blur-center-x': `${modalPosition.x}px`,
        '--blur-center-y': `${modalPosition.y}px`,
      } as React.CSSProperties}
    >
      <div
        className="follow-modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: `${modalPosition.x}px`,
          top: `${modalPosition.y}px`,
          transform: 'translate(-50%, -45%)',
        }}
      >
        <h2 style={{ margin: '0 0 16px 0', color: 'var(--text)', fontSize: '16px' }}>
          Follow Parameters
        </h2>

        {/* Followed references — context, not a picker. */}
        <div className="follow-modal-reference-section">
          {references.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--subtext0)' }}>
              No Deck is being followed — parameters apply when Follow turns on.
            </div>
          ) : (
            references.map(({ deck, reference }) => (
              <div
                key={deck}
                style={{
                  fontSize: '12px',
                  color: 'var(--subtext0)',
                  display: 'flex',
                  gap: '12px',
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ color: 'var(--green)', fontWeight: 'bold' }}>⟲{deck}</span>
                <span style={{ color: 'var(--text)' }}>
                  {reference.title || reference.filename}
                </span>
                <span>Key: {formatKeyDisplay(reference.key)}</span>
                <span>BPM: {reference.bpm ?? '—'}</span>
                <span>Energy: {reference.energy ?? '—'}</span>
                <span>{followSummary(reference, params)}</span>
              </div>
            ))
          )}
        </div>

        <div style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text)', marginBottom: '12px' }}>
          Match criteria (live — no apply):
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Harmonic Keys */}
          <div className={`follow-modal-criteria-item ${!hasKey ? 'disabled' : ''}`}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={params.harmonicKeys}
                onChange={(e) => setFollowParams({ harmonicKeys: e.target.checked })}
              />
              <span style={{ fontWeight: 'bold', color: 'var(--text)' }}>Harmonic Keys</span>
            </label>
            <div style={{ fontSize: '12px', color: 'var(--subtext0)', paddingLeft: '24px' }}>
              Compatible keys for mixing (same, ±1, relative)
            </div>
          </div>

          {/* BPM */}
          <div className={`follow-modal-criteria-item ${!hasBpm ? 'disabled' : ''}`}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={params.bpm}
                onChange={(e) => setFollowParams({ bpm: e.target.checked })}
              />
              <span style={{ fontWeight: 'bold', color: 'var(--text)' }}>
                BPM within ±{params.bpmThresholdPercent}%
              </span>
            </label>
            <input
              type="range"
              min="0"
              max="15"
              step="1"
              value={params.bpmThresholdPercent}
              onChange={(e) => setFollowParams({ bpmThresholdPercent: parseInt(e.target.value) })}
              disabled={!params.bpm}
              className="follow-modal-threshold-slider"
              style={{ paddingLeft: '24px', width: 'calc(100% - 24px)' }}
            />
          </div>

          {/* Tags — any-shared by definition (CONTEXT.md: Compatible) */}
          <div className={`follow-modal-criteria-item ${!hasTags ? 'disabled' : ''}`}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={params.tags}
                onChange={(e) => setFollowParams({ tags: e.target.checked })}
              />
              <span style={{ fontWeight: 'bold', color: 'var(--text)' }}>Shares a tag</span>
            </label>
            <div style={{ fontSize: '12px', color: 'var(--subtext0)', paddingLeft: '24px' }}>
              At least one tag in common with the followed track
            </div>
          </div>

          {/* Energy */}
          <div className={`follow-modal-criteria-item ${!hasEnergy ? 'disabled' : ''}`}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={params.energy}
                onChange={(e) => setFollowParams({ energy: e.target.checked })}
              />
              <span style={{ fontWeight: 'bold', color: 'var(--text)' }}>Energy</span>
            </label>
            <div style={{ paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className="follow-modal-energy-presets">
                {ENERGY_PRESETS.map(({ preset, label }) => (
                  <button
                    key={preset}
                    onClick={() => setFollowParams({ energyPreset: preset })}
                    disabled={!params.energy}
                    className={`follow-modal-energy-preset-btn ${params.energyPreset === preset ? 'active' : ''}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {params.energy && previewEnergy !== undefined && (
                <div className="follow-modal-preview-text">
                  Will match: Energy{' '}
                  {(() => {
                    const { min, max } = getEnergyRange(previewEnergy, params.energyPreset);
                    return `${min}-${max}`;
                  })()}
                </div>
              )}
            </div>
          </div>

          {/* Known only (linked-pairs 04, formerly "proven only") */}
          <div className="follow-modal-criteria-item">
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={params.knownOnly}
                onChange={(e) => setFollowParams({ knownOnly: e.target.checked })}
              />
              <span style={{ fontWeight: 'bold', color: 'var(--text)' }}>◆🔗 Known only</span>
            </label>
            <div style={{ fontSize: '12px', color: 'var(--subtext0)', paddingLeft: '24px' }}>
              Only known tracks: a saved transition from a followed track (◆)
              or Linked with it (🔗). Otherwise known tracks are always
              included on top of the criteria above.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="follow-modal-footer">
          <button onClick={resetFollowParams} className="follow-modal-action-btn">
            Reset
          </button>
          <button onClick={onClose} className="follow-modal-action-btn follow-modal-action-btn-primary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
