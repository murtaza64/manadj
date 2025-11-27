import { useEffect, useRef } from 'react';
import './BpmModal.css';

interface BpmModalProps {
  isOpen: boolean;
  onClose: () => void;
  bpmCenter: number | null;
  bpmThresholdPercent: number;
  onBpmCenterChange: (value: number | null) => void;
  onThresholdChange: (value: number) => void;
  onClear: () => void;
  openPosition?: { x: number; y: number };
}

export default function BpmModal({
  isOpen,
  onClose,
  bpmCenter,
  bpmThresholdPercent,
  onBpmCenterChange,
  onThresholdChange,
  onClear,
  openPosition,
}: BpmModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Clamp modal position to viewport bounds
  const getClampedPosition = (pos: { x: number; y: number }) => {
    // Approximate modal dimensions (will adjust based on content)
    const modalWidth = 350;
    const modalHeight = 300;
    const padding = 20;

    // Clamp x position
    const minX = modalWidth / 2 + padding;
    const maxX = window.innerWidth - modalWidth / 2 - padding;
    const clampedX = Math.max(minX, Math.min(maxX, pos.x));

    // Clamp y position
    const minY = modalHeight / 2 + padding;
    const maxY = window.innerHeight - modalHeight / 2 - padding;
    const clampedY = Math.max(minY, Math.min(maxY, pos.y));

    return { x: clampedX, y: clampedY };
  };

  const rawPosition = openPosition || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const modalPosition = getClampedPosition(rawPosition);

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

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Calculate BPM range
  const calculateRange = () => {
    if (bpmCenter === null) {
      return { min: null, max: null };
    }
    const min = Math.round(bpmCenter - (bpmCenter * bpmThresholdPercent / 100));
    const max = Math.round(bpmCenter + (bpmCenter * bpmThresholdPercent / 100));
    return { min, max };
  };

  const { min, max } = calculateRange();

  const handleCenterInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '') {
      onBpmCenterChange(null);
    } else {
      const numValue = parseInt(value);
      if (!isNaN(numValue) && numValue >= 1 && numValue <= 400) {
        onBpmCenterChange(numValue);
      }
    }
  };

  return (
    <div
      className="bpm-modal-overlay"
      onClick={onClose}
      style={{
        '--blur-center-x': `${modalPosition.x}px`,
        '--blur-center-y': `${modalPosition.y}px`,
      } as React.CSSProperties}
    >
      <div
        className="bpm-modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: `${modalPosition.x}px`,
          top: `${modalPosition.y}px`,
          transform: 'translate(-50%, -45%)',
        }}
      >
        <div className="bpm-modal-section">
          <label htmlFor="bpm-center-input" className="bpm-label">
            Center BPM
          </label>
          <input
            ref={inputRef}
            id="bpm-center-input"
            type="number"
            placeholder="e.g., 120"
            value={bpmCenter ?? ''}
            onChange={handleCenterInputChange}
            min="1"
            max="400"
            className="bpm-center-input"
          />
        </div>

        <div className="bpm-modal-section">
          <label htmlFor="bpm-threshold-slider" className="bpm-label">
            Threshold (±{bpmThresholdPercent}%)
          </label>
          <input
            id="bpm-threshold-slider"
            type="range"
            min="0"
            max="15"
            step="1"
            value={bpmThresholdPercent}
            onChange={(e) => onThresholdChange(parseInt(e.target.value))}
            disabled={bpmCenter === null}
            className="bpm-threshold-slider"
          />
        </div>

        <div className={`bpm-range-display ${bpmCenter === null ? 'inactive' : ''}`}>
          {bpmCenter !== null && min !== null && max !== null
            ? `${min}-${max} BPM`
            : '—'}
        </div>

        <div className="bpm-modal-footer">
          <button
            onClick={onClear}
            className="bpm-action-btn"
            disabled={bpmCenter === null && bpmThresholdPercent === 5}
          >
            Clear
          </button>
          <button onClick={onClose} className="bpm-action-btn">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
