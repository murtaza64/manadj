import { useEffect, useState } from 'react';
import './FindRelatedTracksModal.css';
import type { Track } from '../types';
import { type RelatedTracksSettings, DEFAULT_SETTINGS, saveSettings as saveSettingsToStorage, getEnergyRange } from './TrackList';
import { formatKeyDisplay } from '../utils/keyUtils';

interface FindRelatedTracksModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTrack: Track | null;
  onApply: (settings: RelatedTracksSettings) => void;
  openPosition?: { x: number; y: number };
}

export default function FindRelatedTracksModal({
  isOpen,
  onClose,
  selectedTrack,
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
          setSettings(JSON.parse(saved));
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

  // Data availability checks
  const hasKey = selectedTrack?.key !== null && selectedTrack?.key !== undefined;
  const hasBpm = selectedTrack?.bpm !== null && selectedTrack?.bpm !== undefined;
  const hasTags = selectedTrack?.tags && selectedTrack.tags.length > 0;
  const hasEnergy = selectedTrack?.energy !== null && selectedTrack?.energy !== undefined;

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
    if (!hasBpm || !selectedTrack?.bpm) return '—';
    const min = Math.round(selectedTrack.bpm - (selectedTrack.bpm * settings.bpmThresholdPercent / 100));
    const max = Math.round(selectedTrack.bpm + (selectedTrack.bpm * settings.bpmThresholdPercent / 100));
    return `${min}-${max} BPM`;
  };

  // Calculate energy range for preview
  const calculateEnergyRange = () => {
    if (!hasEnergy || selectedTrack?.energy === undefined) return '—';
    const { min, max } = getEnergyRange(selectedTrack.energy, settings.energyPreset);
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
          Find Related Tracks
        </h2>

        {/* Reference Track Section */}
        {selectedTrack && (
          <div className="related-reference-section">
            <div style={{ fontWeight: 'bold', marginBottom: '4px', color: 'var(--text)' }}>
              Reference Track:
            </div>
            <div style={{ fontSize: '14px', color: 'var(--subtext1)', marginBottom: '8px' }}>
              {selectedTrack.title || selectedTrack.filename} {selectedTrack.artist && `- ${selectedTrack.artist}`}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--subtext0)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <span>Key: {formatKeyDisplay(selectedTrack.key)}</span>
              <span>BPM: {selectedTrack.bpm ?? '—'}</span>
              <span>Energy: {selectedTrack.energy ?? '—'}</span>
              <span>Tags: {selectedTrack.tags.length}</span>
            </div>
          </div>
        )}

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
