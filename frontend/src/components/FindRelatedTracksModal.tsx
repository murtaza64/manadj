import { useEffect, useState } from 'react';
import './FindRelatedTracksModal.css';
import type { Track } from '../types';
import { type RelatedTracksSettings, DEFAULT_SETTINGS, saveSettings as saveSettingsToStorage, getEnergyRange } from './Library';
import { formatKeyDisplay } from '../utils/keyUtils';

interface FindRelatedTracksModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Loaded decks (transition-library 03): the match runs FROM one of
   * these — chosen via the A/B buttons, persisted with the settings. */
  loadedA: Track | null;
  loadedB: Track | null;
  /** Proven-tier switch: bound to the SAME filter state as the filter
   * bar's toggle (one source of truth, two controls). */
  hasTransition: boolean;
  onToggleTransition: (on: boolean) => void;
  onApply: (settings: RelatedTracksSettings) => void;
  openPosition?: { x: number; y: number };
}

export default function FindRelatedTracksModal({
  isOpen,
  onClose,
  loadedA,
  loadedB,
  hasTransition,
  onToggleTransition,
  onApply,
  openPosition,
}: FindRelatedTracksModalProps) {
  // Clamp modal position to viewport bounds
  const getClampedPosition = (pos: { x: number; y: number }) => {
    const modalWidth = 450;
    const modalHeight = 500;
    const padding = 20;

    const minX = modalWidth / 2 + padding;
    const maxX = window.innerWidth - modalWidth / 2 - padding;
    const clampedX = Math.max(minX, Math.min(maxX, pos.x));

    const minY = modalHeight / 2 + padding;
    const maxY = window.innerHeight - modalHeight / 2 - padding;
    const clampedY = Math.max(minY, Math.min(maxY, pos.y));

    return { x: clampedX, y: clampedY };
  };

  const rawPosition = openPosition || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const modalPosition = getClampedPosition(rawPosition);

  // Settings state
  const [settings, setSettings] = useState<RelatedTracksSettings>(DEFAULT_SETTINGS);

  // Load settings from localStorage when modal opens
  useEffect(() => {
    if (isOpen) {
      const saved = localStorage.getItem('findRelatedTracksSettings');
      if (saved) {
        try {
          // Merge over defaults: saves predating a field (e.g. refDeck)
          // must not leave it undefined.
          setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) });
        } catch (error) {
          console.error('Failed to load settings:', error);
        }
      }
    }
  }, [isOpen]);

  // Handle ESC key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Reference = the chosen loaded deck's track; fall back to whichever
  // deck IS loaded (the button for an empty deck is disabled).
  const effectiveDeck: 'A' | 'B' | null =
    settings.refDeck === 'A'
      ? loadedA
        ? 'A'
        : loadedB
          ? 'B'
          : null
      : loadedB
        ? 'B'
        : loadedA
          ? 'A'
          : null;
  const reference = effectiveDeck === 'A' ? loadedA : effectiveDeck === 'B' ? loadedB : null;

  // Data availability checks (against the reference track)
  const hasKey = reference?.key !== null && reference?.key !== undefined;
  const hasBpm = reference?.bpm !== null && reference?.bpm !== undefined;
  const hasTags = reference?.tags && reference.tags.length > 0;
  const hasEnergy = reference?.energy !== null && reference?.energy !== undefined;

  // Clear settings
  const handleClear = () => {
    setSettings(DEFAULT_SETTINGS);
  };

  // Apply settings
  const handleApply = () => {
    saveSettingsToStorage(settings);
    onApply(settings);
    onClose();
  };

  // Calculate BPM range for preview
  const calculateBpmRange = () => {
    if (!hasBpm || !reference?.bpm) return '—';
    const min = Math.round(reference.bpm - (reference.bpm * settings.bpmThresholdPercent / 100));
    const max = Math.round(reference.bpm + (reference.bpm * settings.bpmThresholdPercent / 100));
    return `${min}-${max} BPM`;
  };

  // Calculate energy range for preview
  const calculateEnergyRange = () => {
    if (!hasEnergy || reference?.energy === undefined || reference.energy === null) return '—';
    const { min, max } = getEnergyRange(reference.energy, settings.energyPreset);
    return `Energy ${min}-${max}`;
  };

  return (
    <div
      className="related-modal-overlay"
      onClick={onClose}
      style={{
        '--blur-center-x': `${modalPosition.x}px`,
        '--blur-center-y': `${modalPosition.y}px`,
      } as React.CSSProperties}
    >
      <div
        className="related-modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: `${modalPosition.x}px`,
          top: `${modalPosition.y}px`,
          transform: 'translate(-50%, -45%)',
        }}
      >
        <h2 style={{ margin: '0 0 16px 0', color: 'var(--text)', fontSize: '16px' }}>
          Find Compatible Tracks
        </h2>

        {/* Reference deck: match FROM a loaded deck's track. */}
        <div className="related-reference-section">
          <div style={{ fontWeight: 'bold', marginBottom: '6px', color: 'var(--text)' }}>
            Match from deck:
          </div>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
            {(['A', 'B'] as const).map((deck) => {
              const track = deck === 'A' ? loadedA : loadedB;
              const isChosen = effectiveDeck === deck;
              return (
                <button
                  key={deck}
                  disabled={track === null}
                  onClick={() => setSettings({ ...settings, refDeck: deck })}
                  title={track ? `Match from ${track.title || track.filename}` : `Deck ${deck} is empty`}
                  style={{
                    flex: 1,
                    padding: '4px 8px',
                    background: isChosen ? 'var(--blue)' : 'var(--surface0)',
                    color: track === null ? 'var(--overlay0)' : isChosen ? 'var(--base)' : 'var(--text)',
                    border: '1px solid var(--surface1)',
                    cursor: track === null ? 'not-allowed' : 'pointer',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {deck} · {track ? track.title || track.filename : 'empty'}
                </button>
              );
            })}
          </div>
          {reference && (
            <div style={{ fontSize: '12px', color: 'var(--subtext0)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <span>Key: {formatKeyDisplay(reference.key)}</span>
              <span>BPM: {reference.bpm ?? '—'}</span>
              <span>Energy: {reference.energy ?? '—'}</span>
              <span>Tags: {reference.tags.length}</span>
            </div>
          )}
        </div>

        <div style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text)', marginBottom: '12px' }}>
          Match Criteria:
        </div>

        {/* Criteria Sections */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Harmonic Keys */}
          <div className={`related-criteria-item ${!hasKey ? 'disabled' : ''}`}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: hasKey ? 'pointer' : 'not-allowed' }}>
              <input
                type="checkbox"
                checked={settings.harmonicKeys}
                disabled={!hasKey}
                onChange={(e) => setSettings({ ...settings, harmonicKeys: e.target.checked })}
              />
              <span style={{ fontWeight: 'bold', color: 'var(--text)' }}>Harmonic Keys</span>
            </label>
            <div style={{ fontSize: '12px', color: 'var(--subtext0)', paddingLeft: '24px' }}>
              Match compatible keys for mixing (same, ±1, relative)
            </div>
          </div>

          {/* BPM */}
          <div className={`related-criteria-item ${!hasBpm ? 'disabled' : ''}`}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: hasBpm ? 'pointer' : 'not-allowed' }}>
              <input
                type="checkbox"
                checked={settings.bpm}
                disabled={!hasBpm}
                onChange={(e) => setSettings({ ...settings, bpm: e.target.checked })}
              />
              <span style={{ fontWeight: 'bold', color: 'var(--text)' }}>BPM within ±{settings.bpmThresholdPercent}%</span>
            </label>
            <input
              type="range"
              min="0"
              max="15"
              step="1"
              value={settings.bpmThresholdPercent}
              onChange={(e) => setSettings({ ...settings, bpmThresholdPercent: parseInt(e.target.value) })}
              disabled={!settings.bpm || !hasBpm}
              className="related-threshold-slider"
              style={{ paddingLeft: '24px', width: 'calc(100% - 24px)' }}
            />
            {settings.bpm && hasBpm && (
              <div className="related-preview-text" style={{ paddingLeft: '24px' }}>
                Will match: {calculateBpmRange()}
              </div>
            )}
          </div>

          {/* Tags */}
          <div className={`related-criteria-item ${!hasTags ? 'disabled' : ''}`}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: hasTags ? 'pointer' : 'not-allowed' }}>
              <input
                type="checkbox"
                checked={settings.tags}
                disabled={!hasTags}
                onChange={(e) => setSettings({ ...settings, tags: e.target.checked })}
              />
              <span style={{ fontWeight: 'bold', color: 'var(--text)' }}>Tags</span>
            </label>
            <div style={{ paddingLeft: '24px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: 'var(--subtext0)' }}>Match</span>
              <button
                onClick={() => setSettings({ ...settings, tagMatchMode: 'ANY' })}
                disabled={!settings.tags || !hasTags}
                style={{
                  padding: '4px 12px',
                  background: settings.tagMatchMode === 'ANY' ? 'var(--blue)' : 'var(--surface0)',
                  color: settings.tagMatchMode === 'ANY' ? 'var(--base)' : 'var(--text)',
                  border: '1px solid var(--surface1)',
                  cursor: settings.tags && hasTags ? 'pointer' : 'not-allowed',
                  fontSize: '12px',
                  fontWeight: 'bold',
                }}
              >
                ANY
              </button>
              <button
                onClick={() => setSettings({ ...settings, tagMatchMode: 'ALL' })}
                disabled={!settings.tags || !hasTags}
                style={{
                  padding: '4px 12px',
                  background: settings.tagMatchMode === 'ALL' ? 'var(--blue)' : 'var(--surface0)',
                  color: settings.tagMatchMode === 'ALL' ? 'var(--base)' : 'var(--text)',
                  border: '1px solid var(--surface1)',
                  cursor: settings.tags && hasTags ? 'pointer' : 'not-allowed',
                  fontSize: '12px',
                  fontWeight: 'bold',
                }}
              >
                ALL
              </button>
              <span style={{ fontSize: '12px', color: 'var(--subtext0)' }}>of these tags</span>
            </div>
          </div>

          {/* Energy */}
          <div className={`related-criteria-item ${!hasEnergy ? 'disabled' : ''}`}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: hasEnergy ? 'pointer' : 'not-allowed' }}>
              <input
                type="checkbox"
                checked={settings.energy}
                disabled={!hasEnergy}
                onChange={(e) => setSettings({ ...settings, energy: e.target.checked })}
              />
              <span style={{ fontWeight: 'bold', color: 'var(--text)' }}>Energy</span>
            </label>
            <div style={{ paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontSize: '12px', color: 'var(--subtext0)' }}>Preset:</div>
              <div className="related-energy-presets">
                <button
                  onClick={() => setSettings({ ...settings, energyPreset: 'equal' })}
                  disabled={!settings.energy || !hasEnergy}
                  className={`related-energy-preset-btn ${settings.energyPreset === 'equal' ? 'active' : ''}`}
                >
                  Equal
                </button>
                <button
                  onClick={() => setSettings({ ...settings, energyPreset: 'near' })}
                  disabled={!settings.energy || !hasEnergy}
                  className={`related-energy-preset-btn ${settings.energyPreset === 'near' ? 'active' : ''}`}
                >
                  Near ±1
                </button>
                <button
                  onClick={() => setSettings({ ...settings, energyPreset: 'up' })}
                  disabled={!settings.energy || !hasEnergy}
                  className={`related-energy-preset-btn ${settings.energyPreset === 'up' ? 'active' : ''}`}
                >
                  Up
                </button>
                <button
                  onClick={() => setSettings({ ...settings, energyPreset: 'down' })}
                  disabled={!settings.energy || !hasEnergy}
                  className={`related-energy-preset-btn ${settings.energyPreset === 'down' ? 'active' : ''}`}
                >
                  Down
                </button>
              </div>
              {settings.energy && hasEnergy && (
                <div className="related-preview-text">
                  Will match: {calculateEnergyRange()}
                </div>
              )}
            </div>
          </div>

          {/* Proven tier (transition-library 03): NOT one of the four
              heuristic criteria — this switch IS the library filter-bar
              toggle (same filter state), applied live and preserved by
              Apply/quick-apply. */}
          <div className="related-criteria-item">
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={hasTransition}
                onChange={(e) => onToggleTransition(e.target.checked)}
              />
              <span style={{ fontWeight: 'bold', color: 'var(--text)' }}>
                Has transition from loaded decks
              </span>
            </label>
            <div style={{ fontSize: '12px', color: 'var(--subtext0)', paddingLeft: '24px' }}>
              Proven tier: only tracks you already built a transition into
              (synced with the ◆ toggle in the filter bar; takes effect
              immediately)
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="related-modal-footer">
          <button onClick={handleClear} className="related-action-btn">
            Clear
          </button>
          <button onClick={handleApply} className="related-action-btn related-action-btn-primary">
            Apply
          </button>
          <button onClick={onClose} className="related-action-btn">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
